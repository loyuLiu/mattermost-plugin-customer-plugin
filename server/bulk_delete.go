package main

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
)

const (
	// postsPerPage is the page size used while walking a channel's history.
	postsPerPage = 200

	// maxScanPages caps one collection pass, so a huge channel cannot keep a request
	// running forever. 500 pages is 100k posts.
	maxScanPages = 500

	// deleteThrottle spaces deletes out a little, so that a purge of hundreds of posts
	// does not flush the same number of WebSocket broadcasts in one go.
	deleteThrottle = 10 * time.Millisecond

	// hardMaxPosts is the largest batch a single request may delete, whatever the
	// administrator configured.
	hardMaxPosts = 10000

	// sampleSize is the number of matched posts echoed back in a response, so the
	// caller can eyeball what is about to be removed.
	sampleSize = 10
)

// bulkFilter selects the posts to remove. Every field is optional; an empty filter
// matches every post of the channel.
type bulkFilter struct {
	// ChannelID is required: a purge always runs inside one conversation.
	ChannelID string `json:"channelId"`

	// UserID limits the purge to the posts of one author.
	UserID string `json:"userId"`

	// Keyword keeps only posts whose message contains it, case-insensitively.
	Keyword string `json:"keyword"`

	// TimeFrom / TimeTo bound the creation time, in milliseconds. Zero means open.
	TimeFrom int64 `json:"timeFrom"`
	TimeTo   int64 `json:"timeTo"`

	// Limit caps how many posts are collected. Zero means "use the configured default".
	Limit int `json:"limit"`
}

// bulkDeleteRequest is the body of the preview and the purge endpoints, and of the
// endpoint that deletes an explicit list of posts.
type bulkDeleteRequest struct {
	bulkFilter

	// PostIds is the explicit selection made in the channel UI. When it is set the
	// filter is ignored.
	PostIds []string `json:"postIds"`
}

// bulkPostInfo is a compact description of one matched post, used for previews.
type bulkPostInfo struct {
	ID       string `json:"id"`
	CreateAt int64  `json:"createAt"`
	UserID   string `json:"userId"`
	Message  string `json:"message"`
}

// bulkDeleteResponse reports what a preview or a purge found and did. `Matched` is the
// number of posts the caller is allowed to delete, which is what a preview shows.
type bulkDeleteResponse struct {
	ChannelID string         `json:"channelId"`
	Matched   int            `json:"matched"`
	Deleted   int            `json:"deleted"`
	Denied    int            `json:"denied"`
	Failed    int            `json:"failed"`
	Truncated bool           `json:"truncated"`
	Sample    []bulkPostInfo `json:"sample"`
}

// maxPostsFor resolves the batch limit of a request: an explicit limit wins, but it is
// clamped to what the administrator configured and to the hard ceiling.
func (p *Plugin) maxPostsFor(requested int) int {
	ceiling := p.getConfiguration().BulkDeleteMaxPosts
	if ceiling <= 0 || ceiling > hardMaxPosts {
		ceiling = hardMaxPosts
	}

	if requested <= 0 {
		return ceiling
	}

	if requested > ceiling {
		return ceiling
	}

	return requested
}

// matchesFilter reports whether a post satisfies every condition of the filter.
func matchesFilter(post *model.Post, filter bulkFilter) bool {
	if post == nil {
		return false
	}

	if filter.UserID != "" && post.UserId != filter.UserID {
		return false
	}

	if filter.TimeFrom > 0 && post.CreateAt < filter.TimeFrom {
		return false
	}

	if filter.TimeTo > 0 && post.CreateAt > filter.TimeTo {
		return false
	}

	if filter.Keyword != "" && !strings.Contains(strings.ToLower(post.Message), strings.ToLower(filter.Keyword)) {
		return false
	}

	return true
}

// isDescending reports whether a page of posts is ordered newest first. Channel history
// is served that way, and only then can the scan stop early once it walks past
// `TimeFrom` — otherwise it would silently skip older matches.
func isDescending(posts []*model.Post) bool {
	for i := 1; i < len(posts); i++ {
		if posts[i].CreateAt > posts[i-1].CreateAt {
			return false
		}
	}

	return true
}

// pageFetcher returns one page of a channel's history, newest first.
type pageFetcher func(page int) ([]*model.Post, error)

