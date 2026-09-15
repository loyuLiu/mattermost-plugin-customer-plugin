// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {getConfig} from 'mattermost-redux/selectors/entities/general';
import type {GlobalState} from '@mattermost/types/store';

import {PLUGIN_ID} from './constants';

/**
 * Builds the base URL of this plugin's own REST API, honouring a Mattermost
 * installation served from a sub-path (e.g. https://example.com/mattermost).
 */
export function getPluginUrl(state?: GlobalState): string {
    let basePath = '/';

    if (state) {
        const siteURL = getConfig(state)?.SiteURL;
        if (siteURL) {
            try {
                basePath = new URL(siteURL).pathname.replace(/\/+$/, '') || '/';
            } catch {
                basePath = '/';
            }
        }
    }

    return `${basePath}/plugins/${PLUGIN_ID}`.replace(/\/{2,}/g, '/');
}
