package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
)

// fakeBackend is an in-memory historyBackend.
type fakeBackend struct {
	kv     map[string][]byte
	admins map[string]bool
}

func newFakeBackend() *fakeBackend {
	return &fakeBackend{kv: map[string][]byte{}, admins: map[string]bool{}}
}

func (f *fakeBackend) KVSet(key string, value []byte) *model.AppError {
	f.kv[key] = value
	return nil
}

func (f *fakeBackend) KVGet(key string) ([]byte, *model.AppError) {
	return f.kv[key], nil
}

func (f *fakeBackend) KVDelete(key string) *model.AppError {
	delete(f.kv, key)
	return nil
}

func (f *fakeBackend) HasPermissionTo(userID string, _ *model.Permission) bool {
	return f.admins[userID]
}

func newHistoryTestPlugin(cfg *configuration, backend historyBackend) *Plugin {
	// Tests build the struct directly, so run the same normalisation the server would.
	cfg.sanitize()

	p := newTestPlugin(cfg)
	p.hist = &historyStore{backend: backend}
	return p
}

func TestJoinRecordRoundTrip(t *testing.T) {
	backend := newFakeBackend()
	store := &historyStore{backend: backend}

	if rec, err := store.getJoin("u1", "c1"); err != nil || rec != nil {
		t.Fatalf("expected no record, got %v / %v", rec, err)
	}

	if err := store.setJoin(&joinRecord{UserID: "u1", ChannelID: "c1", JoinedAt: 42}); err != nil {
		t.Fatalf("setJoin failed: %v", err)
	}

	rec, err := store.getJoin("u1", "c1")
	if err != nil || rec == nil {
		t.Fatalf("expected a record, got %v / %v", rec, err)
	}
	if rec.JoinedAt != 42 {
		t.Fatalf("unexpected join time %d", rec.JoinedAt)
	}

	if err := store.deleteJoin("u1", "c1"); err != nil {
		t.Fatalf("deleteJoin failed: %v", err)
	}
	if rec, _ := store.getJoin("u1", "c1"); rec != nil {
		t.Fatal("record should be gone")
	}
}

func TestActivatedAtIsStable(t *testing.T) {
	store := &historyStore{backend: newFakeBackend()}

	first := store.activatedAt(1000)
	if first != 1000 {
		t.Fatalf("expected 1000, got %d", first)
	}

	second := store.activatedAt(2000)
	if second != 1000 {
		t.Fatalf("activation time must not move, got %d", second)
	}
}

func TestComputeCutoffSinceJoin(t *testing.T) {
	backend := newFakeBackend()
	p := newHistoryTestPlugin(&configuration{
		HistoryLockEnabled: true,
		HistoryMode:        HistoryModeSinceJoin,
		HistoryDays:        "7",
	}, backend)

	if err := p.store().setJoin(&joinRecord{UserID: "u1", ChannelID: "c1", JoinedAt: 5000}); err != nil {
		t.Fatalf("setJoin failed: %v", err)
	}

	cutoff, err := p.computeCutoff("u1", "c1", 9000)
	if err != nil {
		t.Fatalf("computeCutoff failed: %v", err)
	}

	if !cutoff.Enabled || cutoff.CutoffAt != 5000 || cutoff.JoinedAt != 5000 {
		t.Fatalf("unexpected cutoff: %+v", cutoff)
	}
}

func TestComputeCutoffWithoutRecord(t *testing.T) {
	backend := newFakeBackend()

	// Default: legacy members keep their history.
	p := newHistoryTestPlugin(&configuration{
		HistoryLockEnabled: true,
		HistoryMode:        HistoryModeSinceJoin,
	}, backend)

	cutoff, err := p.computeCutoff("u1", "c1", 9000)
	if err != nil {
		t.Fatalf("computeCutoff failed: %v", err)
	}
	if cutoff.Enabled {
		t.Fatalf("expected no restriction, got %+v", cutoff)
	}

	// With since_activation the plugin activation time becomes the boundary.
	p2 := newHistoryTestPlugin(&configuration{
		HistoryLockEnabled: true,
		HistoryMode:        HistoryModeSinceJoin,
		LegacyMemberMode:   LegacyMemberSinceActivation,
	}, backend)

	cutoff2, err := p2.computeCutoff("u1", "c1", 9000)
	if err != nil {
		t.Fatalf("computeCutoff failed: %v", err)
	}
	if !cutoff2.Enabled || cutoff2.CutoffAt != 9000 {
		t.Fatalf("expected cutoff at activation (9000), got %+v", cutoff2)
	}
}

