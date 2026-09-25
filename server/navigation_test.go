package main

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
)

// 项目内的测试只依赖标准库，这里同样不用 testify，避免为插件引入额外依赖。

func navEq(t *testing.T, label string, expected, actual any) {
	t.Helper()

	if !reflect.DeepEqual(expected, actual) {
		t.Fatalf("%s: expected %v, got %v", label, expected, actual)
	}
}

func navTrue(t *testing.T, label string, cond bool) {
	t.Helper()

	if !cond {
		t.Fatalf("%s: expected true", label)
	}
}

func navNoErr(t *testing.T, label string, err error) {
	t.Helper()

	if err != nil {
		t.Fatalf("%s: unexpected error %v", label, err)
	}
}

func navErr(t *testing.T, label string, err error) {
	t.Helper()

	if err == nil {
		t.Fatalf("%s: expected an error", label)
	}
}

// fakeNavigationBackend is an in-memory navigationBackend.
type fakeNavigationBackend struct {
	values map[string][]byte
	setErr *model.AppError
}

func newFakeNavigationBackend() *fakeNavigationBackend {
	return &fakeNavigationBackend{values: map[string][]byte{}}
}

func (f *fakeNavigationBackend) KVSet(key string, value []byte) *model.AppError {
	if f.setErr != nil {
		return f.setErr
	}

	copied := make([]byte, len(value))
	copy(copied, value)
	f.values[key] = copied

	return nil
}

func (f *fakeNavigationBackend) KVGet(key string) ([]byte, *model.AppError) {
	value, ok := f.values[key]
	if !ok {
		return nil, nil
	}

	return value, nil
}

func TestSanitizeNavURL(t *testing.T) {
	good := []string{
		"https://example.com/app",
		"http://example.com/app",
		"https://example.com/a?b=c&d=e#f",
		"/admin_console/environment/web_server",
		"/static/logo.png",
	}

	for _, raw := range good {
		navEq(t, "accepted "+raw, raw, sanitizeNavURL(raw))
	}

	bad := []string{
		"",
		"   ",
		"javascript:alert(1)",
		"JavaScript:alert(1)",
		"java\nscript:alert(1)",
		"java\tscript:alert(1)",
		"data:image/svg+xml;base64,AAAA",
		"vbscript:msgbox",
		"ftp://example.com/file",
		"//evil.example.com/logo.png",
		"/\\evil.example.com/logo.png",
		"https://example.com/a b",
	}

	for _, raw := range bad {
		navEq(t, "rejected "+raw, "", sanitizeNavURL(raw))
	}

	navEq(t, "over long", "", sanitizeNavURL("https://example.com/"+strings.Repeat("a", maxNavURLLength)))
	navEq(t, "trimmed", "https://example.com/app", sanitizeNavURL("  https://example.com/app  "))
}

func TestCleanNavName(t *testing.T) {
	navEq(t, "trim", "产品导航", cleanNavName("  产品导航  ", ""))
	navEq(t, "newline becomes space", "a b", cleanNavName("a\nb", ""))
	navEq(t, "tab becomes space", "a b", cleanNavName("a\tb", ""))
	navEq(t, "control char dropped", "ab", cleanNavName("a\x00b", ""))
	navEq(t, "fallback used", "fallback", cleanNavName("   ", "fallback"))
	navEq(t, "no fallback", "", cleanNavName("   ", ""))

	long := cleanNavName(strings.Repeat("名", maxNavNameLength+10), "")
	navEq(t, "length capped", maxNavNameLength, len([]rune(long)))
}

func TestNavID(t *testing.T) {
	navEq(t, "kept", "cat-1", navID("cat-1"))
	navEq(t, "trimmed", "cat-1", navID("  cat-1  "))

	first := navID("")
	if first == "" {
		t.Fatal("expected a generated id")
	}

	if first == navID("") {
		t.Fatal("two generated ids must differ")
	}

	navEq(t, "bounded", 64, len([]rune(navID(strings.Repeat("x", 100)))))
}

