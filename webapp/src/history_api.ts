// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {HistoryBoundary} from './types/history';

/** How long a boundary stays cached before it is refreshed. */
const CACHE_TTL_MS = 60 * 1000;

const cache = new Map<string, {boundary: HistoryBoundary; fetchedAt: number}>();
const inflight = new Map<string, Promise<HistoryBoundary>>();

function cacheKey(userId: string, channelId: string): string {
    return `${userId}::${channelId}`;
}

/** Marks a boundary as fetched for the given user and channel. */
export function putBoundary(userId: string, channelId: string, boundary: HistoryBoundary): void {
    cache.set(cacheKey(userId, channelId), {boundary, fetchedAt: Date.now()});
}

/** Returns the cached cutoff, or undefined when it has not been fetched yet. */
export function peekBoundary(userId: string, channelId: string): HistoryBoundary | undefined {
    const entry = cache.get(cacheKey(userId, channelId));
    if (!entry) {
        return undefined;
    }

    return entry.boundary;
}

/** True when the cached entry is older than the TTL. */
export function isBoundaryStale(userId: string, channelId: string): boolean {
    const entry = cache.get(cacheKey(userId, channelId));
    if (!entry) {
        return true;
    }

    return Date.now() - entry.fetchedAt > CACHE_TTL_MS;
}

/** Clears every cached boundary, e.g. after a configuration change. */
export function clearBoundaryCache(): void {
    cache.clear();
    inflight.clear();
}

/**
 * Loads the boundary for a channel. Concurrent callers for the same
 * (user, channel) share a single request.
 */
export async function loadBoundary(
    url: string,
    userId: string,
    channelId: string,
): Promise<HistoryBoundary> {
    const key = cacheKey(userId, channelId);

    const pending = inflight.get(key);
    if (pending) {
        return pending;
    }

    const request = (async () => {
        const response = await fetch(`${url}/api/v1/history/boundary?channel_id=${encodeURIComponent(channelId)}`, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
            },
        });

        if (!response.ok) {
            throw new Error(`failed to load history boundary: ${response.status}`);
        }

        const boundary = await response.json() as HistoryBoundary;
        putBoundary(userId, channelId, boundary);

        return boundary;
    })();

    inflight.set(key, request);

    try {
        return await request;
    } finally {
        inflight.delete(key);
    }
}
