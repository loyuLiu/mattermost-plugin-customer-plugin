// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useCallback, useEffect, useRef} from 'react';
import {useSelector, useStore} from 'react-redux';

import type {GlobalState} from '@mattermost/types/store';

import {getPluginUrl} from '../base_url';
import {useServerConfig} from '../hooks';
import {ReadStatusEngine} from '../read_status';
import {resolveReadStatus} from '../resolve';

/** Shortest gap between two requests for the same conversation's peer read position. */
const PEER_REFRESH_MS = 4000;

type PeerPosition = {
    /** Milliseconds, 0 when the endpoint reported "no counterpart / not a conversation". */
    at: number;

    /** When the value was fetched, used to throttle repeat requests. */
    fetchedAt: number;
};

/**
 * Invisible controller that owns the read-state engine.
 *
 * Besides starting and stopping it, it:
 *   - re-syncs whenever the read position of the channel being viewed changes, so
 *     opening a conversation clears its badges immediately instead of waiting for the
 *     periodic rescan;
 *   - keeps a small cache of the counterpart's read position per conversation. That
 *     value is not in the redux store (the store only holds the memberships of the
 *     logged-in user), so it is fetched from the plugin and refreshed on a timer, since
 *     the counterpart keeps reading while this tab stays open.
 */
const ReadStatusController = () => {
    const store = useStore<GlobalState>();
    const config = useServerConfig();
    const pluginUrl = useSelector((state: GlobalState) => getPluginUrl(state));

    const channelId = useSelector((state: GlobalState) => state.entities.channels.currentChannelId);
    const lastViewedAt = useSelector((state: GlobalState) => (
        channelId ? state.entities.channels.myMembers?.[channelId]?.last_viewed_at : undefined
    ));

    const engine = useRef<ReadStatusEngine | null>(null);
    const peerPositions = useRef(new Map<string, PeerPosition>());

    const enabled = resolveReadStatus(config).enabled;

    const refreshPeer = useCallback((targetChannelId: string) => {
        if (!targetChannelId || !pluginUrl) {
            return;
        }

        const cached = peerPositions.current.get(targetChannelId);
        if (cached && Date.now() - cached.fetchedAt < PEER_REFRESH_MS) {
            return;
        }

        peerPositions.current.set(targetChannelId, {at: cached?.at ?? 0, fetchedAt: Date.now()});

        fetch(`${pluginUrl}/api/v1/read/peer?channel_id=${encodeURIComponent(targetChannelId)}`, {
            method: 'GET',
            credentials: 'include',
            headers: {'X-Requested-With': 'XMLHttpRequest'},
        }).then((response) => (
            response.ok ? response.json() : null
        )).then((data: {peerLastViewedAt?: number} | null) => {
            if (!data) {
                return;
            }

            const at = typeof data.peerLastViewedAt === 'number' ? data.peerLastViewedAt : 0;
            const previous = peerPositions.current.get(targetChannelId)?.at;
            peerPositions.current.set(targetChannelId, {at, fetchedAt: Date.now()});

            if (previous !== at) {
                engine.current?.sync();
            }
        }).catch(() => {
            // Silently ignore: without the counterpart's position own messages simply
            // carry no badge until the next successful refresh.
        });
    }, [pluginUrl]);

    useEffect(() => {
        if (!enabled) {
            engine.current?.stop();
            engine.current = null;
            peerPositions.current.clear();
            return undefined;
        }

        const instance = new ReadStatusEngine({
            getPostMeta: (postId: string) => {
                const post = store.getState().entities.posts.posts[postId];
                if (!post) {
                    return undefined;
                }

                return {
                    createAt: post.create_at,
                    channelId: post.channel_id,
                    userId: post.user_id,
                };
            },
            getCurrentUserId: () => store.getState().entities.users.currentUserId,
            getLastViewedAt: (targetChannelId: string) => (
                store.getState().entities.channels.myMembers?.[targetChannelId]?.last_viewed_at
            ),
            getPeerLastViewedAt: (targetChannelId: string) => {
                const at = peerPositions.current.get(targetChannelId)?.at;
                return at && at > 0 ? at : undefined;
            },
            requestPeerLastViewedAt: refreshPeer,
            getChannelType: (targetChannelId: string) => (
                store.getState().entities.channels.channels?.[targetChannelId]?.type
            ),
        });

        engine.current = instance;
        instance.start();

        return () => {
            instance.stop();
            engine.current = null;
        };
    }, [enabled, store, refreshPeer]);

    useEffect(() => {
        engine.current?.sync();
    }, [channelId, lastViewedAt]);

    // The counterpart reads on her own schedule, so the position is polled while a
    // conversation is open. The throttle in refreshPeer keeps this cheap.
    useEffect(() => {
        if (!enabled || !channelId) {
            return undefined;
        }

        refreshPeer(channelId);
        const timer = window.setInterval(() => refreshPeer(channelId), PEER_REFRESH_MS);

        return () => window.clearInterval(timer);
    }, [enabled, channelId, refreshPeer]);

    return null;
};

export default ReadStatusController;
