// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useCallback, useEffect, useRef} from 'react';
import {useSelector, useStore} from 'react-redux';

import type {GlobalState} from '@mattermost/types/store';

import {getPluginUrl} from '../base_url';
import {useServerConfig} from '../hooks';
import {isBoundaryStale, loadBoundary, peekBoundary} from '../history_api';
import {HistoryGate} from '../history_gate';
import type {PostMeta} from '../types/history';

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

    const cutoffs = useRef(new Map<string, number>());
    const gateRef = useRef<HistoryGate | null>(null);

    // Kept in refs so the gate's provider never needs to be rebuilt mid-flight.
    const userIdRef = useRef(userId);
    userIdRef.current = userId;
    const urlRef = useRef(url);
    urlRef.current = url;

    const history = config?.history;
    const enabled = Boolean(history?.enabled && history.mode !== 'off');

    const ensureBoundary = useCallback((targetChannelId: string) => {
        const currentUserId = userIdRef.current;
        if (!currentUserId) {
            return;
        }

        const cached = peekBoundary(currentUserId, targetChannelId);
        if (cached && !isBoundaryStale(currentUserId, targetChannelId)) {
            cutoffs.current.set(targetChannelId, cached.cutoffAt);
            gateRef.current?.sync();
            return;
        }

        loadBoundary(urlRef.current, currentUserId, targetChannelId).then((boundary) => {
            cutoffs.current.set(targetChannelId, boundary.cutoffAt);
            gateRef.current?.sync();
        }).catch(() => {
            // Leave the channel unrestricted until we know better.
        });
    }, []);

    // A new user means every cached boundary belongs to somebody else.
    useEffect(() => {
        cutoffs.current.clear();
    }, [userId]);

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

                    return {createAt: post.create_at, channelId: post.channel_id};
                },
                getCutoff: (targetChannelId: string) => cutoffs.current.get(targetChannelId),
                requestCutoff: (targetChannelId: string) => ensureBoundary(targetChannelId),
            },
            noticeEnabled: history.noticeEnabled,
            noticeText: history.noticeText,
            hideInSearch: history.hideInSearch,
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
