"use strict";
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadBoundary = exports.loadBoundaries = exports.persistBoundaries = exports.hydrateBoundaries = exports.clearBoundaryCache = exports.isBoundaryStale = exports.peekBoundary = exports.putBoundary = void 0;
/** How long a boundary stays cached before it is refreshed. */
const CACHE_TTL_MS = 60 * 1000;
/**
 * Boundaries are mirrored into `localStorage` so that a reload — or coming back
 * to a channel — starts with an answer instead of a round trip.
 *
 * That matters more than it sounds: while a boundary is in flight the gate
 * blanks a row but keeps its height, and the virtualised list then measures that
 * row at its full height. A row measured before it is collapsed keeps that height
 * forever (see `recoverViewport`), which is what turns the top of a channel into
 * a stack of invisible boxes. Knowing the answer up front removes the whole
 * class of problem for every load after the first.
 */
const STORAGE_PREFIX = 'customers-plugin:history-boundaries:';
/** Persisted entries older than this are dropped rather than trusted. */
const PERSIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Coalesces the writes of a bulk fetch into one serialisation. */
let persistTimer = null;
const cache = new Map();
const inflight = new Map();
function cacheKey(userId, channelId) {
    return `${userId}::${channelId}`;
}
function storageKey(userId) {
    return STORAGE_PREFIX + userId;
}
/** localStorage can be missing (private mode) or throw (quota); never fatal. */
function readStore(key) {
    try {
        if (typeof localStorage === 'undefined') {
            return null;
        }
        return localStorage.getItem(key);
    }
    catch {
        return null;
    }
}
function writeStore(key, value) {
    try {
        if (typeof localStorage === 'undefined') {
            return;
        }
        localStorage.setItem(key, value);
    }
    catch {
        // Full or forbidden: the in-memory cache still works for this session.
    }
}
/** Marks a boundary as fetched for the given user and channel. */
function putBoundary(userId, channelId, boundary) {
    cache.set(cacheKey(userId, channelId), { boundary, fetchedAt: Date.now() });
    persistBoundaries(userId);
}
exports.putBoundary = putBoundary;
/** Returns the cached cutoff, or undefined when it has not been fetched yet. */
function peekBoundary(userId, channelId) {
    const entry = cache.get(cacheKey(userId, channelId));
    if (!entry) {
        return undefined;
    }
    return entry.boundary;
}
exports.peekBoundary = peekBoundary;
/** True when the cached entry is older than the TTL. */
function isBoundaryStale(userId, channelId) {
    const entry = cache.get(cacheKey(userId, channelId));
    if (!entry) {
        return true;
    }
    return Date.now() - entry.fetchedAt > CACHE_TTL_MS;
}
exports.isBoundaryStale = isBoundaryStale;
/** Clears every cached boundary, e.g. after a configuration change. */
function clearBoundaryCache() {
    cache.clear();
    inflight.clear();
}
exports.clearBoundaryCache = clearBoundaryCache;
/**
 * Reads the boundaries of one user back from `localStorage`.
 *
 * The entries are deliberately marked as **stale**: they are good enough to
 * decide synchronously, but the caller still has to refresh them in the
 * background, so a cutoff an administrator changed since is picked up again.
 *
 * Entries that predate the plugin's own record of "fetched at" by more than
 * `PERSIST_MAX_AGE_MS` are dropped — a boundary that old describes a membership
 * that may no longer exist.
 */
