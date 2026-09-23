package main

import (
	"encoding/json"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
)

// maxPeerMembers caps the membership page read for a conversation. Direct messages
// hold two members and group messages at most eight, so one page is always enough.
const maxPeerMembers = 100

// publicConfig is what the webapp needs in order to render timestamps and to gate
// channel history. Only data that is safe to expose to every logged-in user belongs here.
type publicConfig struct {
	Enabled           bool              `json:"enabled"`
	TimeFormat        string            `json:"timeFormat"`
	TimeZone          string            `json:"timeZone"`
	ApplyTo           string            `json:"applyTo"`
	AllowUserOverride bool              `json:"allowUserOverride"`
	Presets           []Preset          `json:"presets"`
	History           historyConfig     `json:"history"`
	GroupedTime       groupedTimeConfig `json:"groupedTime"`
	ReadStatus        readStatusConfig  `json:"readStatus"`
	BulkDelete        bulkDeleteConfig  `json:"bulkDelete"`
}

// bulkDeleteConfig drives the bulk delete panel and the channel selection mode.
type bulkDeleteConfig struct {
	Enabled bool `json:"enabled"`
	MaxPost int  `json:"maxPosts"`
}

// readStatusConfig drives the dot marking posts the current user has not read yet.
type readStatusConfig struct {
	Enabled bool `json:"enabled"`
}

// groupedTimeConfig drives the floating timestamp shown for merged (consecutive) posts.
type groupedTimeConfig struct {
	Enabled    bool   `json:"enabled"`
	Position   string `json:"position"`
	HideInline bool   `json:"hideInline"`
}

// historyConfig is the history-gate part of the public configuration.
type historyConfig struct {
	Enabled       bool   `json:"enabled"`
	Mode          string `json:"mode"`
	NoticeEnabled bool   `json:"noticeEnabled"`
	NoticeText    string `json:"noticeText"`
	HideInSearch  bool   `json:"hideInSearch"`
}

// peerReadStateResponse is the counterpart's read position in a direct or group
// conversation: the point up to which *the other side* has read. `PeerLastViewedAt`
// is 0 when there is no other participant or when the position is unknown.
//
// For group conversations it is the smallest position of all other participants, so a
// message counts as read only once every counterpart has seen it.
type peerReadStateResponse struct {
	ChannelID        string `json:"channelId"`
	PeerLastViewedAt int64  `json:"peerLastViewedAt"`
}

// boundaryResponse is the per-channel answer to "how much history may this user see".
type boundaryResponse struct {
	Enabled    bool   `json:"enabled"`
	ChannelID  string `json:"channelId"`
	Mode       string `json:"mode"`
	JoinedAt   int64  `json:"joinedAt"`
	CutoffAt   int64  `json:"cutoffAt"`
	ServerTime int64  `json:"serverTime"`
}

// setBoundaryRequest is the admin-only payload used to backfill or clear a boundary.
type setBoundaryRequest struct {
	ChannelID string `json:"channelId"`
	UserID    string `json:"userId"`

	// CutoffAt of 0 means "use now".
	CutoffAt int64 `json:"cutoffAt"`

	// Clear removes the record, restoring full visibility.
	Clear bool `json:"clear"`
}

// initRouter initializes the HTTP router for the plugin.
func (p *Plugin) initRouter() *mux.Router {
	router := mux.NewRouter()

	// Every endpoint below requires a logged-in user.
	router.Use(p.MattermostAuthorizationRequired)

	apiRouter := router.PathPrefix("/api/v1").Subrouter()
	apiRouter.HandleFunc("/config", p.handleGetConfig).Methods(http.MethodGet)
	apiRouter.HandleFunc("/history/boundary", p.handleGetBoundary).Methods(http.MethodGet)
	apiRouter.HandleFunc("/history/boundary", p.handleSetBoundary).Methods(http.MethodPost)
	apiRouter.HandleFunc("/read/peer", p.handleGetPeerReadState).Methods(http.MethodGet)
	apiRouter.HandleFunc("/posts/query", p.handlePreviewPosts).Methods(http.MethodPost)
	apiRouter.HandleFunc("/posts/purge", p.handlePurgePosts).Methods(http.MethodPost)
	apiRouter.HandleFunc("/posts/delete", p.handleDeletePosts).Methods(http.MethodPost)

	// Feeds the channel picker of the admin console panel.
	apiRouter.HandleFunc("/channels", p.handleListChannels).Methods(http.MethodGet)

	return router
}

// ServeHTTP serves the plugin HTTP API. The root URL is
// <siteUrl>/plugins/com.example.customers-plugin/api/v1.
func (p *Plugin) ServeHTTP(c *plugin.Context, w http.ResponseWriter, r *http.Request) {
	p.router.ServeHTTP(w, r)
}

