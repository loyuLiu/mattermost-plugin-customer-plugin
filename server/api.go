package main

import (
	"encoding/json"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/plugin"
)

// publicConfig is what the webapp needs in order to render timestamps. Only data
// that is safe to expose to every logged-in user belongs here.
type publicConfig struct {
	Enabled           bool     `json:"enabled"`
	TimeFormat        string   `json:"timeFormat"`
	TimeZone          string   `json:"timeZone"`
	ApplyTo           string   `json:"applyTo"`
	AllowUserOverride bool     `json:"allowUserOverride"`
	Presets           []Preset `json:"presets"`
}

// initRouter initializes the HTTP router for the plugin.
func (p *Plugin) initRouter() *mux.Router {
	router := mux.NewRouter()

	// Every endpoint below requires a logged-in user.
	router.Use(p.MattermostAuthorizationRequired)

	apiRouter := router.PathPrefix("/api/v1").Subrouter()
	apiRouter.HandleFunc("/config", p.handleGetConfig).Methods(http.MethodGet)

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

// handleGetConfig returns the time-formatting configuration for the webapp.
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
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		p.API.LogError("failed to write configuration response", "error", err.Error())
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}
