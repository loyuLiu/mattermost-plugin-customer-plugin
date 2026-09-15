package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func newTestPlugin(cfg *configuration) *Plugin {
	p := &Plugin{}
	if cfg != nil {
		p.setConfiguration(cfg)
	} else {
		p.setConfiguration(&configuration{})
	}

	return p
}

func TestConfigurationSanitize(t *testing.T) {
	cfg := configuration{
		Enabled:    true,
		TimeFormat: "   ",
		TimeZone:   "  Asia/Shanghai ",
		ApplyTo:    "ALL",
	}
	cfg.sanitize()

	if cfg.TimeFormat != DefaultTimeFormat {
		t.Fatalf("expected default time format %q, got %q", DefaultTimeFormat, cfg.TimeFormat)
	}
	if cfg.TimeZone != "Asia/Shanghai" {
		t.Fatalf("expected trimmed timezone, got %q", cfg.TimeZone)
	}
	if cfg.ApplyTo != ApplyToAll {
		t.Fatalf("expected %q, got %q", ApplyToAll, cfg.ApplyTo)
	}

	other := configuration{ApplyTo: "nonsense"}
	other.sanitize()
	if other.ApplyTo != ApplyToPost {
		t.Fatalf("expected fallback to %q, got %q", ApplyToPost, other.ApplyTo)
	}
}

func TestHandleGetConfig(t *testing.T) {
	p := newTestPlugin(&configuration{
		Enabled:           true,
		TimeFormat:        "YYYY-MM-DD HH:mm:ss",
		TimeZone:          "UTC",
		ApplyTo:           ApplyToPost,
		AllowUserOverride: true,
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/config", nil)
	req.Header.Set("Mattermost-User-ID", "user-id")
	w := httptest.NewRecorder()

	p.handleGetConfig(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var got publicConfig
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if got.TimeFormat != "YYYY-MM-DD HH:mm:ss" {
		t.Fatalf("unexpected format: %s", got.TimeFormat)
	}
	if !got.AllowUserOverride {
		t.Fatal("expected user override to be allowed")
	}
	if len(got.Presets) == 0 {
		t.Fatal("expected presets to be returned")
	}
}

func TestMattermostAuthorizationRequired(t *testing.T) {
	called := false
	handler := (&Plugin{}).MattermostAuthorizationRequired(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		called = true
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/config", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if called {
		t.Fatal("handler must not run without Mattermost-User-ID")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}
