// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {
    DEFAULT_BULK_DELETE_MAX_POSTS,
    DEFAULT_FORMAT,
    DEFAULT_GROUPED_POSITION,
    TIME_SOURCE_CUSTOM,
    TIME_SOURCE_OFF,
    TIME_SOURCE_SYSTEM,
} from './constants';
import type {
    BulkDeleteSettings,
    EffectiveConfig,
    GroupedTimeSettings,
    ReadStatusSettings,
    ServerConfig,
} from './types/config';

/** Values a user can store in her own preferences. */
export type UserOverrides = {
    timeSource?: string;
    customFormat?: string;
    userTimeZone?: string;
};

/**
 * Merges the admin-provided server configuration with the current user's own overrides.
 *
 * Precedence (highest first):
 *   1. the whole feature is disabled server side  -> off
 *   2. the user turned the feature off            -> off
 *   3. the user picked "custom"                   -> user format / user timezone
 *   4. the admin defaults
 */
export function resolveEffectiveConfig(serverConfig: ServerConfig | null, user: UserOverrides = {}): EffectiveConfig {
    const fallback: EffectiveConfig = {enabled: false, format: DEFAULT_FORMAT, timeZone: '', applyTo: 'post'};

    if (!serverConfig || !serverConfig.enabled) {
        return fallback;
    }

    const applyTo = serverConfig.applyTo === 'all' ? 'all' : 'post';
    const defaultFormat = serverConfig.timeFormat || DEFAULT_FORMAT;

    if (!serverConfig.allowUserOverride) {
        return {enabled: true, format: defaultFormat, timeZone: serverConfig.timeZone || '', applyTo};
    }

    const source = user.timeSource || TIME_SOURCE_SYSTEM;

    if (source === TIME_SOURCE_OFF) {
        return {...fallback, applyTo};
    }

    if (source === TIME_SOURCE_CUSTOM) {
        const customFormat = (user.customFormat || '').trim();
        const userTimeZone = (user.userTimeZone || '').trim();

        return {
            enabled: true,
            format: customFormat || defaultFormat,
            timeZone: userTimeZone || serverConfig.timeZone || '',
            applyTo,
        };
    }

    return {enabled: true, format: defaultFormat, timeZone: serverConfig.timeZone || '', applyTo};
}

/**
 * Settings of the floating timestamp shown for merged posts.
 *
 * Older builds of the plugin server do not send `groupedTime`, in which case the
 * feature stays on with the defaults below.
 */
export function resolveGroupedConfig(serverConfig: ServerConfig | null): GroupedTimeSettings {
    const grouped = serverConfig?.groupedTime;
    if (!grouped) {
        return {enabled: true, position: DEFAULT_GROUPED_POSITION, hideInline: true};
    }

    const position = grouped.position === 'left' || grouped.position === 'right' ? grouped.position : DEFAULT_GROUPED_POSITION;

    return {
        enabled: grouped.enabled !== false,
        position,
        hideInline: grouped.hideInline !== false,
    };
}

/**
 * Settings of the dot marking unread posts.
 *
 * Older builds of the plugin server do not send `readStatus`; unlike the other
 * sections this one then stays off, because it adds a visible marker to every post
 * list and must not appear unless an administrator opted in.
 */
export function resolveReadStatus(serverConfig: ServerConfig | null): ReadStatusSettings {
    const readStatus = serverConfig?.readStatus;
    if (!readStatus) {
        return {enabled: false};
    }

    return {enabled: readStatus.enabled === true};
}

/**
 * Settings of the bulk delete feature.
 *
 * Deleting other people's messages is destructive and irreversible, so this one stays
 * off unless the administrator switched it on in the plugin settings — including when
 * talking to an older build of the plugin server that never sends `bulkDelete`.
 */
export function resolveBulkDelete(serverConfig: ServerConfig | null): BulkDeleteSettings {
    const bulkDelete = serverConfig?.bulkDelete;
    if (!bulkDelete) {
        return {enabled: false, maxPosts: DEFAULT_BULK_DELETE_MAX_POSTS};
    }

    const maxPosts = Number(bulkDelete.maxPosts) > 0 ? Number(bulkDelete.maxPosts) : DEFAULT_BULK_DELETE_MAX_POSTS;

    return {enabled: bulkDelete.enabled === true, maxPosts};
}
