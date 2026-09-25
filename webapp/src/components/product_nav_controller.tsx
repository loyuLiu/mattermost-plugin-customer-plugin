// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useEffect, useRef, useState} from 'react';
import {useSelector} from 'react-redux';

import type {GlobalState} from '@mattermost/types/store';

import {getPluginUrl} from '../base_url';
import {DEFAULT_PRODUCT_NAV_LINKS_PER_ROW} from '../constants';
import {useServerConfig} from '../hooks';
import {ProductNavEngine} from '../product_nav';
import {fetchNavigation} from '../product_nav_api';
import {resolveProductNav} from '../resolve';
import type {ProductNavDocument} from '../types/config';

/**
 * Invisible controller that owns the product navigation engine.
 *
 * It loads the entries once and hands them to the engine. The entries are not part of
 * the plugin configuration: they live in the plugin's KV store and are edited in the
 * system console, so every user reads the same list.
 */
const ProductNavController = () => {
    const pluginUrl = useSelector((state: GlobalState) => getPluginUrl(state));
    const config = useServerConfig();
    const settings = resolveProductNav(config);

    const [data, setData] = useState<ProductNavDocument | null>(null);

    // Mirrors `data` so that restarting the engine (when the icon changes) does not
    // depend on the effect order.
    const dataRef = useRef<ProductNavDocument | null>(null);
    const engine = useRef<ProductNavEngine | null>(null);

    useEffect(() => {
        if (!settings.enabled || !pluginUrl) {
            return undefined;
        }

        let cancelled = false;

        fetchNavigation(pluginUrl).then((loaded) => {
            if (!cancelled) {
                setData(loaded);
            }
        }).catch(() => {
            // Without entries the button simply never appears.
        });

        return () => {
            cancelled = true;
        };
    }, [pluginUrl, settings.enabled]);

    useEffect(() => {
        dataRef.current = data;
        engine.current?.setData(data);
    }, [data]);

    useEffect(() => {
        if (!settings.enabled) {
            engine.current?.stop();
            engine.current = null;
            return undefined;
        }

        const instance = new ProductNavEngine({iconUrl: settings.iconUrl, linksPerRow: settings.linksPerRow});
        engine.current = instance;
        instance.start();
        instance.setData(dataRef.current);

        return () => {
            instance.stop();
            engine.current = null;
        };
    }, [settings.enabled, settings.iconUrl]);

    // The row size lives in the stylesheet, so it is applied in place: no restart,
    // and an open panel re-renders at its new width.
    useEffect(() => {
        engine.current?.setLinksPerRow(settings.linksPerRow ?? DEFAULT_PRODUCT_NAV_LINKS_PER_ROW);
    }, [settings.linksPerRow]);

    return null;
};

export default ProductNavController;