func TestComputeCutoffRecentDays(t *testing.T) {
	p := newHistoryTestPlugin(&configuration{
		HistoryLockEnabled: true,
		HistoryMode:        HistoryModeRecentDays,
		HistoryDays:        "2",
	}, newFakeBackend())

	const now = int64(10 * 24 * 60 * 60 * 1000) // 10 days in millis
	cutoff, err := p.computeCutoff("u1", "c1", now)
	if err != nil {
		t.Fatalf("computeCutoff failed: %v", err)
	}

	want := now - int64(2*24*60*60*1000)
	if !cutoff.Enabled || cutoff.CutoffAt != want {
		t.Fatalf("expected cutoff %d, got %+v", want, cutoff)
	}
}

func TestComputeCutoffDisabledAndExempt(t *testing.T) {
	backend := newFakeBackend()
	backend.admins["admin"] = true

	off := newHistoryTestPlugin(&configuration{HistoryMode: HistoryModeOff}, backend)
	if cutoff, _ := off.computeCutoff("u1", "c1", 100); cutoff.Enabled {
		t.Fatal("mode off must not restrict anything")
	}

	disabled := newHistoryTestPlugin(&configuration{HistoryLockEnabled: false, HistoryMode: HistoryModeSinceJoin}, backend)
	if cutoff, _ := disabled.computeCutoff("u1", "c1", 100); cutoff.Enabled {
		t.Fatal("master switch off must not restrict anything")
	}

	// Exempt admins: the admin sees everything, a normal member does not.
	p := newHistoryTestPlugin(&configuration{
		HistoryLockEnabled: true,
		HistoryMode:        HistoryModeSinceJoin,
		ExemptSystemAdmins: true,
		LegacyMemberMode:   LegacyMemberSinceActivation,
	}, backend)

	if cutoff, _ := p.computeCutoff("admin", "c1", 9000); cutoff.Enabled {
		t.Fatal("exempt admin must not be restricted")
	}
	if cutoff, _ := p.computeCutoff("u1", "c1", 9000); !cutoff.Enabled {
		t.Fatal("normal member must still be restricted")
	}
}

func TestSanitizeHistoryDays(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{"", 7},
		{"  3 ", 3},
		{"abc", 7},
		{"0", 7},
		{"-5", 7},
		{"99999", 3650},
	}

	for _, c := range cases {
		if got := sanitizeHistoryDays(c.in, 7); got != c.want {
			t.Fatalf("sanitizeHistoryDays(%q) = %d, want %d", c.in, got, c.want)
		}
	}
}

func TestConfigurationSanitizeHistory(t *testing.T) {
	cfg := configuration{
		HistoryMode:       "  RECENT_DAYS ",
		HistoryDays:       "30",
		LegacyMemberMode:  "nonsense",
		HistoryNoticeText: "  ",
	}
	cfg.sanitize()

	if cfg.HistoryMode != HistoryModeRecentDays {
		t.Fatalf("expected recent_days, got %q", cfg.HistoryMode)
	}
	if cfg.historyDays != 30 {
		t.Fatalf("expected 30 days, got %d", cfg.historyDays)
	}
	if cfg.LegacyMemberMode != LegacyMemberShowAll {
		t.Fatalf("expected show_all fallback, got %q", cfg.LegacyMemberMode)
	}
	if cfg.HistoryNoticeText != DefaultHistoryNoticeText {
		t.Fatalf("expected default notice text, got %q", cfg.HistoryNoticeText)
	}

	other := configuration{HistoryMode: "bogus"}
	other.sanitize()
	if other.HistoryMode != HistoryModeSinceJoin {
		t.Fatalf("expected since_join fallback, got %q", other.HistoryMode)
	}
}

func TestConfigurationSanitizePendingPolicy(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"", HistoryPendingBlank},
		{"  ", HistoryPendingBlank},
		{"nonsense", HistoryPendingBlank},
		{"SHOW", HistoryPendingShow},
		{" blank ", HistoryPendingBlank},
	}

	for _, c := range cases {
		cfg := configuration{HistoryPendingPolicy: c.in}
		cfg.sanitize()
		if cfg.HistoryPendingPolicy != c.want {
			t.Fatalf("sanitize(%q) = %q, want %q", c.in, cfg.HistoryPendingPolicy, c.want)
		}
	}
}

// failBackend makes every read fail, which is how the batch endpoint is supposed to
// answer "unknown" rather than "unrestricted".
type failBackend struct {
	*fakeBackend
}

func (f *failBackend) KVGet(key string) ([]byte, *model.AppError) {
	return nil, model.NewAppError("KVGet", "boom", nil, "", http.StatusInternalServerError)
}

func TestUserHasJoinedAndLeftChannel(t *testing.T) {
	backend := newFakeBackend()
	p := newHistoryTestPlugin(&configuration{}, backend)

	p.UserHasJoinedChannel(nil, &model.ChannelMember{ChannelId: "c1", UserId: "u1"}, nil)

	rec, err := p.store().getJoin("u1", "c1")
	if err != nil || rec == nil {
		t.Fatalf("join was not recorded: %v / %v", rec, err)
	}
	if rec.Manual {
		t.Fatal("hook-created record must not be marked manual")
	}

	p.UserHasLeftChannel(nil, &model.ChannelMember{ChannelId: "c1", UserId: "u1"}, nil)
	if rec, _ := p.store().getJoin("u1", "c1"); rec != nil {
		t.Fatal("leaving the channel must clear the boundary")
	}
}

