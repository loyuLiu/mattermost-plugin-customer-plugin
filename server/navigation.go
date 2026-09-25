package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/pkg/errors"
)

// Key holding the whole product navigation document in the plugin KV store.
//
// The document is small and only ever written by an administrator, so it is kept as
// one value rather than one key per category: reads stay a single KVGet and there is
// no partial-write window to reconcile.
const navigationKey = "navigation"

// Limits applied to whatever an administrator submits. They exist because the value
// lands in the plugin KV store, which has a finite entry size, and because the button
// is rendered in the global header of every user.
const (
	maxNavCategories = 30
	maxNavLinks      = 50
	maxNavNameLength = 64

	// Longest URL accepted for a link target or a logo. Generous enough for signed
	// URLs, short enough to keep the document bounded.
	maxNavURLLength = 2048

	// Upper bound of the encoded document. A realistic navigation (say 20 links) needs
	// a couple of kilobytes, so this only ever trips on a mistake.
	maxNavDocumentBytes = 32 * 1024

	// Default name of a category the administrator did not name.
	defaultNavCategoryName = "未命名分类"
)

// NavLink is one entry of the navigation panel.
type NavLink struct {
	// ID is only used as a React key; generated client side, kept if supplied.
	ID string `json:"id"`

	// Name is the caption shown under the logo.
	Name string `json:"name"`

	// URL the link points at. Only http(s) and site-relative paths survive sanitising.
	URL string `json:"url"`

	// IconURL is the logo rendered next to the caption. Empty means "use the fallback
	// tile with the first character of the name".
	IconURL string `json:"iconUrl,omitempty"`
}

// NavCategory groups links under a heading.
type NavCategory struct {
	ID    string    `json:"id"`
	Name  string    `json:"name"`
	Links []NavLink `json:"links"`
}

// navigationDocument is what is persisted and served.
type navigationDocument struct {
	Categories []NavCategory `json:"categories"`
}

// navigationBackend is the slice of the plugin API this feature needs, which keeps the
// logic below unit testable without a server.
type navigationBackend interface {
	KVSet(key string, value []byte) *model.AppError
	KVGet(key string) ([]byte, *model.AppError)
}

// navigationStore wraps the plugin KV store with typed accessors.
type navigationStore struct {
	backend navigationBackend

	mu sync.Mutex // serialises read-modify-write cycles
}

// load returns the stored document, or an empty one when nothing was saved yet.
func (s *navigationStore) load() (*navigationDocument, error) {
	data, appErr := s.backend.KVGet(navigationKey)
	if appErr != nil {
		return nil, errors.Wrap(appErr, "failed to read navigation")
	}

	if len(data) == 0 {
		return &navigationDocument{}, nil
	}

	doc := new(navigationDocument)
	if err := json.Unmarshal(data, doc); err != nil {
		return nil, errors.Wrap(err, "failed to decode navigation")
	}

	return normalizeNavigation(doc), nil
}

// save normalises, encodes and persists the document, returning what was stored so
// the caller can echo the authoritative version back.
func (s *navigationStore) save(doc *navigationDocument) (*navigationDocument, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	normalized := normalizeNavigation(doc)

	data, err := json.Marshal(normalized)
	if err != nil {
		return nil, errors.Wrap(err, "failed to encode navigation")
	}

	if len(data) > maxNavDocumentBytes {
		return nil, errors.Errorf("navigation is too large: %d bytes, limit is %d", len(data), maxNavDocumentBytes)
	}

	if appErr := s.backend.KVSet(navigationKey, data); appErr != nil {
		return nil, errors.Wrap(appErr, "failed to store navigation")
	}

	return normalized, nil
}

// sanitizeNavURL keeps only targets that cannot execute script: absolute http(s) URLs
// and site-relative paths. Everything else - notably `javascript:` and `data:` - is
// dropped, because these strings end up in the `href` of an anchor and in the `src` of
// an image on every user's screen.
func sanitizeNavURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}

	// Whitespace and control characters are how "java\nscript:alert(1)" smuggles a
	// scheme past a naive prefix check.
	if strings.ContainsAny(raw, " \t\r\n\v\f") || strings.IndexFunc(raw, func(r rune) bool {
		return r < 0x20 || r == 0x7f
	}) >= 0 {
		return ""
	}

	if utf8.RuneCountInString(raw) > maxNavURLLength {
		return ""
	}

	lower := strings.ToLower(raw)

	switch {
	case strings.HasPrefix(lower, "https://"), strings.HasPrefix(lower, "http://"):
		return raw

	case strings.HasPrefix(raw, "/"):
		// A site-relative path. `//host` would be protocol-relative (it escapes the
		// site) and `/\host` is treated as protocol-relative by some browsers.
		if len(raw) > 1 && (raw[1] == '/' || raw[1] == '\\') {
			return ""
		}

		return raw
	}

	return ""
}

