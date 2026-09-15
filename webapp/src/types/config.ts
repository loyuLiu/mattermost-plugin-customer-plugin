// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/** Shape returned by the plugin's own `GET /api/v1/config` endpoint. */
export type Preset = {
    value: string;
    text: string;
};

export type ServerConfig = {
    enabled: boolean;
    timeFormat: string;
    timeZone: string;
    applyTo: 'post' | 'all';
    allowUserOverride: boolean;
    presets: Preset[];
};

/** Resolved configuration actually used to rewrite the DOM. */
export type EffectiveConfig = {
    enabled: boolean;
    format: string;
    timeZone: string;
    applyTo: 'post' | 'all';
};