func TestHandleGetBoundary(t *testing.T) {
	backend := newFakeBackend()
	p := newHistoryTestPlugin(&configuration{
		HistoryLockEnabled: true,
		HistoryMode:        HistoryModeSinceJoin,
	}, backend)

	if err := p.store().setJoin(&joinRecord{UserID: "u1", ChannelID: "c1", JoinedAt: 5000}); err != nil {
		t.Fatalf("setJoin failed: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/history/boundary?channel_id=c1", nil)
	req.Header.Set("Mattermost-User-ID", "u1")
	w := httptest.NewRecorder()

	p.handleGetBoundary(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var got boundaryResponse
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("failed to decode: %v", err)
	}
	if !got.Enabled || got.CutoffAt != 5000 || got.ChannelID != "c1" {
		t.Fatalf("unexpected response: %+v", got)
	}

	missing := httptest.NewRequest(http.MethodGet, "/api/v1/history/boundary", nil)
	missing.Header.Set("Mattermost-User-ID", "u1")
	w2 := httptest.NewRecorder()
	p.handleGetBoundary(w2, missing)
	if w2.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 without channel_id, got %d", w2.Code)
	}
}

func TestHandleGetBoundaries(t *testing.T) {
	backend := newFakeBackend()
	p := newHistoryTestPlugin(&configuration{
		HistoryLockEnabled: true,
		HistoryMode:        HistoryModeSinceJoin,
	}, backend)

	for _, rec := range []joinRecord{
		{UserID: "u1", ChannelID: "c1", JoinedAt: 5000},
		{UserID: "u1", ChannelID: "c2", JoinedAt: 7000},
	} {
		toStore := rec
		if err := p.store().setJoin(&toStore); err != nil {
			t.Fatalf("setJoin failed: %v", err)
		}
	}

	post := func(body string) *boundariesResponse {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/history/boundaries", strings.NewReader(body))
		req.Header.Set("Mattermost-User-ID", "u1")
		w := httptest.NewRecorder()

		p.handleGetBoundaries(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
		}

		var got boundariesResponse
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
			t.Fatalf("failed to decode: %v", err)
		}

		return &got
	}

	got := post(`{"channelIds":["c1","c2","c3","c1",""]}`)

	if got.Cutoffs["c1"] != 5000 || got.Cutoffs["c2"] != 7000 {
		t.Fatalf("unexpected cutoffs: %+v", got.Cutoffs)
	}
	if _, present := got.Cutoffs["c3"]; !present || got.Cutoffs["c3"] != 0 {
		t.Fatalf("an unrestricted channel must be answered with 0, got %+v", got.Cutoffs)
	}
	if len(got.Cutoffs) != 3 {
		t.Fatalf("duplicates and blanks must collapse, got %+v", got.Cutoffs)
	}

	// A channel that cannot be resolved is omitted on purpose: the webapp reads a
	// missing entry as "unknown" and keeps hiding, instead of trusting a zero.
	broken := newHistoryTestPlugin(&configuration{
		HistoryLockEnabled: true,
		HistoryMode:        HistoryModeSinceJoin,
	}, &failBackend{fakeBackend: newFakeBackend()})

	partial, partialErr := broken.collectBoundaries("u1", []string{"c1"}, 10000)
	if partialErr == nil {
		t.Fatal("expected the failure to be reported to the caller")
	}
	if len(partial) != 0 {
		t.Fatalf("a failed channel must be left out of the map, got %+v", partial)
	}

	// Malformed bodies are the caller's fault.
	bad := httptest.NewRequest(http.MethodPost, "/api/v1/history/boundaries", strings.NewReader(`not json`))
	bad.Header.Set("Mattermost-User-ID", "u1")
	badW := httptest.NewRecorder()
	p.handleGetBoundaries(badW, bad)
	if badW.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for a malformed body, got %d", badW.Code)
	}

	// The cap keeps one request from turning into thousands of KV reads.
	many := make([]string, 0, maxBoundaryChannels+10)
	for i := 0; i < maxBoundaryChannels+10; i++ {
		many = append(many, "c"+strconv.Itoa(i))
	}
	encoded, err := json.Marshal(boundariesRequest{ChannelIDs: many})
	if err != nil {
		t.Fatalf("failed to encode: %v", err)
	}

	if capped := post(string(encoded)); len(capped.Cutoffs) > maxBoundaryChannels {
		t.Fatalf("expected at most %d entries, got %d", maxBoundaryChannels, len(capped.Cutoffs))
	}
}
