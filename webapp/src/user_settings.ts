// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {getMyPreferences} from 'mattermost-redux/selectors/entities/preferences';
import type {PreferenceType} from '@mattermost/types/preferences';
import type {GlobalState} from '@mattermost/types/store';

import {preferenceKey} from './constants';

/**
 * Reads one of the user settings registered through `registerUserSettings`.
 * Those values are stored as a normal preference in the `pp_<pluginId>` category.
 */
export function getUserSetting(state: GlobalState, name: string): string | undefined {
    const key = preferenceKey(name);
    const preference = (getMyPreferences(state) as Record<string, PreferenceType>)[key];

    return preference?.value;
}

export function getUserSettingsMap(state: GlobalState): Record<string, string> {
    const preferences = getMyPreferences(state) as Record<string, PreferenceType>;
    const result: Record<string, string> = {};

    for (const [key, preference] of Object.entries(preferences)) {
        if (key.startsWith('pp_')) {
            result[key] = preference.value;
        }
    }

    return result;
}