// cleanNavName trims, strips control characters and bounds the length of a label.
// Empty input falls back to `fallback`, which may itself be empty.
func cleanNavName(raw string, fallback string) string {
	cleaned := strings.Map(func(r rune) rune {
		switch r {
		case '\n', '\r', '\t':
			return ' '
		}

		if r < 0x20 || r == 0x7f {
			return -1
		}

		return r
	}, raw)

	cleaned = strings.TrimSpace(cleaned)
	if cleaned == "" {
		return fallback
	}

	if utf8.RuneCountInString(cleaned) > maxNavNameLength {
		runes := []rune(cleaned)
		cleaned = strings.TrimSpace(string(runes[:maxNavNameLength]))
	}

	return cleaned
}

// navID bounds an identifier. It is only ever used as a React key, so no character
// filtering is needed; a missing one is generated.
func navID(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return model.NewId()
	}

	if utf8.RuneCountInString(raw) > 64 {
		return string([]rune(raw)[:64])
	}

	return raw
}

// normalizeNavigation drops anything unusable and applies the limits above. An
// unnamed category survives under a default name so that an administrator never loses
// work by saving too early; a link without a usable target or caption is dropped,
// because it could not be rendered anyway.
func normalizeNavigation(doc *navigationDocument) *navigationDocument {
	// The slices are pre-allocated empty rather than left nil. encoding/json writes a
	// nil slice as `null`, and the webapp iterates `categories` / `links` directly —
	// a category whose every link was dropped used to come back as `"links": null`
	// and crashed the admin panel with "Cannot read properties of null".
	out := &navigationDocument{Categories: []NavCategory{}}
	if doc == nil {
		return out
	}

	for _, category := range doc.Categories {
		if len(out.Categories) >= maxNavCategories {
			break
		}

		cat := NavCategory{
			ID:    navID(category.ID),
			Name:  cleanNavName(category.Name, defaultNavCategoryName),
			Links: []NavLink{},
		}

		for _, link := range category.Links {
			if len(cat.Links) >= maxNavLinks {
				break
			}

			url := sanitizeNavURL(link.URL)
			name := cleanNavName(link.Name, "")
			if url == "" || name == "" {
				continue
			}

			cat.Links = append(cat.Links, NavLink{
				ID:      navID(link.ID),
				Name:    name,
				URL:     url,
				IconURL: sanitizeNavURL(link.IconURL),
			})
		}

		out.Categories = append(out.Categories, cat)
	}

	return out
}

// handleGetNavigation serves the navigation to every logged-in user. It is *not* gated
// on the feature switch: the administrator still has to be able to edit the entries
// while the button is hidden, and the webapp hides the button by itself.
func (p *Plugin) handleGetNavigation(w http.ResponseWriter, _ *http.Request) {
	store := p.navigation()
	if store == nil {
		http.Error(w, "plugin is not ready", http.StatusServiceUnavailable)
		return
	}

	doc, err := store.load()
	if err != nil {
		p.API.LogError("failed to load navigation", "error", err.Error())
		http.Error(w, "failed to load navigation", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	if err := json.NewEncoder(w).Encode(doc); err != nil {
		p.API.LogError("failed to write navigation response", "error", err.Error())
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// handleSaveNavigation replaces the whole navigation. Saving is destructive by design
// (the panel always sends the complete document), so it is restricted to system
// administrators the same way the bulk delete endpoints are.
func (p *Plugin) handleSaveNavigation(w http.ResponseWriter, r *http.Request) {
	actorID := r.Header.Get("Mattermost-User-ID")
	if !p.API.HasPermissionTo(actorID, model.PermissionManageSystem) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	store := p.navigation()
	if store == nil {
		http.Error(w, "plugin is not ready", http.StatusServiceUnavailable)
		return
	}

	doc := new(navigationDocument)
	if err := json.NewDecoder(r.Body).Decode(doc); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	saved, err := store.save(doc)
	if err != nil {
		// Sizes are logged because the only realistic failure is the KV value limit, and
		// "how big was it" is the one thing the administrator cannot see from the panel.
		p.API.LogError(
			"failed to save navigation",
			"actor", actorID,
			"submitted_categories", len(doc.Categories),
			"kept_categories", len(normalizeNavigation(doc).Categories),
			"error", err.Error(),
		)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	if err := json.NewEncoder(w).Encode(saved); err != nil {
		p.API.LogError("failed to write navigation response", "error", err.Error())
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}
