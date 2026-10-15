// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import manifest from './manifest';

export const PLUGIN_ID: string = manifest.id;

/**
 * Preferences registered through `registerUserSettings` are stored with the
 * category `pp_<pluginId>` and the setting name as the preference name.
 * (See `components/user_settings/plugin/plugin_setting.tsx` in the webapp.)
 */
export const PREFERENCE_CATEGORY = `pp_${PLUGIN_ID}`;

/** Values stored for the `timeSource` user setting. */
export const TIME_SOURCE_SYSTEM = 'system';
export const TIME_SOURCE_CUSTOM = 'custom';
export const TIME_SOURCE_OFF = 'off';

/** Names of the user-level settings registered through `registerUserSettings`. */
export const SETTING_TIME_SOURCE = 'timeSource';
export const SETTING_CUSTOM_FORMAT = 'customFormat';
export const SETTING_USER_TIMEZONE = 'userTimeZone';

/** Fallback used if the server does not send a format. */
export const DEFAULT_FORMAT = 'YYYY-MM-DD HH:mm';

/** CSS selectors driving the DOM rewrite. */
export const SELECTOR_POST_TIME = 'time.post__time';
export const SELECTOR_ALL_TIMES = 'time[datetime]';

/** How often we rescan the DOM as a safety net for virtualized lists. */
export const RESYNC_INTERVAL_MS = 15000;

/** Where the floating timestamp of a merged post is anchored by default. */
export const DEFAULT_GROUPED_POSITION = 'cursor';

/** Fallback batch size for bulk deletion, used when the server sends nothing. */
export const DEFAULT_BULK_DELETE_MAX_POSTS = 500;

/** Title of the product navigation button and of its panel. */
export const PRODUCT_NAV_TITLE = '产品导航';

/**
 * Tooltip, and therefore `aria-label`, of the bulk-delete button in the channel
 * header. Shared with `product_nav.ts`, which recognises that button by this string
 * instead of by an identifier it cannot reliably derive.
 */
export const BULK_DELETE_TOOLTIP = '批量删除消息';

/**
 * The other string the bulk-delete button answers to.
 *
 * One of the two arguments `registerChannelHeaderButtonAction` takes is this longer
 * sentence, and which of the two builds end up copying onto the button's `aria-label`
 * is not something this plugin controls — several builds were seen carrying the other
 * one. Recognising both costs nothing; recognising only one and being wrong means the
 * button is never pinned at all.
 */
export const BULK_DELETE_TOOLTIP_ALT = '勾选消息并批量删除';

/** Links shown on one row of a navigation category when the server says nothing. */
export const DEFAULT_PRODUCT_NAV_LINKS_PER_ROW = 5;

/** Smallest and largest row size the administrator may ask for. */
export const MIN_PRODUCT_NAV_LINKS_PER_ROW = 1;
export const MAX_PRODUCT_NAV_LINKS_PER_ROW = 12;

export function preferenceKey(name: string): string {
    return `${PREFERENCE_CATEGORY}--${name}`;
}
