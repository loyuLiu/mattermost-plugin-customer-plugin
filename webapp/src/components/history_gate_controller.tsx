// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useCallback, useEffect, useRef} from 'react';
import {useSelector, useStore} from 'react-redux';

import type {GlobalState} from '@mattermost/types/store';

import {getPluginUrl} from '../base_url';
import {useServerConfig} from '../hooks';
import {hydrateBoundaries, isBoundaryStale, loadBoundaries, loadBoundary, peekBoundary} from '../history_api';
import {HistoryGate} from '../history_gate';
import type {PostMeta} from '../types/history';
import {isUserAddedInChannel} from 'mattermost-redux/utils/post_utils';

/**
 * Invisible controller that drives the history gate.
 *
 * It owns three things: the per-channel cutoff cache, the fetch logic that fills
 * it, and the lifecycle of the DOM engine.
 */
const HistoryGateController = () => {
    const store = useStore<GlobalState>();
    const url = useSelector(getPluginUrl);
    const config = useServerConfig();

    const userId = useSelector((state: GlobalState) => state.entities.users.currentUserId);
    const channelId = useSelector((state: GlobalState) => state.entities.channels.currentChannelId);

    // Only the size is used: it changes whenever a channel is added or removed,
    // which is the signal to top up the boundary cache.
    const channelCount = useSelector((state: GlobalState) => Object.keys(state.entities.channels.channels).length);

    const cutoffs = useRef(new Map<string, number>());
    const gateRef = useRef<HistoryGate | null>(null);

    // Kept in refs so the gate's provider never needs to be rebuilt mid-flight.
    const userIdRef = useRef(userId);
    userIdRef.current = userId;
    const urlRef = useRef(url);
    urlRef.current = url;

    const history = config?.history;
    const enabled = Boolean(history?.enabled && history.mode !== 'off');

    const enabledRef = useRef(enabled);
    enabledRef.current = enabled;

    const applyCutoffs = useCallback((entries: Record<string, number>) => {
        let changed = false;

        for (const [targetChannelId, cutoffAt] of Object.entries(entries)) {
            if (cutoffs.current.get(targetChannelId) !== cutoffAt) {
                cutoffs.current.set(targetChannelId, cutoffAt);
                changed = true;
            }
        }

        if (changed) {
            gateRef.current?.sync();
        }
    }, []);

    /**
     * Warms the cache for every channel the webapp already knows about.
     *
     * Without this, the first frame after a channel switch is painted while the
     * boundary is still in flight; the caller then has to blank rows it cannot yet
     * judge. A warm cache means the gate can decide synchronously.
     */
    const prefetchBoundaries = useCallback(() => {
        const currentUserId = userIdRef.current;
        if (!enabledRef.current || !currentUserId) {
            return;
        }

        const channels = store.getState().entities.channels.channels;
        const ids = Object.keys(channels ?? {});
        if (ids.length === 0) {
            return;
        }

        loadBoundaries(urlRef.current, currentUserId, ids).then(applyCutoffs).catch(() => {
            // Fall back to per-channel fetches; the gate keeps those rows blanked.
        });
    }, [store, applyCutoffs]);

    /**
     * Makes sure a boundary is known, then keeps it fresh.
     *
     * Stale-while-revalidate on purpose: a boundary we already have — even an old
     * one — is used immediately, and only then refreshed in the background. The
     * alternative (wait for the network) is what leaves rows blanked-but-full-height
     * for a round trip, which is how the virtualised list ends up measuring them
     * before the gate collapses them.
     */
    const ensureBoundary = useCallback((targetChannelId: string) => {
        const currentUserId = userIdRef.current;
        if (!currentUserId) {
            return;
        }

        const cached = peekBoundary(currentUserId, targetChannelId);
        if (cached) {
            cutoffs.current.set(targetChannelId, cached.cutoffAt);
            gateRef.current?.sync();

            if (!isBoundaryStale(currentUserId, targetChannelId)) {
                return;
            }
        }

        loadBoundary(urlRef.current, currentUserId, targetChannelId).then((boundary) => {
            applyCutoffs({[targetChannelId]: boundary.cutoffAt});
        }).catch(() => {
            // Leave the channel unknown on purpose: the gate keeps its rows blanked
            // until a boundary arrives, rather than deciding it is unrestricted.
        });
    }, [applyCutoffs]);

    // A new user means every cached boundary belongs to somebody else.
    useEffect(() => {
        cutoffs.current.clear();

        // Seed from the last session before anything is rendered: on a reload the
        // first frame would otherwise be painted with the boundary still in flight.
        applyCutoffs(hydrateBoundaries(userId));
    }, [userId, applyCutoffs]);

    // Warm every channel we know about, and top up whenever the set changes.
    useEffect(() => {
        prefetchBoundaries();
    }, [prefetchBoundaries, enabled, userId, channelCount]);

    // Create (or tear down) the DOM engine when the effective options change.
    useEffect(() => {
        if (!enabled || !history) {
            gateRef.current?.stop();
            gateRef.current = null;
            return undefined;
        }

        const gate = new HistoryGate({
            provider: {
                getPostMeta: (postId: string): PostMeta | undefined => {
                    const post = store.getState().entities.posts.posts[postId];
                    if (!post) {
                        return undefined;
                    }

                    return {
                        createAt: post.create_at,
                        channelId: post.channel_id,

                        // "You were added to the channel" is created at the join
                        // instant — possibly a hair before the recorded cutoff —
                        // and the member is meant to keep seeing it as the first
                        // row of their gated range.
                        forceVisible: isUserAddedInChannel(post, userIdRef.current),
                    };
                },
                getCutoff: (targetChannelId: string) => cutoffs.current.get(targetChannelId),
                requestCutoff: (targetChannelId: string) => ensureBoundary(targetChannelId),
                getCurrentChannelId: () => store.getState().entities.channels.currentChannelId || undefined,
            },
            noticeEnabled: history.noticeEnabled,
            noticeText: history.noticeText,
            hideInSearch: history.hideInSearch,
            pendingPolicy: history.pendingPolicy,
        });

        gateRef.current = gate;
        gate.start();

        return () => {
            gate.stop();
            gateRef.current = null;
        };
    }, [enabled, history, store, ensureBoundary]);

    // Preload the boundary of the channel being viewed so the first paint is right.
    useEffect(() => {
        if (!enabled || !userId || !channelId) {
            return;
        }

        ensureBoundary(channelId);
    }, [enabled, userId, channelId, ensureBoundary]);

    return null;
};

export default HistoryGateController;