function hydrateBoundaries(userId) {
    const cutoffs = {};
    if (!userId) {
        return cutoffs;
    }
    const raw = readStore(storageKey(userId));
    if (!raw) {
        return cutoffs;
    }
    let payload;
    try {
        payload = JSON.parse(raw);
    }
    catch {
        return cutoffs;
    }
    if (!payload.cutoffs) {
        return cutoffs;
    }
    const at = typeof payload.at === 'number' ? payload.at : 0;
    if (at <= 0 || Date.now() - at > PERSIST_MAX_AGE_MS) {
        return cutoffs;
    }
    for (const [channelId, cutoffAt] of Object.entries(payload.cutoffs)) {
        if (!channelId || typeof cutoffAt !== 'number' || cutoffAt <= 0) {
            continue;
        }
        cutoffs[channelId] = cutoffAt;
        // fetchedAt 0 -> always stale -> the caller revalidates in the background.
        cache.set(cacheKey(userId, channelId), {
            boundary: {
                enabled: true,
                channelId,
                mode: '',
                joinedAt: 0,
                cutoffAt,
                serverTime: at,
            },
            fetchedAt: 0,
        });
    }
    return cutoffs;
}
exports.hydrateBoundaries = hydrateBoundaries;
/** Mirrors the in-memory cache of one user into `localStorage`. */
function persistBoundaries(userId) {
    if (!userId) {
        return;
    }
    if (persistTimer !== null && typeof clearTimeout === 'function') {
        clearTimeout(persistTimer);
    }
    if (typeof setTimeout !== 'function') {
        flushBoundaries(userId);
        return;
    }
    persistTimer = setTimeout(() => {
        persistTimer = null;
        flushBoundaries(userId);
    }, 300);
}
exports.persistBoundaries = persistBoundaries;
function flushBoundaries(userId) {
    const cutoffs = {};
    let at = 0;
    const prefix = `${userId}::`;
    cache.forEach((entry, key) => {
        if (!key.startsWith(prefix)) {
            return;
        }
        const channelId = key.slice(prefix.length);
        if (!channelId || entry.boundary.cutoffAt <= 0) {
            return;
        }
        cutoffs[channelId] = entry.boundary.cutoffAt;
        if (entry.fetchedAt > at) {
            at = entry.fetchedAt;
        }
    });
    writeStore(storageKey(userId), JSON.stringify({ at: at || Date.now(), cutoffs }));
}
/**
 * Loads the boundaries of several channels in one round trip and writes each of
 * them into the cache.
 *
 * This is what removes the first-paint leak: the webapp calls it once at start-up
 * for every channel it already knows, so a later channel switch can hide history
 * synchronously instead of waiting for the network.
 *
 * Channels that the server omits from the response stay unknown on purpose — they
 * must remain gated rather than being treated as unrestricted.
 */
async function loadBoundaries(url, userId, channelIds) {
    var _a, _b, _c;
    const wanted = [];
    for (const channelId of channelIds) {
        if (!channelId) {
            continue;
        }
        if (wanted.includes(channelId)) {
            continue;
        }
        if (hasFreshBoundary(userId, channelId)) {
            continue;
        }
        wanted.push(channelId);
    }
    if (wanted.length === 0) {
        return {};
    }
    const response = await fetch(`${url}/api/v1/history/boundaries`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channelIds: wanted }),
    });
    if (!response.ok) {
        throw new Error(`failed to load history boundaries: ${response.status}`);
    }
    const payload = await response.json();
    const cutoffs = (_a = payload.cutoffs) !== null && _a !== void 0 ? _a : {};
    for (const [channelId, cutoffAt] of Object.entries(cutoffs)) {
        putBoundary(userId, channelId, {
            enabled: cutoffAt > 0,
            channelId,
            mode: (_b = payload.mode) !== null && _b !== void 0 ? _b : '',
            joinedAt: 0,
            cutoffAt,
            serverTime: (_c = payload.serverTime) !== null && _c !== void 0 ? _c : Date.now(),
        });
    }
    return cutoffs;
}
exports.loadBoundaries = loadBoundaries;
/** True when a fresh (non-stale) boundary is already cached. */
function hasFreshBoundary(userId, channelId) {
    return peekBoundary(userId, channelId) !== undefined && !isBoundaryStale(userId, channelId);
}
/**
 * Loads the boundary for a channel. Concurrent callers for the same
 * (user, channel) share a single request.
 */
async function loadBoundary(url, userId, channelId) {
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
        const boundary = await response.json();
        putBoundary(userId, channelId, boundary);
        return boundary;
    })();
    inflight.set(key, request);
    try {
        return await request;
    }
    finally {
        inflight.delete(key);
    }
}
exports.loadBoundary = loadBoundary;
