// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import manifest from './manifest';
import type {Store} from 'redux';
import type {GlobalState} from '@mattermost/types/store';

import {getPluginUrl} from './base_url';
import {setBulkSelectActive} from './bulk_select';
import BulkDeleteBar from './components/bulk_delete_bar';
import BulkDeletePanel from './components/bulk_delete_panel';
import CustomFormatSetting from './components/custom_format_setting';
import TrashIcon from './components/icons';
import HistoryGateController from './components/history_gate_controller';
import ProductNavController from './components/product_nav_controller';
import ProductNavPanel from './components/product_nav_panel';
import ReadStatusController from './components/read_status_controller';
import TimeFormatController from './components/time_format_controller';
import UserTimeZoneSetting from './components/user_timezone_setting';
import {
    PLUGIN_ID,
    SETTING_CUSTOM_FORMAT,
    SETTING_TIME_SOURCE,
    SETTING_USER_TIMEZONE,
    TIME_SOURCE_CUSTOM,
    TIME_SOURCE_OFF,
    TIME_SOURCE_SYSTEM,
} from './constants';
import {fetchServerConfig, getCachedServerConfig, primeServerConfig} from './hooks';
import {installPostStreamFilter} from './post_stream_filter';
import {resolveBulkDelete} from './resolve';
import type {PluginRegistry} from './types/mattermost-webapp';

const userSettings = {
    id: PLUGIN_ID,
    uiName: manifest.name,
    sections: [
        {
            title: '时间显示',
            settings: [
                {
                    name: SETTING_TIME_SOURCE,
                    title: '时间格式来源',
                    helpText: '选择聊天窗口中时间的显示方式。',
                    type: 'radio' as const,
                    default: TIME_SOURCE_SYSTEM,
                    options: [
                        {
                            value: TIME_SOURCE_SYSTEM,
                            text: '跟随系统默认',
                            helpText: '使用系统控制台中管理员配置的格式。',
                        },
                        {
                            value: TIME_SOURCE_CUSTOM,
                            text: '自定义格式',
                            helpText: '在下方填写自己的格式字符串。',
                        },
                        {
                            value: TIME_SOURCE_OFF,
                            text: '关闭自定义显示',
                            helpText: '恢复 Mattermost 原本的相对时间显示。',
                        },
                    ],
                },
                {
                    name: SETTING_CUSTOM_FORMAT,
                    type: 'custom' as const,
                    component: CustomFormatSetting,
                },
                {
                    name: SETTING_USER_TIMEZONE,
                    type: 'custom' as const,
                    component: UserTimeZoneSetting,
                },
            ],
        },
    ],
};

export default class Plugin {
    public async initialize(registry: PluginRegistry, store: Store<GlobalState>) {
        // Must be the very first thing: the post-stream filter has to be in
        // place before this page load's first channel-posts request, or history
        // reaches the redux store and the DOM gate is back to racing the
        // virtualised list's height measurements.
        installPostStreamFilter({
            isEnabled: () => {
                const cached = getCachedServerConfig();
                return Boolean(cached?.history?.enabled && cached.history.mode !== 'off');
            },
            getPluginUrl: () => getPluginUrl(store.getState()),
            getUserId: () => store.getState().entities.users.currentUserId ?? '',
        });

        let config = null;
        try {
            config = await fetchServerConfig(getPluginUrl(store.getState()));
        } catch {
            // Offline / unauthenticated during bootstrap: the controller retries later.
            config = null;
        }
        primeServerConfig(config);

        registry.registerRootComponent(TimeFormatController);

        // Second feature: keep channel history away from members that joined later.
        registry.registerRootComponent(HistoryGateController);

        // Third feature: mark posts the current user has not read yet.
        registry.registerRootComponent(ReadStatusController);

        // Fourth feature: bulk delete, from the admin console and from a conversation.
        registry.registerRootComponent(BulkDeleteBar);
        registry.registerAdminConsoleCustomSetting('BulkDeletePanel', BulkDeletePanel, {showTitle: true});

        // Fifth feature: a directory of internal systems in the global header.
        registry.registerRootComponent(ProductNavController);
        registry.registerAdminConsoleCustomSetting('ProductNavPanel', ProductNavPanel, {showTitle: true});

        // The header button is only offered when the feature is switched on; otherwise
        // clicking it would open a mode whose every request is rejected.
        if (resolveBulkDelete(config).enabled) {
            registry.registerChannelHeaderButtonAction(
                <TrashIcon/>,
                () => setBulkSelectActive(true),
                '批量删除消息',
                '勾选消息并批量删除',
            );
        }

        if (config?.enabled && config.allowUserOverride) {
            registry.registerUserSettings(userSettings);
        }
    }
}

declare global {
    interface Window {
        registerPlugin(pluginId: string, plugin: Plugin): void;
    }
}

window.registerPlugin(manifest.id, new Plugin());
