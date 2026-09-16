// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/** Per-channel answer from `GET /api/v1/history/boundary?channel_id=`. */
export type HistoryBoundary = {
    enabled: boolean;
    channelId: string;
    mode: string;

    /** When the requesting user joined the channel. 0 when unknown. */
    joinedAt: number;

    /** Exclusive lower bound in ms. Messages with create_at < cutoffAt are hidden. 0 = no restriction. */
    cutoffAt: number;

    /** Server clock at the time of the response, used to expire the cache. */
    serverTime: number;
};

/** Minimal post information the gate needs from the redux store. */
export type PostMeta = {
    createAt: number;
    channelId: string;
};

/**
 * Cutoff lookup result for a channel.
 * - `undefined` means the boundary is not known yet (a fetch is in flight).
 * - `0` means the channel is not restricted.
 */
export type CutoffLookup = number | undefined;
