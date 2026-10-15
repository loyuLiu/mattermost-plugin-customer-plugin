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
import ProductNavIcon from './components/product_nav_icon';
import ProductNavPanel from './components/product_nav_panel';
import ProductNavSidebar from './components/product_nav_sidebar';
import ReadStatusController from './components/read_status_controller';
import TimeFormatController from './components/time_format_controller';
import UserTimeZoneSetting from './components/user_timezone_setting';
import {
    PLUGIN_ID,
    BULK_DELETE_TOOLTIP,
    BULK_DELETE_TOOLTIP_ALT,
    PRODUCT_NAV_TITLE,
    SETTING_CUSTOM_FORMAT,
    SETTING_TIME_SOURCE,
    SETTING_USER_TIMEZONE,
    TIME_SOURCE_CUSTOM,
    TIME_SOURCE_OFF,
    TIME_SOURCE_SYSTEM,
} from './constants';
import ErrorBoundary from './components/error_boundary';
import {installCrashReporter, recordCrash, setCrashBannerEnabled} from './crash_report';
import {installDomGuard} from './dom_guard';
import {fetchServerConfig, getCachedServerConfig, primeServerConfig} from './hooks';
import {installPostStreamFilter} from './post_stream_filter';
import {fetchNavigation} from './product_nav_api';
import {
    blurHeaderButtonFocus,
    countUsableNavLinks,
    exposeHeaderDiagnostic,
    hasNavEntries,
    installNavStyle,
    logHeaderStartupBaseline,
    noteHeaderRegistration,
    syncHeaderButtonQuietStyle,
} from './product_nav';
import {setNavDocument} from './product_nav_store';
import {resolveBulkDelete, resolveProductNav} from './resolve';
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

/**
 * Wraps a component so that a throw inside it cannot unmount Mattermost's tree.
 *
 * Every component registered below renders alongside the host's own, and React
 * unmounts the whole tree on an uncaught throw — a blank page is that, not a plugin
 * that quietly failed. The boundary records the error and renders nothing, which for
 * an invisible controller is the same as never having mounted.
 */
const withBoundary = (Component: React.ComponentType): React.ComponentType => {
    const Wrapped = () => (
        <ErrorBoundary>
            <Component/>
        </ErrorBoundary>
    );

    return Wrapped;
};

export default class Plugin {
    public async initialize(registry: PluginRegistry, store: Store<GlobalState>): Promise<void> {
        // Must be the very first thing: a page that comes up blank on a phone has no
        // console to read, so anything this plugin throws has to land somewhere a
        // person can actually see it.
        installCrashReporter();
        // Second guard, same reason: the phone white-screen was React dying inside
        // its own commit (a `removeChild` that threw because the node had moved),
        // where no error boundary can reach. The guard makes that one native call
        // tolerant and records every time it had to step in.
        installDomGuard();

        try {
            await this.setup(registry, store);
        } catch (error) {
            // A plugin that fails to start must not take the host page down with it.
            recordCrash(error, 'initialize');
        }
    }

