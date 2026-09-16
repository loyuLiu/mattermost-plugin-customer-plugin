package main

import (
	"encoding/json"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/pkg/errors"
)

// History visibility modes.
const (
	// HistoryModeOff disables history hiding entirely.
	HistoryModeOff = "off"

	// HistoryModeSinceJoin hides every message sent before the member joined the channel.
	HistoryModeSinceJoin = "since_join"

	// HistoryModeRecentDays hides every message older than HistoryDays days, for every member.
	HistoryModeRecentDays = "recent_days"
)

// How to treat members that joined a channel before this plugin was installed,
// i.e. members without a recorded join time.
const (
	// LegacyMemberShowAll leaves their history untouched. This is the safe default:
	// installing the plugin never takes history away from existing members.
	LegacyMemberShowAll = "show_all"

	// LegacyMemberSinceActivation uses the plugin's first activation time as their boundary.
	LegacyMemberSinceActivation = "since_activation"
)

const (
	// activatedAtKey records when the plugin was first activated.
	activatedAtKey = "activated_at"

	// joinKeyPrefix prefixes every per-(user, channel) membership record.
	joinKeyPrefix = "join_"
)

// joinRecord is persisted per (user, channel) pair. It is the authoritative source
// for "when did this user join this channel", which Mattermost itself does not
// expose through the plugin API.
type joinRecord struct {
	ChannelID string `json:"channelId"`
	UserID    string `json:"userId"`
	JoinedAt  int64  `json:"joinedAt"`

	// Manual marks records created through the admin endpoint rather than by the
	// UserHasJoinedChannel hook.
	Manual bool `json:"manual,omitempty"`
}

// historyBackend is the slice of the plugin API used by this feature. Keeping it
// as an interface is what makes the logic below unit testable without a server.
type historyBackend interface {
	KVSet(key string, value []byte) *model.AppError
	KVGet(key string) ([]byte, *model.AppError)
	KVDelete(key string) *model.AppError
	HasPermissionTo(userID string, permission *model.Permission) bool
}

// Cutoff is the computed history boundary for one (user, channel) pair.
type Cutoff struct {
	// Enabled is false when the feature is off, the mode is off, or the user is exempt.
	Enabled bool

	// Mode is the effective mode that produced this cutoff.
	Mode string

	// JoinedAt is the recorded join time, or 0 when unknown.
	JoinedAt int64

	// CutoffAt is an exclusive lower bound in milliseconds: messages with
	// CreateAt < CutoffAt must be hidden. Zero means "no restriction".
	CutoffAt int64
}

// joinKey builds the KV key for a membership record. Mattermost IDs never contain
// underscores, so the key can be split back apart safely.
func joinKey(userID, channelID string) string {
	return joinKeyPrefix + userID + "_" + channelID
}

// historyStore wraps the plugin KV store with typed accessors.
type historyStore struct {
	backend historyBackend

	mu sync.Mutex // guards the activated-at initialisation
}

func (s *historyStore) setJoin(rec *joinRecord) error {
	data, err := json.Marshal(rec)
	if err != nil {
		return errors.Wrap(err, "failed to marshal join record")
	}

	if appErr := s.backend.KVSet(joinKey(rec.UserID, rec.ChannelID), data); appErr != nil {
		return errors.Wrap(appErr, "failed to store join record")
	}

	return nil
}

// getJoin returns nil (and a nil error) when no record exists.
func (s *historyStore) getJoin(userID, channelID string) (*joinRecord, error) {
	data, appErr := s.backend.KVGet(joinKey(userID, channelID))
	if appErr != nil {
		return nil, errors.Wrap(appErr, "failed to read join record")
	}

	if len(data) == 0 {
		return nil, nil
	}

	rec := new(joinRecord)
	if err := json.Unmarshal(data, rec); err != nil {
		return nil, errors.Wrap(err, "failed to decode join record")
	}

	return rec, nil
}

func (s *historyStore) deleteJoin(userID, channelID string) error {
	if appErr := s.backend.KVDelete(joinKey(userID, channelID)); appErr != nil {
		return errors.Wrap(appErr, "failed to delete join record")
	}

	return nil
}

// activatedAt returns the first activation time of the plugin, recording it on
// first use. It is only consulted for the "since_activation" legacy mode.
func (s *historyStore) activatedAt(now int64) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()

	payload := struct {
		At int64 `json:"at"`
	}{}

	if data, appErr := s.backend.KVGet(activatedAtKey); appErr == nil && len(data) > 0 {
		if err := json.Unmarshal(data, &payload); err == nil && payload.At > 0 {
			return payload.At
		}
	}

	payload.At = now
	if encoded, err := json.Marshal(payload); err == nil {
		_ = s.backend.KVSet(activatedAtKey, encoded)
	}

	return now
}

// computeCutoff resolves the history boundary for a user in a channel.
func (p *Plugin) computeCutoff(userID, channelID string, now int64) (Cutoff, error) {
	cfg := p.getConfiguration()
	out := Cutoff{Mode: cfg.HistoryMode}

	if !cfg.HistoryLockEnabled || cfg.HistoryMode == HistoryModeOff {
		return out, nil
	}

	store := p.store()
	if store == nil {
		return out, nil
	}

	if cfg.ExemptSystemAdmins && store.backend.HasPermissionTo(userID, model.PermissionManageSystem) {
		return out, nil
	}

	rec, err := store.getJoin(userID, channelID)
	if err != nil {
		return out, err
	}

	var cutoff int64

	switch cfg.HistoryMode {
	case HistoryModeRecentDays:
		// A rolling window that applies to everyone, independent of join time.
		cutoff = now - int64(cfg.historyDays)*int64(24*time.Hour/time.Millisecond)

	default: // HistoryModeSinceJoin
		switch {
		case rec != nil:
			cutoff = rec.JoinedAt
			out.JoinedAt = rec.JoinedAt

		case cfg.LegacyMemberMode == LegacyMemberSinceActivation:
			cutoff = store.activatedAt(now)

		default:
			// No join record and the admin asked us not to touch legacy members.
			return out, nil
		}
	}

	if cutoff <= 0 {
		return out, nil
	}

	out.Enabled = true
	out.CutoffAt = cutoff

	return out, nil
}

// sanitizeHistoryDays parses the textual admin setting into a sane number of days.
func sanitizeHistoryDays(raw string, fallback int) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fallback
	}

	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return fallback
	}

	// Upper bound keeps the arithmetic in check and guards against typos.
	if value > 3650 {
		return 3650
	}

	return value
}
