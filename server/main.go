// Package main implements the Customers Plugin for Mattermost.
//
// It customizes how timestamps are rendered in the Mattermost web app, letting
// system admins (and optionally each user) define an explicit date/time format
// such as "YYYY-MM-DD HH:mm".
package main

import (
	"github.com/mattermost/mattermost/server/public/plugin"
)

func main() {
	plugin.ClientMain(&Plugin{})
}
