"use strict";
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
Object.defineProperty(exports, "__esModule", { value: true });
exports.filterPostList = exports.uninstallPostStreamFilter = exports.installPostStreamFilter = void 0;
const history_api_1 = require("./history_api");
/**
 * Filters history out of the post-list responses *before* the data reaches the
 * redux store.
 *
 * Why at the data layer: hiding rows in the DOM is a race against the
 * virtualised list's height measurement. A row measured before the gate
 * collapses it keeps that height in `itemSizeMap` forever (replayed later by
 * placeholder divs that CSS cannot reach) — that is exactly what the recurring
 * "blank boxes at the top of the channel" bug is made of. Removing pre-join
 * posts from the response means those rows are never rendered at all: no race,
 * no placeholders, and nothing to re-stabilise on a channel switch, because the
 * store only ever holds posts the member may see.
 *
 * The interception point is safe: `@mattermost/client`'s `doFetch` calls the
 * *global* `fetch` (`await fetch(url, ...)` in client4.js), so it resolves the
 * patched function at call time. The plugin's own requests (`/plugins/...`) are
 * exempt so the boundary fetch cannot recurse into itself.
 */
/** Centre-channel post lists: getPosts / getPostsSince / getPostsBefore / ... */
const CHANNEL_POSTS_PATTERN = /\/api\/v4\/channels\/([a-zA-Z0-9_-]+)\/posts(?:\?|$)/;
/** Unread view: `GET /api/v4/users/<uid>/channels/<cid>/posts/unread`. */
const UNREAD_POSTS_PATTERN = /\/api\/v4\/users\/[a-zA-Z0-9_-]+\/channels\/([a-zA-Z0-9_-]+)\/posts\/unread(?:\?|$)/;
/**
 * The system post "X was added to the channel" (mattermost-redux
 * `Posts.POST_TYPES.ADD_TO_CHANNEL`). It carries the moment the member joined,
 * and it is the one piece of pre-history the member is meant to keep seeing.
 */
const ADD_TO_CHANNEL_TYPE = 'system_add_to_channel';
/** How long a posts request waits for an unknown boundary before giving up. */
const BOUNDARY_TIMEOUT_MS = 3000;
let options = null;
let originalFetch = null;
let installed = false;
let hydratedFor = '';
/**
 * Patches the global `fetch` exactly once. Idempotent; safe to call at the very
 * start of plugin initialisation, before any channel posts have been requested.
 */
function installPostStreamFilter(nextOptions) {
    if (installed) {
        return;
    }
    installed = true;
    options = nextOptions;
    originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = patchedFetch;
}
exports.installPostStreamFilter = installPostStreamFilter;
/** Test hook: puts the original fetch back. */
function uninstallPostStreamFilter() {
    if (!installed || !originalFetch) {
        return;
    }
    globalThis.fetch = originalFetch;
    installed = false;
    options = null;
    originalFetch = null;
    hydratedFor = '';
}
exports.uninstallPostStreamFilter = uninstallPostStreamFilter;
function requestUrl(input) {
    if (typeof input === 'string') {
        return input;
    }
    if (input instanceof URL) {
        return input.href;
    }
    const request = input;
    if (request && typeof request.url === 'string') {
        return request.url;
    }
    return '';
}
function requestMethod(input, init) {
    if (init && typeof init.method === 'string' && init.method !== '') {
        return init.method.toUpperCase();
    }
    const request = input;
    if (request && typeof request.method === 'string' && request.method !== '') {
        return request.method.toUpperCase();
    }
    return 'GET';
}
function matchChannelPosts(url) {
    const channel = CHANNEL_POSTS_PATTERN.exec(url);
    if (channel) {
        return channel[1];
    }
    const unread = UNREAD_POSTS_PATTERN.exec(url);
    if (unread) {
        return unread[1];
    }
    return null;
}
async function patchedFetch(input, init) {
    const currentOptions = options;
    if (!currentOptions || !originalFetch) {
        return originalFetch(input, init);
    }
    const url = requestUrl(input);
    if (url.includes('/plugins/')) {
        // Our own boundary/config requests; also what keeps this from recursing.
        return originalFetch(input, init);
    }
    if (!currentOptions.isEnabled() || requestMethod(input, init) !== 'GET') {
        return originalFetch(input, init);
    }
    const channelId = matchChannelPosts(url);
    if (!channelId) {
        return originalFetch(input, init);
    }
    const userId = currentOptions.getUserId();
    if (!userId) {
        return originalFetch(input, init);
    }
    let cutoff = resolveCutoff(userId, channelId);
    if (cutoff === undefined) {
        // The boundary has never been fetched (first visit to this channel on
        // this device). Wait for it once — a fast plugin endpoint — instead of
        // letting unfiltered history into the store. On timeout, fall through
        // and let the DOM gate do its best.
        const boundary = await boundaryWithTimeout(currentOptions, userId, channelId);
        cutoff = boundary ? boundary.cutoffAt : undefined;
    }
    if (typeof cutoff !== 'number' || !(cutoff > 0)) {
        // Not a gated channel — or a boundary we could not make sense of, in
        // which case filtering nothing is strictly safer than filtering all.
        return originalFetch(input, init);
    }
    const response = originalFetch(input, init);
    return filteredResponse(response, cutoff, userId);
}
/**
 * The synchronously-known cutoff for a channel, or undefined when unknown.
 *
 * Seeds the in-memory cache from `localStorage` on the first miss per user, so
 * the very first posts request of a page load can already decide — the mirror is
 * written by the controller the first time a boundary arrives.
 */