func TestNormalizeNavigation(t *testing.T) {
	t.Run("nil document", func(t *testing.T) {
		out := normalizeNavigation(nil)
		if out == nil {
			t.Fatal("expected a document")
		}

		navEq(t, "no categories", 0, len(out.Categories))
	})

	t.Run("keeps a well formed document", func(t *testing.T) {
		out := normalizeNavigation(&navigationDocument{
			Categories: []NavCategory{
				{
					ID:   "cat",
					Name: "内部系统",
					Links: []NavLink{
						{ID: "l1", Name: "工单", URL: "https://example.com/ticket", IconURL: "https://example.com/t.png"},
					},
				},
			},
		})

		navEq(t, "one category", 1, len(out.Categories))
		navEq(t, "category name", "内部系统", out.Categories[0].Name)
		navEq(t, "one link", 1, len(out.Categories[0].Links))
		navEq(t, "link url", "https://example.com/ticket", out.Categories[0].Links[0].URL)
		navEq(t, "link icon", "https://example.com/t.png", out.Categories[0].Links[0].IconURL)
	})

	t.Run("unnamed category survives under a default name", func(t *testing.T) {
		out := normalizeNavigation(&navigationDocument{
			Categories: []NavCategory{{Links: []NavLink{{Name: "工单", URL: "https://example.com"}}}},
		})

		navEq(t, "one category", 1, len(out.Categories))
		navEq(t, "default name", defaultNavCategoryName, out.Categories[0].Name)
	})

	t.Run("unusable links are dropped", func(t *testing.T) {
		out := normalizeNavigation(&navigationDocument{
			Categories: []NavCategory{{
				Name: "内部系统",
				Links: []NavLink{
					{Name: "没有地址", URL: ""},
					{Name: "", URL: "https://example.com"},
					{Name: "脚本", URL: "javascript:alert(1)"},
					{Name: "正常", URL: "https://example.com/ok"},
				},
			}},
		})

		navEq(t, "one link left", 1, len(out.Categories[0].Links))
		navEq(t, "survivor", "正常", out.Categories[0].Links[0].Name)
	})

	t.Run("ids are generated when missing", func(t *testing.T) {
		out := normalizeNavigation(&navigationDocument{
			Categories: []NavCategory{{Name: "内部系统", Links: []NavLink{{Name: "工单", URL: "https://example.com"}}}},
		})

		if out.Categories[0].ID == "" {
			t.Fatal("expected a generated category id")
		}

		if out.Categories[0].Links[0].ID == "" {
			t.Fatal("expected a generated link id")
		}
	})

	t.Run("limits are applied", func(t *testing.T) {
		links := make([]NavLink, 0, maxNavLinks+5)
		for i := 0; i < maxNavLinks+5; i++ {
			links = append(links, NavLink{Name: "l", URL: "https://example.com"})
		}

		categories := make([]NavCategory, 0, maxNavCategories+5)
		for i := 0; i < maxNavCategories+5; i++ {
			categories = append(categories, NavCategory{Name: "c", Links: links})
		}

		out := normalizeNavigation(&navigationDocument{Categories: categories})

		navEq(t, "categories capped", maxNavCategories, len(out.Categories))
		navEq(t, "links capped", maxNavLinks, len(out.Categories[0].Links))
	})

	t.Run("script icon url is dropped but the link stays", func(t *testing.T) {
		out := normalizeNavigation(&navigationDocument{
			Categories: []NavCategory{{
				Name:  "内部系统",
				Links: []NavLink{{Name: "工单", URL: "https://example.com", IconURL: "javascript:alert(1)"}},
			}},
		})

		navEq(t, "link kept", 1, len(out.Categories[0].Links))
		navEq(t, "icon dropped", "", out.Categories[0].Links[0].IconURL)
	})
}

func TestNormalizeNavigationAlwaysEmitsArrays(t *testing.T) {
	// encoding/json writes a nil slice as `null`, and the webapp iterates both
	// collections directly: a category whose every link was dropped used to come back
	// as `"links": null` and crash the panel with "Cannot read properties of null".
	empty := normalizeNavigation(nil)
	if empty.Categories == nil {
		t.Fatal("expected an empty slice, not nil")
	}

	data, err := json.Marshal(empty)
	navNoErr(t, "marshal", err)
	navEq(t, "empty document", `{"categories":[]}`, string(data))

	dropped := normalizeNavigation(&navigationDocument{
		Categories: []NavCategory{{Name: "内部系统", Links: []NavLink{{Name: "坏", URL: "javascript:alert(1)"}}}},
	})
	if dropped.Categories[0].Links == nil {
		t.Fatal("expected an empty links slice, not nil")
	}

	data, err = json.Marshal(dropped)
	navNoErr(t, "marshal", err)

	if strings.Contains(string(data), "null") {
		t.Fatalf("expected no null in the payload, got %s", data)
	}
}

