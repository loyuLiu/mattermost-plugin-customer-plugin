"use strict";
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.preferenceKey = exports.MAX_PRODUCT_NAV_LINKS_PER_ROW = exports.MIN_PRODUCT_NAV_LINKS_PER_ROW = exports.DEFAULT_PRODUCT_NAV_LINKS_PER_ROW = exports.PRODUCT_NAV_TITLE = exports.DEFAULT_BULK_DELETE_MAX_POSTS = exports.DEFAULT_GROUPED_POSITION = exports.RESYNC_INTERVAL_MS = exports.SELECTOR_ALL_TIMES = exports.SELECTOR_POST_TIME = exports.DEFAULT_FORMAT = exports.SETTING_USER_TIMEZONE = exports.SETTING_CUSTOM_FORMAT = exports.SETTING_TIME_SOURCE = exports.TIME_SOURCE_OFF = exports.TIME_SOURCE_CUSTOM = exports.TIME_SOURCE_SYSTEM = exports.PREFERENCE_CATEGORY = exports.PLUGIN_ID = void 0;
const manifest_1 = __importDefault(require("./manifest"));
exports.PLUGIN_ID = manifest_1.default.id;
/**
 * Preferences registered through `registerUserSettings` are stored with the
 * category `pp_<pluginId>` and the setting name as the preference name.
 * (See `components/user_settings/plugin/plugin_setting.tsx` in the webapp.)
 */
exports.PREFERENCE_CATEGORY = `pp_${exports.PLUGIN_ID}`;
/** Values stored for the `timeSource` user setting. */
exports.TIME_SOURCE_SYSTEM = 'system';
exports.TIME_SOURCE_CUSTOM = 'custom';
exports.TIME_SOURCE_OFF = 'off';
/** Names of the user-level settings registered through `registerUserSettings`. */
exports.SETTING_TIME_SOURCE = 'timeSource';
exports.SETTING_CUSTOM_FORMAT = 'customFormat';
exports.SETTING_USER_TIMEZONE = 'userTimeZone';
/** Fallback used if the server does not send a format. */
exports.DEFAULT_FORMAT = 'YYYY-MM-DD HH:mm';
/** CSS selectors driving the DOM rewrite. */
exports.SELECTOR_POST_TIME = 'time.post__time';
exports.SELECTOR_ALL_TIMES = 'time[datetime]';
/** How often we rescan the DOM as a safety net for virtualized lists. */
exports.RESYNC_INTERVAL_MS = 15000;
/** Where the floating timestamp of a merged post is anchored by default. */
exports.DEFAULT_GROUPED_POSITION = 'cursor';
/** Fallback batch size for bulk deletion, used when the server sends nothing. */
exports.DEFAULT_BULK_DELETE_MAX_POSTS = 500;
/** Title of the product navigation button and of its panel. */
exports.PRODUCT_NAV_TITLE = '产品导航';
/** Links shown on one row of a navigation category when the server says nothing. */
exports.DEFAULT_PRODUCT_NAV_LINKS_PER_ROW = 5;
/** Smallest and largest row size the administrator may ask for. */
exports.MIN_PRODUCT_NAV_LINKS_PER_ROW = 1;
exports.MAX_PRODUCT_NAV_LINKS_PER_ROW = 12;
function preferenceKey(name) {
    return `${exports.PREFERENCE_CATEGORY}--${name}`;
}
exports.preferenceKey = preferenceKey;