// scanPosts walks the pages from the newest post backwards and returns the posts
// matching the filter. The second result tells whether the scan stopped because the
// limit was reached rather than because the channel was exhausted.
//
// The early exit past `TimeFrom` only happens once a page has been seen to be ordered
// newest first; on an unordered list it would silently skip older matches.
func scanPosts(fetch pageFetcher, filter bulkFilter, limit int) ([]*model.Post, bool, error) {
	var matched []*model.Post

	descending := true
	firstPage := true

	for page := 0; page < maxScanPages; page++ {
		posts, err := fetch(page)
		if err != nil {
			return matched, false, err
		}

		if len(posts) == 0 {
			break
		}

		if firstPage {
			descending = isDescending(posts)
			firstPage = false
		}

		for _, post := range posts {
			if descending && filter.TimeFrom > 0 && post.CreateAt < filter.TimeFrom {
				return matched, false, nil
			}

			if !matchesFilter(post, filter) {
				continue
			}

			matched = append(matched, post)

			if len(matched) >= limit {
				return matched, true, nil
			}
		}

		if len(posts) < postsPerPage {
			break
		}
	}

	return matched, false, nil
}

// collectPosts is scanPosts bound to one channel of the server.
func (p *Plugin) collectPosts(filter bulkFilter, limit int) ([]*model.Post, bool, *model.AppError) {
	matched, truncated, err := scanPosts(func(page int) ([]*model.Post, error) {
		list, appErr := p.API.GetPostsForChannel(filter.ChannelID, page, postsPerPage)
		if appErr != nil {
			return nil, appErr
		}

		return list.ToSlice(), nil
	}, filter, limit)

	if err != nil {
		return matched, truncated, model.NewAppError("collectPosts", "app.post.collect.app_error", nil, err.Error(), http.StatusInternalServerError)
	}

	return matched, truncated, nil
}

// allowedToDelete decides one post against the four answers the permission layer can
// give. Kept free of the plugin API so that it can be tested on its own.
func allowedToDelete(post *model.Post, actorID string, isSystemAdmin, isOwnPost bool, mayDeletePost, mayDeleteOthersPosts bool) bool {
	if post == nil || actorID == "" {
		return false
	}

	if isSystemAdmin {
		return true
	}

	if isOwnPost {
		return mayDeletePost
	}

	return mayDeleteOthersPosts
}

// canDeletePost reports whether the actor may delete one post. Mattermost's own
// permission scheme decides: a system administrator may delete anything, everybody else
// needs the channel-scoped permission matching whose post it is.
func (p *Plugin) canDeletePost(actorID string, post *model.Post) bool {
	if post == nil {
		return false
	}

	isSystemAdmin := p.API.HasPermissionTo(actorID, model.PermissionManageSystem)
	isOwnPost := post.UserId == actorID
	mayDeletePost := p.API.HasPermissionToChannel(actorID, post.ChannelId, model.PermissionDeletePost)
	mayDeleteOthersPosts := p.API.HasPermissionToChannel(actorID, post.ChannelId, model.PermissionDeleteOthersPosts)

	return allowedToDelete(post, actorID, isSystemAdmin, isOwnPost, mayDeletePost, mayDeleteOthersPosts)
}

// deletePosts removes every post the actor is allowed to remove and counts the rest.
func (p *Plugin) deletePosts(actorID string, posts []*model.Post) (deleted, denied, failed int) {
	for i, post := range posts {
		if !p.canDeletePost(actorID, post) {
			denied++
			continue
		}

		if err := p.API.DeletePost(post.Id); err != nil {
			p.API.LogError("failed to delete post", "post_id", post.Id, "error", err.Error())
			failed++
			continue
		}

		deleted++

		if i < len(posts)-1 {
			time.Sleep(deleteThrottle)
		}
	}

	return deleted, denied, failed
}

// collectExplicit resolves an explicit list of post ids, keeping only the ones the
// actor may delete.
func (p *Plugin) collectExplicit(actorID string, ids []string) (allowed []*model.Post, denied, missing int) {
	for _, id := range ids {
		if id == "" {
			continue
		}

		post, err := p.API.GetPost(id)
		if err != nil || post == nil {
			missing++
			continue
		}

		if !p.canDeletePost(actorID, post) {
			denied++
			continue
		}

		allowed = append(allowed, post)
	}

	return allowed, denied, missing
}

// sampleOf renders the first posts of a match list for the response.
func sampleOf(posts []*model.Post) []bulkPostInfo {
	sample := make([]bulkPostInfo, 0, sampleSize)

	// Newest first is the most useful order for "what is about to be deleted".
	sorted := make([]*model.Post, len(posts))
	copy(sorted, posts)
	sort.SliceStable(sorted, func(i, j int) bool {
		return sorted[i].CreateAt > sorted[j].CreateAt
	})

	for i, post := range sorted {
		if i >= sampleSize {
			break
		}

		message := post.Message
		if len(message) > 200 {
			message = message[:200]
		}

		sample = append(sample, bulkPostInfo{
			ID:       post.Id,
			CreateAt: post.CreateAt,
			UserID:   post.UserId,
			Message:  message,
		})
	}

	return sample
}