func TestNavigationStoreLoad(t *testing.T) {
	t.Run("nothing stored yet", func(t *testing.T) {
		store := &navigationStore{backend: newFakeNavigationBackend()}

		doc, err := store.load()
		navNoErr(t, "load", err)
		navEq(t, "no categories", 0, len(doc.Categories))
	})

	t.Run("stored document is normalized on the way out", func(t *testing.T) {
		backend := newFakeNavigationBackend()
		raw, err := json.Marshal(&navigationDocument{
			Categories: []NavCategory{{Name: "内部系统", Links: []NavLink{{Name: "坏", URL: "javascript:alert(1)"}}}},
		})
		navNoErr(t, "marshal", err)
		backend.values[navigationKey] = raw

		store := &navigationStore{backend: backend}

		doc, err := store.load()
		navNoErr(t, "load", err)
		navEq(t, "one category", 1, len(doc.Categories))
		navEq(t, "script link dropped", 0, len(doc.Categories[0].Links))
	})

	t.Run("corrupt payload is an error", func(t *testing.T) {
		backend := newFakeNavigationBackend()
		backend.values[navigationKey] = []byte("{not json")

		store := &navigationStore{backend: backend}

		_, err := store.load()
		navErr(t, "load", err)
	})
}

func TestNavigationStoreSave(t *testing.T) {
	t.Run("round trip", func(t *testing.T) {
		backend := newFakeNavigationBackend()
		store := &navigationStore{backend: backend}

		saved, err := store.save(&navigationDocument{
			Categories: []NavCategory{{
				Name:  "内部系统",
				Links: []NavLink{{Name: "工单", URL: "https://example.com/ticket"}},
			}},
		})
		navNoErr(t, "save", err)
		navEq(t, "one category", 1, len(saved.Categories))

		loaded, err := store.load()
		navNoErr(t, "load", err)
		navEq(t, "same document", saved, loaded)

		if len(backend.values[navigationKey]) == 0 {
			t.Fatal("expected the document to be written to the KV store")
		}
	})

	t.Run("oversized document is rejected before touching the store", func(t *testing.T) {
		backend := newFakeNavigationBackend()
		store := &navigationStore{backend: backend}

		links := make([]NavLink, 0, maxNavLinks)
		for i := 0; i < maxNavLinks; i++ {
			links = append(links, NavLink{
				Name: strings.Repeat("名", maxNavNameLength),
				URL:  "https://example.com/" + strings.Repeat("a", maxNavURLLength-100),
			})
		}

		categories := make([]NavCategory, 0, maxNavCategories)
		for i := 0; i < maxNavCategories; i++ {
			categories = append(categories, NavCategory{Name: strings.Repeat("类", maxNavNameLength), Links: links})
		}

		_, err := store.save(&navigationDocument{Categories: categories})
		navErr(t, "save", err)

		if !strings.Contains(err.Error(), "too large") {
			t.Fatalf("expected a size error, got %v", err)
		}

		navEq(t, "store untouched", 0, len(backend.values))
	})

	t.Run("kv failure is surfaced", func(t *testing.T) {
		backend := newFakeNavigationBackend()
		backend.setErr = model.NewAppError("KVSet", "app.plugin.kv_set.app_error", nil, "", 500)
		store := &navigationStore{backend: backend}

		_, err := store.save(&navigationDocument{Categories: []NavCategory{{Name: "内部系统"}}})
		navErr(t, "save", err)
	})
}

func TestSanitizeProductNavConfiguration(t *testing.T) {
	cfg := &configuration{ProductNavEnabled: true, ProductNavIconURL: "javascript:alert(1)"}
	cfg.sanitizeProductNav()
	navEq(t, "script icon rejected", "", cfg.ProductNavIconURL)

	cfg = &configuration{ProductNavEnabled: true, ProductNavIconURL: " https://example.com/nav.png "}
	cfg.sanitizeProductNav()
	navEq(t, "icon trimmed", "https://example.com/nav.png", cfg.ProductNavIconURL)
}

func TestSanitizeProductNavLinksPerRow(t *testing.T) {
	cases := []struct {
		in   int
		want int
	}{
		{0, DefaultProductNavLinksPerRow},
		{-3, DefaultProductNavLinksPerRow},
		{1, 1},
		{6, 6},
		{MaxProductNavLinksPerRow, MaxProductNavLinksPerRow},
		{MaxProductNavLinksPerRow + 1, DefaultProductNavLinksPerRow},
		{999, DefaultProductNavLinksPerRow},
	}

	for _, c := range cases {
		cfg := &configuration{ProductNavLinksPerRow: c.in}
		cfg.sanitizeProductNav()

		if cfg.ProductNavLinksPerRow != c.want {
			t.Fatalf("sanitize(%d) = %d, want %d", c.in, cfg.ProductNavLinksPerRow, c.want)
		}
	}
}
