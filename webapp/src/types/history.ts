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

/** Batch answer from `POST /api/v1/history/boundaries`. */
export type HistoryBoundaries = {
    mode: string;

    /** Server clock at the time of the response. */
    serverTime: number;

    /**
     * Cutoff per requested channel. A channel missing from this map is *unknown*,
     * not unrestricted — callers must keep treating it as gated.
     */
    cutoffs: Record<string, number>;
};

/** Minimal post information the gate needs from the redux store. */
export type PostMeta = {
    createAt: number;
    channelId: string;

    /**
     * True for posts the gate must never hide even when they predate the
     * cutoff — currently the member's own "you were added to the channel"
     * marker, which is created at the join instant and is meant to stay
     * visible as the first row of the gated range.
     */
    forceVisible?: boolean;
};

/**
 * Cutoff lookup result for a channel.
 * - `undefined` means the boundary is not known yet (a fetch is in flight).
 * - `0` means the channel is not restricted.
 */
export type CutoffLookup = number | undefined;
