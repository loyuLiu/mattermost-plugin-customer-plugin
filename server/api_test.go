package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
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

func TestGroupedTimeConfiguration(t *testing.T) {
	cfg := configuration{GroupedTimePosition: "  LEFT "}
	cfg.sanitize()
	if cfg.GroupedTimePosition != GroupedTimePositionLeft {
		t.Fatalf("expected %q, got %q", GroupedTimePositionLeft, cfg.GroupedTimePosition)
	}

	other := configuration{GroupedTimePosition: "nonsense"}
	other.sanitize()
	if other.GroupedTimePosition != GroupedTimePositionCursor {
		t.Fatalf("expected fallback to %q, got %q", GroupedTimePositionCursor, other.GroupedTimePosition)
	}

	p := newTestPlugin(&configuration{
		Enabled:               true,
		TimeFormat:            "HH:mm",
		GroupedTimeEnabled:    true,
		GroupedTimePosition:   GroupedTimePositionRight,
		GroupedTimeHideInline: true,
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/config", nil)
	req.Header.Set("Mattermost-User-ID", "user-id")
	w := httptest.NewRecorder()

	p.handleGetConfig(w, req)

	var got publicConfig
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if !got.GroupedTime.Enabled || got.GroupedTime.Position != GroupedTimePositionRight || !got.GroupedTime.HideInline {
		t.Fatalf("unexpected groupedTime payload: %+v", got.GroupedTime)
	}
}

func TestReadStatusConfiguration(t *testing.T) {
	p := newTestPlugin(&configuration{
		Enabled:           true,
		ReadStatusEnabled: true,
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/config", nil)
	req.Header.Set("Mattermost-User-ID", "user-id")
	w := httptest.NewRecorder()

	p.handleGetConfig(w, req)

	var got publicConfig
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if !got.ReadStatus.Enabled {
		t.Fatal("expected readStatus to be enabled")
	}

	off := newTestPlugin(&configuration{Enabled: true})
	w2 := httptest.NewRecorder()
	off.handleGetConfig(w2, httptest.NewRequest(http.MethodGet, "/api/v1/config", nil))

	var got2 publicConfig
	if err := json.Unmarshal(w2.Body.Bytes(), &got2); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if got2.ReadStatus.Enabled {
		t.Fatal("expected readStatus to stay disabled by default")
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

func TestPeerLastViewedAt(t *testing.T) {
	me := "me"
	peer := "peer"
	other := "other"

	t.Run("direct message uses the counterpart", func(t *testing.T) {
		members := model.ChannelMembers{
			{UserId: me, LastViewedAt: 500},
			{UserId: peer, LastViewedAt: 300},
		}

		position, isMember := peerLastViewedAt(members, me)
		if !isMember {
			t.Fatal("expected the requesting user to be a member")
		}
		if position != 300 {
			t.Fatalf("expected 300, got %d", position)
		}
	})

	t.Run("group message uses the least advanced counterpart", func(t *testing.T) {
		members := model.ChannelMembers{
			{UserId: me, LastViewedAt: 900},
			{UserId: peer, LastViewedAt: 700},
			{UserId: other, LastViewedAt: 400},
		}

		position, _ := peerLastViewedAt(members, me)
		if position != 400 {
			t.Fatalf("expected 400 (the least advanced), got %d", position)
		}
	})

	t.Run("own membership is never counted", func(t *testing.T) {
		members := model.ChannelMembers{{UserId: me, LastViewedAt: 100}}

		position, isMember := peerLastViewedAt(members, me)
		if !isMember {
			t.Fatal("expected the requesting user to be a member")
		}
		if position != 0 {
			t.Fatalf("expected 0 when there is no counterpart, got %d", position)
		}
	})

	t.Run("non member is rejected", func(t *testing.T) {
		members := model.ChannelMembers{{UserId: peer, LastViewedAt: 100}}

		if _, isMember := peerLastViewedAt(members, me); isMember {
			t.Fatal("expected the requesting user not to be a member")
		}
	})
}
