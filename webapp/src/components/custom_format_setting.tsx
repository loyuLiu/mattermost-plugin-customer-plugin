// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useMemo, useState} from 'react';
import {useSelector} from 'react-redux';
import {getCurrentUserLocale} from 'mattermost-redux/selectors/entities/i18n';
import type {GlobalState} from '@mattermost/types/store';

import {SETTING_CUSTOM_FORMAT, SETTING_USER_TIMEZONE} from '../constants';
import {useServerConfig} from '../hooks';
import {createFormatter, isValidTimeZone} from '../format';
import {getUserSetting} from '../user_settings';

type Props = {
    informChange: (name: string, value: string) => void;
};

const TOKEN_HELP = 'YYYY YY MMMM MMM MM M DD D dddd ddd HH H hh h mm m ss s SSS A a Z ZZ X x，方括号内为字面量，例如 YYYY年MM月DD日 HH:mm';

/**
 * Text input rendered inside the user settings modal. The webapp does not pass the
 * current value down, so it is read back from redux (preferences).
 */
const CustomFormatSetting = ({informChange}: Props) => {
    const savedFormat = useSelector((state: GlobalState) => getUserSetting(state, SETTING_CUSTOM_FORMAT));
    const savedTimeZone = useSelector((state: GlobalState) => getUserSetting(state, SETTING_USER_TIMEZONE));
    const locale = useSelector(getCurrentUserLocale);
    const serverConfig = useServerConfig();

    const [value, setValue] = useState(savedFormat ?? '');

    useEffect(() => {
        informChange(SETTING_CUSTOM_FORMAT, value);
    }, [value, informChange]);

    const placeholder = serverConfig?.timeFormat || 'YYYY-MM-DD HH:mm';
    const effectiveTimeZone = (savedTimeZone || serverConfig?.timeZone || '').trim() || undefined;
    const zoneIsValid = !effectiveTimeZone || isValidTimeZone(effectiveTimeZone);

    const preview = useMemo(() => {
        const format = value.trim() || placeholder;
        try {
            return createFormatter(format, locale, effectiveTimeZone)(new Date());
        } catch {
            return '（格式无效）';
        }
    }, [value, placeholder, locale, effectiveTimeZone]);

    return (
        <div className='form-group customers-plugin__setting'>
            <label
                className='control-label'
                htmlFor='customers-plugin-custom-format'
            >
                {'自定义时间格式'}
            </label>
            <input
                id='customers-plugin-custom-format'
                className='form-control'
                type='text'
                value={value}
                placeholder={placeholder}
                onChange={(e) => setValue(e.target.value)}
            />
            <div className='help-text'>
                {'留空则跟随系统默认。可用令牌：' + TOKEN_HELP}
            </div>
            <div className='help-text'>
                {'当前预览：' + preview}
            </div>
            {!zoneIsValid && (
                <div className='alert alert-warning customers-plugin__warning'>
                    {'时区无效，已回退到浏览器本地时区。'}
                </div>
            )}
        </div>
    );
};

export default CustomFormatSetting;