// MattermostAuthorizationRequired rejects requests that were not authenticated by
// the Mattermost server. The server injects the Mattermost-User-ID header only for
// requests that carry a valid session/token.
func (p *Plugin) MattermostAuthorizationRequired(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Mattermost-User-ID") == "" {
			http.Error(w, "Not authorized", http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// handleGetConfig returns the configuration needed by the webapp.
func (p *Plugin) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	config := p.getConfiguration()

	w.Header().Set("Content-Type", "application/json")

	response := publicConfig{
		Enabled:           config.Enabled,
		TimeFormat:        config.TimeFormat,
		TimeZone:          config.TimeZone,
		ApplyTo:           config.ApplyTo,
		AllowUserOverride: config.AllowUserOverride,
		Presets:           fixedPresets,
		History: historyConfig{
			Enabled:       config.HistoryLockEnabled,
			Mode:          config.HistoryMode,
			NoticeEnabled: config.HistoryNoticeEnabled,
			NoticeText:    config.HistoryNoticeText,
			HideInSearch:  config.HideInSearch,
		},
		GroupedTime: groupedTimeConfig{
			Enabled:    config.GroupedTimeEnabled,
			Position:   config.GroupedTimePosition,
			HideInline: config.GroupedTimeHideInline,
		},
		ReadStatus: readStatusConfig{
			Enabled: config.ReadStatusEnabled,
		},
		BulkDelete: bulkDeleteConfig{
			Enabled: config.BulkDeleteEnabled,
			MaxPost: config.BulkDeleteMaxPosts,
		},
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		p.API.LogError("failed to write configuration response", "error", err.Error())
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// peerLastViewedAt picks the read position of the other participants out of a channel's
// membership list. The smallest one wins, so a group message stays "unread" until every
// counterpart has seen it. The second return value reports whether the user is a member
// of the conversation at all, which gates access to the endpoint.
func peerLastViewedAt(members model.ChannelMembers, userID string) (int64, bool) {
	isMember := false
	var position int64

	for _, member := range members {
		if member.UserId == userID {
			isMember = true
			continue
		}

		if position == 0 || member.LastViewedAt < position {
			position = member.LastViewedAt
		}
	}

	return position, isMember
}

// handleGetPeerReadState returns how far the counterpart of a direct or group
// conversation has read. It is what lets a user see whether *the other side* has read
// the messages she sent; her own read position is already in the webapp store.
func (p *Plugin) handleGetPeerReadState(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")
	channelID := r.URL.Query().Get("channel_id")
	if channelID == "" {
		http.Error(w, "channel_id is required", http.StatusBadRequest)
		return
	}

	members, err := p.API.GetChannelMembers(channelID, 0, maxPeerMembers)
	if err != nil {
		p.API.LogError("failed to load channel members", "channel_id", channelID, "error", err.Error())
		http.Error(w, "failed to load channel members", http.StatusInternalServerError)
		return
	}

	position, isMember := peerLastViewedAt(members, userID)
	if !isMember {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	channel, err := p.API.GetChannel(channelID)
	if err != nil {
		p.API.LogError("failed to load channel", "channel_id", channelID, "error", err.Error())
		http.Error(w, "failed to load channel", http.StatusInternalServerError)
		return
	}

	// Only conversations have a counterpart. Channels have no single "other side", so
	// no peer position is exposed for them.
	if channel.Type != model.ChannelTypeDirect && channel.Type != model.ChannelTypeGroup {
		position = 0
	}

	w.Header().Set("Content-Type", "application/json")

	response := peerReadStateResponse{
		ChannelID:        channelID,
		PeerLastViewedAt: position,
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		p.API.LogError("failed to write peer read state response", "error", err.Error())
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// handleGetBoundary returns the history boundary of the requesting user for one channel.
func (p *Plugin) handleGetBoundary(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")
	channelID := r.URL.Query().Get("channel_id")
	if channelID == "" {
		http.Error(w, "channel_id is required", http.StatusBadRequest)
		return
	}

	now := model.GetMillis()

	cutoff, err := p.computeCutoff(userID, channelID, now)
	if err != nil {
		p.API.LogError("failed to compute history boundary", "channel_id", channelID, "error", err.Error())
		http.Error(w, "failed to compute boundary", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	response := boundaryResponse{
		Enabled:    cutoff.Enabled,
		ChannelID:  channelID,
		Mode:       cutoff.Mode,
		JoinedAt:   cutoff.JoinedAt,
		CutoffAt:   cutoff.CutoffAt,
		ServerTime: now,
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		p.API.LogError("failed to write boundary response", "error", err.Error())
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// handleSetBoundary lets a system administrator backfill or clear a boundary, which
// is the only way to apply the gate to members that joined before the plugin was
// installed without removing them from the channel first.
func (p *Plugin) handleSetBoundary(w http.ResponseWriter, r *http.Request) {
	actorID := r.Header.Get("Mattermost-User-ID")
	if !p.API.HasPermissionTo(actorID, model.PermissionManageSystem) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	store := p.store()
	if store == nil {
		http.Error(w, "plugin is not ready", http.StatusServiceUnavailable)
		return
	}

	var req setBoundaryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.ChannelID == "" || req.UserID == "" {
		http.Error(w, "channelId and userId are required", http.StatusBadRequest)
		return
	}

	if req.Clear {
		if err := store.deleteJoin(req.UserID, req.ChannelID); err != nil {
			p.API.LogError("failed to clear boundary", "error", err.Error())
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}

		w.WriteHeader(http.StatusNoContent)
		return
	}

	cutoffAt := req.CutoffAt
	if cutoffAt <= 0 {
		cutoffAt = model.GetMillis()
	}

	rec, err := store.getJoin(req.UserID, req.ChannelID)
	if err != nil {
		p.API.LogError("failed to read boundary", "error", err.Error())
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if rec == nil {
		rec = &joinRecord{ChannelID: req.ChannelID, UserID: req.UserID}
	}

	rec.JoinedAt = cutoffAt
	rec.Manual = true

	if err := store.setJoin(rec); err != nil {
		p.API.LogError("failed to store boundary", "error", err.Error())
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
