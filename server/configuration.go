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

	// DefaultTimeFormat is used whenever the configured format is empty.
	DefaultTimeFormat = "YYYY-MM-DD HH:mm"
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
