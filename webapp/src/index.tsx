// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import manifest from './manifest';
import type {Store} from 'redux';
import type {GlobalState} from '@mattermost/types/store';

import {getPluginUrl} from './base_url';
import CustomFormatSetting from './components/custom_format_setting';
import HistoryGateController from './components/history_gate_controller';
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
import {fetchServerConfig, primeServerConfig} from './hooks';
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
