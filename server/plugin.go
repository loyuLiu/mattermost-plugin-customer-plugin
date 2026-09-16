package main

import (
	"sync"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/model"
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

	// hist persists channel-join timestamps used by the history gate.
	hist *historyStore
}

// store returns the history store, wiring it up to the plugin API on first use.
func (p *Plugin) store() *historyStore {
	if p.hist == nil {
		if p.API == nil {
			return nil
		}

		p.hist = &historyStore{backend: p.API}
	}

	return p.hist
}

// OnActivate is invoked when the plugin is activated. If an error is returned,
// the plugin will be deactivated.
func (p *Plugin) OnActivate() error {
	p.router = p.initRouter()

	// Record the activation time so the "since_activation" legacy mode has a
	// stable value even if it is only enabled much later.
	if store := p.store(); store != nil {
		store.activatedAt(model.GetMillis())
	}

	return nil
}

// OnDeactivate is invoked when the plugin is deactivated.
func (p *Plugin) OnDeactivate() error {
	return nil
}

// UserHasJoinedChannel records the moment a user becomes a member of a channel.
// This is the authoritative "history boundary" for that (user, channel) pair:
// Mattermost does not expose a join timestamp on ChannelMember.
func (p *Plugin) UserHasJoinedChannel(_ *plugin.Context, channelMember *model.ChannelMember, _ *model.User) {
	if channelMember == nil {
		return
	}

	store := p.store()
	if store == nil {
		return
	}

	rec := &joinRecord{
		ChannelID: channelMember.ChannelId,
		UserID:    channelMember.UserId,
		JoinedAt:  model.GetMillis(),
	}

	if err := store.setJoin(rec); err != nil {
		p.API.LogError("failed to record channel join", "channel_id", rec.ChannelID, "error", err.Error())
	}
}

// UserHasLeftChannel drops the membership record so that re-joining starts from
// a fresh boundary instead of the original one.
func (p *Plugin) UserHasLeftChannel(_ *plugin.Context, channelMember *model.ChannelMember, _ *model.User) {
	if channelMember == nil {
		return
	}

	store := p.store()
	if store == nil {
		return
	}

	if err := store.deleteJoin(channelMember.UserId, channelMember.ChannelId); err != nil {
		p.API.LogError("failed to clear channel join", "channel_id", channelMember.ChannelId, "error", err.Error())
	}
}

// See https://developers.mattermost.com/extend/plugins/server/reference/
