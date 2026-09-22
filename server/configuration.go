package main

import (
	"strings"

	"github.com/pkg/errors"
)

// Constants exposed to the webapp through GET /api/v1/config.
const (
	// ApplyToPost limits formatting change to the timestamp rendered next to each post.
	ApplyToPost = "post"

	// ApplyToAll formats every <time datetime="..."> element rendered by the webapp.
	ApplyToAll = "all"

	// GroupedTimePositionCursor keeps the floating timestamp next to the pointer.
	GroupedTimePositionCursor = "cursor"

	// GroupedTimePositionLeft anchors it to the left edge of the merged post.
	GroupedTimePositionLeft = "left"

	// GroupedTimePositionRight anchors it to the top-right corner of the merged post.
	GroupedTimePositionRight = "right"

	// DefaultTimeFormat is used whenever the configured format is empty.
	DefaultTimeFormat = "YYYY-MM-DD HH:mm"

	// DefaultHistoryDays is the rolling window used by HistoryModeRecentDays.
	DefaultHistoryDays = 7

	// DefaultHistoryNoticeText is shown above the hidden part of a channel.
	DefaultHistoryNoticeText = "此消息及之前的消息发送于你加入本频道之前，已隐藏"
)

// fixedPresets are offered to the user in the user-settings panel as a shortcut.
// The webapp receives them from GET /api/v1/config so that a single place defines them.
var fixedPresets = []Preset{
	{Value: "", Text: "跟随系统默认"},
	{Value: "YYYY-MM-DD HH:mm", Text: "2026-09-15 09:42"},
	{Value: "YYYY-MM-DD HH:mm:ss", Text: "2026-09-15 09:42:07"},
	{Value: "YYYY/MM/DD HH:mm", Text: "2026/09/15 09:42"},
	{Value: "YYYY年MM月DD日 HH:mm", Text: "2026年09月15日 09:42"},
	{Value: "MM-DD HH:mm", Text: "09-15 09:42"},
	{Value: "dddd HH:mm", Text: "星期二 09:42"},
	{Value: "HH:mm", Text: "09:42"},
}

// Preset describes a shortcut offered in the user-settings panel.
type Preset struct {
	Value string `json:"value"`
	Text  string `json:"text"`
}

// configuration captures the plugin's external configuration as exposed in the
// Mattermost system console, as well as values computed from the configuration.
// Any public fields will be deserialized from the Mattermost server configuration
// in OnConfigurationChange.
//
// As plugins are inherently concurrent (hooks being called asynchronously), and the
// plugin configuration can change at any time, access to the configuration must be
// synchronized. The strategy used in this plugin is to guard a pointer to the
// configuration, and clone the entire struct whenever it changes.
type configuration struct {
	// Enabled turns the whole feature on or off for the entire server.
	Enabled bool

	// TimeFormat is the default format string, e.g. "YYYY-MM-DD HH:mm".
	TimeFormat string

	// TimeZone is an IANA timezone name. Empty means "use the browser timezone".
	TimeZone string

	// ApplyTo is either ApplyToPost or ApplyToAll.
	ApplyTo string

	// AllowUserOverride decides whether users may override the admin defaults.
	AllowUserOverride bool

	// ---------------------------------------------------------------------
	// Merged (consecutive) posts: floating timestamp
	// ---------------------------------------------------------------------

	// GroupedTimeEnabled shows the timestamp of merged posts in a floating box.
	GroupedTimeEnabled bool

	// GroupedTimePosition is one of GroupedTimePositionCursor, GroupedTimePositionLeft
	// or GroupedTimePositionRight.
	GroupedTimePosition string

	// GroupedTimeHideInline hides the timestamp Mattermost renders inside the post
	// header while hovering a merged post, so the value is not shown twice.
	GroupedTimeHideInline bool

	// ---------------------------------------------------------------------
	// Channel history visibility (second feature)
	// ---------------------------------------------------------------------

	// HistoryLockEnabled is the master switch for hiding channel history.
	HistoryLockEnabled bool

	// HistoryMode is one of HistoryModeOff, HistoryModeSinceJoin or HistoryModeRecentDays.
	HistoryMode string

	// HistoryDays is the textual admin setting for the rolling window; sanitize()
	// parses it into historyDays.
	HistoryDays string

	// LegacyMemberMode decides what happens to members that joined before the
	// plugin was installed: LegacyMemberShowAll or LegacyMemberSinceActivation.
	LegacyMemberMode string

	// HistoryNoticeEnabled shows a hint above the hidden part of the channel.
	HistoryNoticeEnabled bool

	// HistoryNoticeText is the hint text.
	HistoryNoticeText string

	// HideInSearch also hides affected messages in search results and the
	// right-hand side (threads, pinned, saved) panels.
	HideInSearch bool

	// ExemptSystemAdmins lets system administrators see the full history.
	ExemptSystemAdmins bool

	// historyDays is the parsed value of HistoryDays. It is not deserialized
	// from the admin console.
	historyDays int
}