function resolveCutoff(userId, channelId) {
    const cached = (0, history_api_1.peekBoundary)(userId, channelId);
    if (cached) {
        return cached.cutoffAt;
    }
    if (hydratedFor !== userId) {
        hydratedFor = userId;
        (0, history_api_1.hydrateBoundaries)(userId);
        const hydrated = (0, history_api_1.peekBoundary)(userId, channelId);
        if (hydrated) {
            return hydrated.cutoffAt;
        }
    }
    return undefined;
}
async function boundaryWithTimeout(currentOptions, userId, channelId) {
    const request = (0, history_api_1.loadBoundary)(currentOptions.getPluginUrl(), userId, channelId).
        then((boundary) => boundary).
        catch(() => undefined);
    const timer = new Promise((resolve) => {
        setTimeout(() => resolve(undefined), BOUNDARY_TIMEOUT_MS);
    });
    return Promise.race([request, timer]);
}
async function filteredResponse(pending, cutoff, userId) {
    const response = await pending;
    if (!response.ok) {
        return response;
    }
    let payload;
    try {
        payload = await response.clone().json();
    }
    catch {
        // Not JSON (proxy error page, empty body): leave the response alone.
        return response;
    }
    const result = filterPostList(payload, cutoff, userId);
    if (!result) {
        return response;
    }
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    return new Response(JSON.stringify(result.payload), {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}
/**
 * Pure core of the filter: rewrites one parsed PostList response.
 *
 * A post is kept when it was created at or after the cutoff, or when it is the
 * member's own "you were added to the channel" marker — that marker is created
 * at the join instant, which can sit 1 ms before the recorded cutoff, and the
 * screenshot the customer asked for shows it at the top of the visible range.
 *
 * Returns null when there is nothing to change.
 */
function filterPostList(payload, cutoff, userId) {
    if (cutoff <= 0 || !payload || typeof payload !== 'object') {
        return null;
    }
    const list = payload;
    if (!Array.isArray(list.order) || !list.posts || typeof list.posts !== 'object') {
        return null;
    }
    const order = list.order.filter((id) => typeof id === 'string');
    const posts = list.posts;
    const kept = order.filter((id) => keepPost(posts[id], cutoff, userId));
    const removed = order.length - kept.length;
    if (removed === 0) {
        return null;
    }
    const nextPosts = {};
    for (const [id, post] of Object.entries(posts)) {
        if (keepPost(post, cutoff, userId)) {
            nextPosts[id] = post;
        }
    }
    const next = { ...list, order: kept, posts: nextPosts };
    // Everything older than this page's oldest entry is, by pagination, older
    // than the cutoff too — so the response may safely claim to be at the
    // channel's oldest post. That is what sets `atOldestPost` in the webapp
    // (mattermost-redux keys it off `prev_post_id === ''`, not `has_next`) and
    // stops the list from asking for pages we would only throw away.
    //
    // Only when the page really is descending (newest first): an ascending or
    // unordered page says nothing about what older pages hold.
    let markedOldest = false;
    const createAts = order.map((id) => { var _a; return (_a = posts[id]) === null || _a === void 0 ? void 0 : _a.create_at; });
    const descending = createAts.length <= 1 ||
        (typeof createAts[0] === 'number' &&
            typeof createAts[createAts.length - 1] === 'number' &&
            createAts[0] >= createAts[createAts.length - 1]);
    if (descending) {
        next.prev_post_id = '';
        markedOldest = true;
    }
    return { payload: next, removed, markedOldest };
}
exports.filterPostList = filterPostList;
function keepPost(post, cutoff, userId) {
    if (!post || typeof post !== 'object') {
        // A dangling id: the row could not render anyway.
        return false;
    }
    if (typeof post.create_at === 'number' && post.create_at >= cutoff) {
        return true;
    }
    return isOwnJoinMarker(post, userId);
}
function isOwnJoinMarker(post, userId) {
    if (!userId || post.type !== ADD_TO_CHANNEL_TYPE) {
        return false;
    }
    const props = post.props;
    return Boolean(props && (props.addedUserId === userId || props.addedId === userId));
}