    private async setup(registry: PluginRegistry, store: Store<GlobalState>): Promise<void> {
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

        // The banner is off unless the administrator asked for it. Errors are recorded
        // either way, so nothing is lost by keeping the page clean; the switch is at
        // System Console → Plugins → Customers Plugin → 页面崩溃提示横幅, and
        // `localStorage.setItem('customers-plugin:crash-banner', 'on')` turns it on
        // for one debugging session without touching the settings.
        setCrashBannerEnabled(Boolean(config?.crashBanner));

        registry.registerRootComponent(withBoundary(TimeFormatController));

        // Second feature: keep channel history away from members that joined later.
        registry.registerRootComponent(withBoundary(HistoryGateController));

        // Third feature: mark posts the current user has not read yet.
        registry.registerRootComponent(withBoundary(ReadStatusController));

        // Fourth feature: bulk delete, from the admin console and from a conversation.
        registry.registerRootComponent(withBoundary(BulkDeleteBar));
        registry.registerAdminConsoleCustomSetting('BulkDeletePanel', withBoundary(BulkDeletePanel), {showTitle: true});

        // Fifth feature: a directory of internal systems, opened from a button in the
        // channel header and shown in Mattermost's own right-hand sidebar.
        //
        // The component, not an element: Mattermost keeps what it is given and renders
        // it with `createElement`, so a `<ProductNavSidebar/>` here lands in React as an
        // element used as a type — React error #130, "got: object".
        //
        // The registry hands back the actions that open, close and toggle the sidebar,
        // so the button below can close over the toggle instead of parking it.
        const navRhs = registry.registerRightHandSidebarComponent(withBoundary(ProductNavSidebar), PRODUCT_NAV_TITLE);

        const navSettings = resolveProductNav(config);
        if (navSettings.enabled) {
            // Installed before the button is registered: the body needs the grid rules
            // from the first render of the sidebar onwards.
            installNavStyle(navSettings.linksPerRow);

            // The button is only offered when there is something to show — an empty
            // sidebar is worse than no button — so the entries are read here, while the
            // plugin is starting, and handed to the sidebar through the store.
            const navigation = await fetchNavigation(getPluginUrl(store.getState())).catch(() => null);

            const links = navigation ? countUsableNavLinks(navigation.categories) : 0;
            noteHeaderRegistration('productNav', links > 0, links > 0 ? `${links} 条可用` : '没有可用条目');

            if (hasNavEntries(navigation)) {
                setNavDocument(navigation);

                // Registered before the bulk-delete button so it renders first, i.e. to
                // its left: `ChannelHeaderPlug` renders plugin buttons in registration
                // order and only folds them into a dropdown past 15 of them.
                //
                // Nothing is collected from the return value any more. The identifier
                // it hands back is not the one the rendered button carries, so rules
                // built from it never matched a single thing on the page — which is why
                // every earlier attempt at pinning these buttons did nothing. The
                // buttons are found in the DOM instead; see `product_nav.ts`.
                registry.registerChannelHeaderButtonAction(
                    <ErrorBoundary>
                        <ProductNavIcon iconUrl={navSettings.iconUrl}/>
                    </ErrorBoundary>,
                    () => {
                        // Cut from the same cloth as the bulk-delete button's
                        // callback below: one concern, one line each, no detours.
                        //
                        // The sidebar and the tick-the-message selection are two
                        // different modes of this plugin. Opening the sidebar steps
                        // out of the selection on purpose: leaving it on would keep
                        // the bulk-delete button looking switched on while nothing is
                        // ticked, and would leave tick boxes on rows the user has
                        // moved away from.
                        setBulkSelectActive(false);

                        // The focus ring goes with it. Opening the sidebar re-flows
                        // the header, and a ring left where the pointer used to be
                        // reads as the neighbouring button being switched on.
                        blurHeaderButtonFocus();

                        store.dispatch(navRhs.toggleRHSPlugin);

                        // The only thing of the other two that stays in the click.
                        // The channel header is usually not mounted when the plugin
                        // starts, so the pinning above can come up empty and nothing
                        // else looks again after it. Re-pinning is idempotent: a click
                        // costs a search and, at worst, one rewrite of the sheet.
                        syncHeaderButtonQuietStyle();
                    },
                    PRODUCT_NAV_TITLE,
                    PRODUCT_NAV_TITLE,
                );
            }
        }

        registry.registerAdminConsoleCustomSetting('ProductNavPanel', withBoundary(ProductNavPanel), {showTitle: true});

        // The header button is only offered when the feature is switched on; otherwise
        // clicking it would open a mode whose every request is rejected.
        //
        // The callback is the shape both header buttons follow: whatever the button
        // is for, the click does that one thing. Nothing in here reaches towards the
        // other button, and nothing in here prints.
        const bulkDeleteOn = resolveBulkDelete(config).enabled;
        noteHeaderRegistration('bulkDelete', bulkDeleteOn, bulkDeleteOn ? '开关已开' : '开关未开');

        if (bulkDeleteOn) {
            registry.registerChannelHeaderButtonAction(
                <ErrorBoundary>
                    <TrashIcon/>
                </ErrorBoundary>,
                () => setBulkSelectActive(true),
                BULK_DELETE_TOOLTIP,
                BULK_DELETE_TOOLTIP_ALT,
            );
        }

        // The two header buttons share one React tree and one stylesheet, and clicking
        // one used to leave the other looking lit. Nothing in `HeaderIconWrapper`
        // carries state, so what lit up was painted by the sheet; the way out is not
        // to guess which state it was but to make every state look the same.
        //
        // This finds the buttons rather than deriving them, and retries while the
        // channel view has not mounted them yet.
        syncHeaderButtonQuietStyle();

        // One reading, taken while the sidebar is still closed: the header's state
        // before the click, which no reading taken after the click can stand in for.
        // A button that only exists before the click shows up here and nowhere else.
        //
        // This is the only reading the plugin takes on its own, and it waits for the
        // header and for both registration decisions above before printing. After it
        // the diagnostic waits to be asked — `customersPluginDiag('点导航后')` in the
        // console, or the `customers-plugin:diag` flag for every one of them — so
        // that a click does not quietly run four rounds of computed styles behind
        // the user's back.
        exposeHeaderDiagnostic();
        logHeaderStartupBaseline();

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
