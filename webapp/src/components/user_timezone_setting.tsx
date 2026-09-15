// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useState} from 'react';
import {useSelector} from 'react-redux';
import type {GlobalState} from '@mattermost/types/store';

import {SETTING_USER_TIMEZONE} from '../constants';
import {useServerConfig} from '../hooks';
import {isValidTimeZone} from '../format';
import {getUserSetting} from '../user_settings';

type Props = {
    informChange: (name: string, value: string) => void;
};

/**
 * Optional per-user timezone override rendered inside the user settings modal.
 */
const UserTimeZoneSetting = ({informChange}: Props) => {
    const savedTimeZone = useSelector((state: GlobalState) => getUserSetting(state, SETTING_USER_TIMEZONE));
    const serverConfig = useServerConfig();

    const [value, setValue] = useState(savedTimeZone ?? '');

    useEffect(() => {
        informChange(SETTING_USER_TIMEZONE, value.trim());
    }, [value, informChange]);

    const placeholder = serverConfig?.timeZone || '浏览器本地时区';
    const invalid = value.trim() !== '' && !isValidTimeZone(value.trim());

    return (
        <div className='form-group customers-plugin__setting'>
            <label
                className='control-label'
                htmlFor='customers-plugin-user-timezone'
            >
                {'时区（可选）'}
            </label>
            <input
                id='customers-plugin-user-timezone'
                className='form-control'
                type='text'
                value={value}
                placeholder={placeholder}
                onChange={(e) => setValue(e.target.value)}
            />
            <div className='help-text'>
                {'填写 IANA 时区名，例如 Asia/Shanghai、America/New_York、UTC。留空则跟随' + placeholder + '。'}
            </div>
            {invalid && (
                <div className='alert alert-warning customers-plugin__warning'>
                    {'时区名称无效，请检查拼写。'}
                </div>
            )}
        </div>
    );
};

export default UserTimeZoneSetting;
