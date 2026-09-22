// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useEffect, useMemo, useRef} from 'react';
import {useSelector, useStore} from 'react-redux';
import {getCurrentUserLocale} from 'mattermost-redux/selectors/entities/i18n';
import type {GlobalState} from '@mattermost/types/store';

import {
    RESYNC_INTERVAL_MS,
    SELECTOR_ALL_TIMES,
    SELECTOR_POST_TIME,
    SETTING_CUSTOM_FORMAT,
    SETTING_TIME_SOURCE,
    SETTING_USER_TIMEZONE,
} from '../constants';
import {GroupedTimeOverlay} from '../grouped_time';
import {useServerConfig} from '../hooks';
import {resolveEffectiveConfig, resolveGroupedConfig} from '../resolve';
import {getUserSetting} from '../user_settings';
import TimeFormatEngine from '../time_engine';

/**
 * Invisible root component. It owns the DOM rewriting engine and keeps it in sync with
 * the effective configuration. It also drives the floating timestamp shown while
 * hovering a merged (consecutive) post.
 */
const TimeFormatController = () => {
    const store = useStore<GlobalState>();
    const locale = useSelector(getCurrentUserLocale);
    const serverConfig = useServerConfig();

    const timeSource = useSelector((state: GlobalState) => getUserSetting(state, SETTING_TIME_SOURCE));
    const customFormat = useSelector((state: GlobalState) => getUserSetting(state, SETTING_CUSTOM_FORMAT));
    const userTimeZone = useSelector((state: GlobalState) => getUserSetting(state, SETTING_USER_TIMEZONE));

    const engine = useRef<TimeFormatEngine | null>(null);
    if (!engine.current) {
        engine.current = new TimeFormatEngine(RESYNC_INTERVAL_MS);
    }

    const storeRef = useRef(store);
    storeRef.current = store;

    const overlay = useRef<GroupedTimeOverlay | null>(null);
    if (!overlay.current) {
        overlay.current = new GroupedTimeOverlay({
            getCreateAt: (postId: string) => {
                const post = storeRef.current.getState().entities.posts.posts[postId];
                return post ? post.create_at : undefined;
            },
        });
    }

    const effective = useMemo(
        () => resolveEffectiveConfig(serverConfig, {timeSource, customFormat, userTimeZone}),
        [serverConfig, timeSource, customFormat, userTimeZone],
    );

    const grouped = useMemo(() => resolveGroupedConfig(serverConfig), [serverConfig]);

    useEffect(() => {
        if (!effective.enabled) {
            engine.current?.stop();
            return;
        }

        engine.current?.update({
            selector: effective.applyTo === 'all' ? SELECTOR_ALL_TIMES : SELECTOR_POST_TIME,
            format: effective.format,
            locale,
            timeZone: effective.timeZone || undefined,
        });
    }, [effective, locale]);

    useEffect(() => {
        if (!effective.enabled || !grouped.enabled) {
            overlay.current?.stop();
            return;
        }

        overlay.current?.update({
            format: effective.format,
            locale,
            timeZone: effective.timeZone || undefined,
            position: grouped.position,
            hideInline: grouped.hideInline,
        });
    }, [effective, grouped, locale]);

    useEffect(() => () => {
        engine.current?.stop();
        overlay.current?.stop();
    }, []);

    return null;
};

export default TimeFormatController;
