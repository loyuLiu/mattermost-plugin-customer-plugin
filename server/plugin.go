package main

import (
	"sync"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/plugin"
)

// Plugin implements the interface expected by the Mattermost server to communicate
// between the server and the plugin process.
type Plugin struct {
	plugin.MattermostPlugin

	// router serves the plugin's own REST API (mounted at /plugins/<id>/api/v1).
	router *mux.Router

	// configurationLock synchronizes access to the configuration.
	configurationLock sync.RWMutex

	// configuration is the active plugin configuration. Consult getConfiguration and
	// setConfiguration for usage.
	configuration *configuration
}

// OnActivate is invoked when the plugin is activated. If an error is returned,
// the plugin will be deactivated.
func (p *Plugin) OnActivate() error {
	p.router = p.initRouter()

	return nil
}

// OnDeactivate is invoked when the plugin is deactivated.
func (p *Plugin) OnDeactivate() error {
	return nil
}

// See https://developers.mattermost.com/extend/plugins/server/reference/
