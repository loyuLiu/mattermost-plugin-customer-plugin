// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useEffect, useMemo, useRef} from 'react';
import {useSelector} from 'react-redux';
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
import {useServerConfig} from '../hooks';
import {resolveEffectiveConfig} from '../resolve';
import {getUserSetting} from '../user_settings';
import TimeFormatEngine from '../time_engine';

/**
 * Invisible root component. It owns the DOM rewriting engine and keeps it in sync with
 * the effective configuration.
 */
const TimeFormatController = () => {
    const locale = useSelector(getCurrentUserLocale);
    const serverConfig = useServerConfig();

    const timeSource = useSelector((state: GlobalState) => getUserSetting(state, SETTING_TIME_SOURCE));
    const customFormat = useSelector((state: GlobalState) => getUserSetting(state, SETTING_CUSTOM_FORMAT));
    const userTimeZone = useSelector((state: GlobalState) => getUserSetting(state, SETTING_USER_TIMEZONE));

    const engine = useRef<TimeFormatEngine | null>(null);
    if (!engine.current) {
        engine.current = new TimeFormatEngine(RESYNC_INTERVAL_MS);
    }

    const effective = useMemo(
        () => resolveEffectiveConfig(serverConfig, {timeSource, customFormat, userTimeZone}),
        [serverConfig, timeSource, customFormat, userTimeZone],
    );

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

    useEffect(() => () => engine.current?.stop(), []);

    return null;
};

export default TimeFormatController;
