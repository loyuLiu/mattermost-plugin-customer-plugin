// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useEffect, useState} from 'react';
import {useSelector} from 'react-redux';
import type {GlobalState} from '@mattermost/types/store';

import {getPluginUrl} from './base_url';
import type {ServerConfig} from './types/config';

let cachedConfig: ServerConfig | null = null;

/** Seeds the cache so that components do not need to refetch. */
export function primeServerConfig(config: ServerConfig | null): void {
    cachedConfig = config;
}

/** Fetches the plugin configuration exposed by the server side of this plugin. */
export async function fetchServerConfig(url: string): Promise<ServerConfig> {
    const response = await fetch(`${url}/api/v1/config`, {
        method: 'GET',
        credentials: 'include',
        headers: {
            'X-Requested-With': 'XMLHttpRequest',
        },
    });

    if (!response.ok) {
        throw new Error(`failed to load plugin configuration: ${response.status}`);
    }

    return response.json();
}

/** Loads (once) and returns the shared plugin configuration. */
export function useServerConfig(): ServerConfig | null {
    const url = useSelector((state: GlobalState) => getPluginUrl(state));
    const [config, setConfig] = useState<ServerConfig | null>(cachedConfig);

    useEffect(() => {
        if (cachedConfig) {
            return;
        }

        let cancelled = false;

        fetchServerConfig(url).then((loaded) => {
            cachedConfig = loaded;
            if (!cancelled) {
                setConfig(loaded);
            }
        }).catch(() => {
            // Silently ignore: without configuration the feature simply stays off.
        });

        return () => {
            cancelled = true;
        };
    }, [url]);

    return config;
}