// Clone shallow copies the configuration. Your implementation may require a deep
// copy if your configuration has reference types.
func (c *configuration) Clone() *configuration {
	clone := *c
	return &clone
}

// sanitize trims user input and replaces invalid values with safe defaults.
func (c *configuration) sanitize() {
	c.TimeFormat = strings.TrimSpace(c.TimeFormat)
	if c.TimeFormat == "" {
		c.TimeFormat = DefaultTimeFormat
	}

	c.TimeZone = strings.TrimSpace(c.TimeZone)

	c.ApplyTo = strings.ToLower(strings.TrimSpace(c.ApplyTo))
	if c.ApplyTo != ApplyToAll {
		c.ApplyTo = ApplyToPost
	}

	c.sanitizeHistory()
	c.sanitizeGroupedTime()
}

// sanitizeGroupedTime normalises the floating-timestamp settings.
func (c *configuration) sanitizeGroupedTime() {
	c.GroupedTimePosition = strings.ToLower(strings.TrimSpace(c.GroupedTimePosition))
	switch c.GroupedTimePosition {
	case GroupedTimePositionLeft, GroupedTimePositionRight:
		// valid
	default:
		c.GroupedTimePosition = GroupedTimePositionCursor
	}
}

// sanitizeHistory normalises the channel-history settings.
func (c *configuration) sanitizeHistory() {
	c.HistoryMode = strings.ToLower(strings.TrimSpace(c.HistoryMode))
	switch c.HistoryMode {
	case HistoryModeOff, HistoryModeRecentDays:
		// valid
	default:
		c.HistoryMode = HistoryModeSinceJoin
	}

	c.historyDays = sanitizeHistoryDays(c.HistoryDays, DefaultHistoryDays)

	c.LegacyMemberMode = strings.ToLower(strings.TrimSpace(c.LegacyMemberMode))
	if c.LegacyMemberMode != LegacyMemberSinceActivation {
		c.LegacyMemberMode = LegacyMemberShowAll
	}

	c.HistoryNoticeText = strings.TrimSpace(c.HistoryNoticeText)
	if c.HistoryNoticeText == "" {
		c.HistoryNoticeText = DefaultHistoryNoticeText
	}
}

// getConfiguration retrieves the active configuration under lock, making it safe to
// use concurrently. The active configuration may change underneath the client of this
// method, but the struct returned by this API call is considered immutable.
func (p *Plugin) getConfiguration() *configuration {
	p.configurationLock.RLock()
	defer p.configurationLock.RUnlock()

	if p.configuration == nil {
		return &configuration{}
	}

	return p.configuration
}

// setConfiguration replaces the active configuration under lock.
//
// Do not call setConfiguration while holding the configurationLock, as sync.Mutex is not
// reentrant. In particular, avoid using the plugin API entirely, as this may in turn
// trigger a hook back into the plugin.
func (p *Plugin) setConfiguration(cfg *configuration) {
	p.configurationLock.Lock()
	defer p.configurationLock.Unlock()

	if cfg != nil && p.configuration == cfg {
		// Ignore assignment if the configuration struct is empty. Go will optimize the
		// allocation for same to point at the same memory address, breaking the check above.
		if *cfg == (configuration{}) {
			return
		}

		panic("setConfiguration called with the existing configuration")
	}

	p.configuration = cfg
}

// OnConfigurationChange is invoked when configuration changes may have been made.
func (p *Plugin) OnConfigurationChange() error {
	cfg := new(configuration)

	// Load the public configuration fields from the Mattermost server configuration.
	if err := p.API.LoadPluginConfiguration(cfg); err != nil {
		return errors.Wrap(err, "failed to load plugin configuration")
	}

	cfg.sanitize()

	p.setConfiguration(cfg)

	return nil
}
