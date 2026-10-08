// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useRef, useState} from 'react';
import {useSelector} from 'react-redux';

import {getPluginUrl} from '../base_url';
import type {GlobalState} from '@mattermost/types/store';
import {DEFAULT_PRODUCT_NAV_LINKS_PER_ROW} from '../constants';
import {useServerConfig} from '../hooks';
import {buildNavContent, installNavStyle, markSidebarOpen, syncHeaderButtonQuietStyle} from '../product_nav';
import {fetchNavigation} from '../product_nav_api';
import {getNavDocument, setNavDocument, subscribeNavDocument} from '../product_nav_store';
import {resolveProductNav} from '../resolve';
import type {ProductNavDocument} from '../types/config';

/**
 * Body of the product navigation, as it appears in the right-hand sidebar.
 *
 * Mattermost owns everything around this component — the column itself, the title
 * bar with its close button, the animation — so this only fills the inside. The
 * markup comes from `buildNavContent`, so the column and the old floating panel
 * shared one set of classes and one stylesheet.
 *
 * The entries are not passed as props: the component is instantiated by the plugin
 * registry, which has nothing of the plugin's to hand, so the body and the channel
 * header button talk to `product_nav_store` instead.
 */
const ProductNavSidebar = () => {
    const config = useServerConfig();
    const settings = resolveProductNav(config);
    const linksPerRow = settings.linksPerRow ?? DEFAULT_PRODUCT_NAV_LINKS_PER_ROW;
    const pluginUrl = useSelector((state: GlobalState) => getPluginUrl(state));

    const [data, setData] = useState<ProductNavDocument | null>(() => getNavDocument());
    const host = useRef<HTMLDivElement>(null);

    // Re-render when the plugin starts and hands over the entries it loaded.
    useEffect(() => subscribeNavDocument(setData), []);

    // Refreshed again on every open: the list is edited in the system console while
    // the page is open, and a directory of internal systems should not be a snapshot
    // from the time the tab was loaded. The plugin startup already pre-filled the
    // store, so this only ever replaces an older list.
    useEffect(() => {
        if (!pluginUrl || !settings.enabled) {
            return;
        }

        let cancelled = false;

        fetchNavigation(pluginUrl).then((loaded) => {
            if (!cancelled) {
                setNavDocument(loaded);
            }
        }).catch(() => {
            // Keeps whatever the plugin already managed to load; the sidebar is still
            // readable from the store, which is where the first paint came from.
        });

        return () => {
            cancelled = true;
        };
    }, [pluginUrl, settings.enabled]);

    // The stylesheet is normally installed by the button engine. It is installed
    // here too because the sidebar can mount first — and because the row size only
    // ever changes through the settings, which this component also reads.
    useEffect(() => {
        installNavStyle(linksPerRow);
    }, [linksPerRow]);

    // Pinning the header buttons again while the sidebar opens. The opening is what
    // makes the header re-render into them: on a page that has been sitting there the
    // buttons are only in the DOM from this moment, and the header re-flow drops the
    // pointer on the bulk-delete button — the one that has to stay exactly as it is.
    // The click path pins too; this one covers a hover that has not been clicked yet.
    useEffect(() => {
        syncHeaderButtonQuietStyle();
    }, []);

    // Only while mounted, i.e. only while the sidebar is open: that is when the
    // stylesheet is allowed to widen the column.
    useEffect(() => {
        markSidebarOpen(true);
        return () => markSidebarOpen(false);
    }, []);

    useEffect(() => {
        const node = host.current;
        if (!node) {
            return;
        }

        node.textContent = '';
        node.appendChild(buildNavContent(data));
    }, [data]);

    return <div ref={host} className="customers-plugin-nav-sidebar"/>;
};

export default ProductNavSidebar;