// handleBulkDelete serves all three bulk endpoints: `preview` only counts, `purge`
// removes what the filter matched, and an explicit `postIds` list removes exactly those.
func (p *Plugin) handleBulkDelete(w http.ResponseWriter, r *http.Request, remove bool) {
	actorID := r.Header.Get("Mattermost-User-ID")

	if !p.getConfiguration().BulkDeleteEnabled {
		http.Error(w, "bulk delete is disabled", http.StatusForbidden)
		return
	}

	var req bulkDeleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	limit := p.maxPostsFor(req.Limit)
	response := bulkDeleteResponse{Sample: []bulkPostInfo{}}

	var posts []*model.Post

	if len(req.PostIds) > 0 {
		// An explicit selection is the channel UI's "delete what I ticked".
		allowed, denied, missing := p.collectExplicit(actorID, req.PostIds)
		posts = allowed
		response.Denied = denied
		response.Failed = missing
	} else {
		if req.ChannelID == "" {
			http.Error(w, "channelId is required", http.StatusBadRequest)
			return
		}

		var truncated bool
		var err *model.AppError

		posts, truncated, err = p.collectPosts(req.bulkFilter, limit)
		if err != nil {
			p.API.LogError("failed to collect posts", "channel_id", req.ChannelID, "error", err.Error())
			http.Error(w, "failed to collect posts", http.StatusInternalServerError)
			return
		}

		response.ChannelID = req.ChannelID
		response.Truncated = truncated
	}

	response.Matched = len(posts)
	response.Sample = sampleOf(posts)

	if remove {
		deleted, denied, failed := p.deletePosts(actorID, posts)
		response.Deleted = deleted
		response.Denied += denied
		response.Failed += failed
	}

	w.Header().Set("Content-Type", "application/json")

	if err := json.NewEncoder(w).Encode(response); err != nil {
		p.API.LogError("failed to write bulk delete response", "error", err.Error())
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// channelOption is one entry of the admin panel's channel picker.
type channelOption struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
	Type        string `json:"type"`
	TeamName    string `json:"teamName"`
}

// handleListChannels returns the conversations the requesting user can see, for the
// picker of the admin panel. Direct and group messages come last and carry the
// counterpart's name as their display name.
func (p *Plugin) handleListChannels(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")

	options := make([]channelOption, 0, 64)
	seen := make(map[string]bool)

	add := func(channel *model.Channel, teamName string) {
		if channel == nil || seen[channel.Id] {
			return
		}

		seen[channel.Id] = true
		options = append(options, channelOption{
			ID:          channel.Id,
			Name:        channel.Name,
			DisplayName: channel.DisplayName,
			Type:        string(channel.Type),
			TeamName:    teamName,
		})
	}

	teams, err := p.API.GetTeamsForUser(userID)
	if err != nil {
		p.API.LogError("failed to load teams", "error", err.Error())
		http.Error(w, "failed to load channels", http.StatusInternalServerError)
		return
	}

	for _, team := range teams {
		channels, appErr := p.API.GetChannelsForTeamForUser(team.Id, userID, false)
		if appErr != nil {
			continue
		}

		for _, channel := range channels {
			add(channel, team.DisplayName)
		}
	}

	// Conversations live outside any team; an empty team id addresses them.
	if conversations, appErr := p.API.GetChannelsForTeamForUser("", userID, false); appErr == nil {
		for _, channel := range conversations {
			add(channel, "")
		}
	}

	w.Header().Set("Content-Type", "application/json")

	if err := json.NewEncoder(w).Encode(options); err != nil {
		p.API.LogError("failed to write channel list", "error", err.Error())
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// handlePreviewPosts counts what a purge would remove without touching anything.
func (p *Plugin) handlePreviewPosts(w http.ResponseWriter, r *http.Request) {
	p.handleBulkDelete(w, r, false)
}

// handlePurgePosts removes the posts matching the filter.
func (p *Plugin) handlePurgePosts(w http.ResponseWriter, r *http.Request) {
	p.handleBulkDelete(w, r, true)
}

// handleDeletePosts removes an explicit list of posts.
func (p *Plugin) handleDeletePosts(w http.ResponseWriter, r *http.Request) {
	p.handleBulkDelete(w, r, true)
}
