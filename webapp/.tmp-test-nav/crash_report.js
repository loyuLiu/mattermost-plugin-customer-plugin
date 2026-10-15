"use strict";
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCrashBannerEnabled = exports.setCrashBannerEnabled = exports.uninstallCrashReporter = exports.installCrashReporter = exports.recordCrash = exports.resetCrashRecords = exports.getCrashRecords = void 0;
/**
 * Keeps — and shows — the errors this plugin's own code throws.
 *
 * A phone browser has no console to open, and a page that comes up blank is a page
 * with nothing left to inspect: whatever threw is gone before anyone can look at it.
 * So the first uncaught errors of a session are recorded in `localStorage` **and**
 * drawn onto the page as a banner.
 *
 * The banner is deliberately plain DOM. A crash inside a React component takes the
 * whole tree down with it, and a banner rendered by the tree that just died would
 * never appear — which is exactly the situation this exists for.
 */
/** Where the records are mirrored, so a later page load can still be asked. */
const STORE_KEY = 'customers-plugin:last-errors';
/** Id of the banner element, so a reload never leaves two of them. */
const BANNER_ID = 'customers-plugin-crash-banner';
/** How many records are kept; the first ones are the ones that explain a blank page. */
const MAX_KEPT = 5;
/** How much of a stack reaches the banner; a phone screen is not a log viewer. */
const STACK_LIMIT = 320;
/**
 * What a frame of this plugin's own bundle carries, so the stack can say whose
 * failure this is. The plugin is served from `/plugins/<id>/public/…`, and every
 * frame that came out of our code names it.
 */
const PLUGIN_PATH_MARK = 'com.example.customers-plugin';
/**
 * Local override for one debugging session: `on` forces the banner on even when the
 * administrator left the setting off, `off` silences it. Read at draw time, so
 * flipping it and reloading is enough — no reinstall, no config change.
 *
 *     localStorage.setItem('customers-plugin:crash-banner', 'on')
 */
const BANNER_OVERRIDE_KEY = 'customers-plugin:crash-banner';
/**
 * Whether the banner may be drawn at all.
 *
 * Off until the administrator turns the `CrashBannerEnabled` setting on (or until the
 * override above says `on`): the banner covers the top of the page for everybody who
 * uses the site, which makes it a debugging instrument rather than a feature. Errors
 * are still recorded and mirrored into `localStorage` either way, so a blank page can
 * still be explained after the fact.
 */
let bannerEnabled = false;
let installed = false;
let kept = [];
/** Read back what has been recorded so far (tests, and the console). */
function getCrashRecords() {
    return kept.slice();
}
exports.getCrashRecords = getCrashRecords;
/** Clears the in-memory records. The `localStorage` mirror is left alone on purpose. */
function resetCrashRecords() {
    kept = [];
}
exports.resetCrashRecords = resetCrashRecords;
/**
 * A denial that reaches nobody and breaks nothing.
 *
 * `media.play()` returns a promise, and mobile browsers refuse autoplay by
 * policy — the new-message chime of the host app is simply not played, an
 * unhandled rejection is all that is left, and it names the platform, not a
 * fault. Painting the red banner for it would train the reader that the banner
 * lies, which is the one thing this banner must never do.
 */
function isBenignRejection(reason) {
    const error = reason;
    if (!error || typeof error.message !== 'string') {
        return false;
    }
    const notAllowed = error.message.indexOf('not allowed by the user agent') >= 0 ||
        error.name === 'NotAllowedError';
    return notAllowed && /\bplay\b|play@|play \(/i.test(error.stack || '');
}
/**
 * Whose bundle the stack came out of.
 *
 * This reporter listens to the whole window, so it also hears the host page fail —
 * which is how the blank-page `removeChild` was caught. Those must stay visible. But
 * a stack with no frame of ours in it is not this plugin's doing, and the record has
 * to say so, or every host hiccup reads as a plugin bug. With no stack at all the
 * blame stays here: our own calls are what arrive that way.
 */
function originOf(stack) {
    if (!stack) {
        return 'plugin';
    }
    return stack.indexOf(PLUGIN_PATH_MARK) >= 0 ? 'plugin' : 'host';
}
/**
 * A crash that belongs to Mattermost itself: the sidebar-category reducer.
 *
 * `mattermost-redux` builds the category map with
 * `collapsed: action.isWebSocket ? state[category.id].collapsed : category.collapsed`
 * (`reducers/entities/channel_categories.ts`). Over the WebSocket — a
 * `sidebar_category_updated` event — it reads the *local* copy first, and a category
 * the store has never seen has no local copy: `state[category.id]` is `undefined`,
 * `collapsed` throws, the dispatch rejects. Nothing unmounts, so this cannot blank
 * the page; the plugin takes no part in it either.
 *
 * Archived without the banner, like the autoplay refusal: the banner is a promise
 * that what it shows is ours, and a banner that cries wolf gets ignored — including
 * the one time it is telling the truth.
 */
function isKnownHostBug(record) {
    return record.origin === 'host' && record.message.indexOf("reading 'collapsed'") >= 0;
}
function push(record, showBanner = true) {
    if (kept.length >= MAX_KEPT) {
        return;
    }
    kept.push(record);
    mirror();
    if (showBanner) {
        drawBanner();
    }
}
function mirror() {
    try {
        if (typeof localStorage === 'undefined') {
            return;
        }
        localStorage.setItem(STORE_KEY, JSON.stringify(kept));
    }
    catch {
        // Private mode or a full quota: the banner is still there.
    }
}
/** Turns anything into a record; rejections arrive as values, not as errors. */
function describe(thrown, source) {
    const error = thrown;
    const message = error && typeof error.message === 'string' && error.message ?
        error.message :
        String(thrown);
    const stack = (error && typeof error.stack === 'string' ? error.stack : '').slice(0, 2000);
    return {
        at: new Date().toISOString(),
        message: message.slice(0, 400),
        stack,
        source,
        origin: originOf(stack),
    };
}
/**
 * Records one error that this plugin caused or took part in.
 *
 * Called from the global handlers below, from the React boundary, and from plugin
 * initialisation, so that a failure has one place to land instead of taking the page
 * down silently.
 */
function recordCrash(thrown, source = 'error', options) {
    const record = describe(thrown, source);
    if (isKnownHostBug(record)) {
        // eslint-disable-next-line no-console
        console.info('[customers-plugin] 宿主（Mattermost）自身报错，与本插件无关，已存档但不画横幅：' +
            `${record.message} —— channel_categories reducer：WebSocket 推来一个本地还没有的频道分类`);
        push(record, false);
        return;
    }
    push(record, !(options === null || options === void 0 ? void 0 : options.silent));
}
exports.recordCrash = recordCrash;
function bannerText(records) {
    return records.map((record, index) => (`#${index + 1} [${record.source}${record.origin === 'host' ? '·宿主' : ''}] ${record.at}\n` +
        `${record.message}\n${record.stack}`)).join('\n\n');
}
/** Host-only failures must not be introduced as this plugin's. */
function bannerTitle(records) {
    if (records.length > 0 && records.every((record) => record.origin === 'host')) {
        return `Mattermost 自身报错 ${records.length} 条（与本插件无关，仅记录；可截图反馈）`;
    }
    return `customers-plugin 报错 ${records.length} 条（页面若白屏，这段就是原因；可截图反馈）`;
}
function dismiss() {
    const existing = document.getElementById(BANNER_ID);
    if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
    }
}
function drawBanner() {
    if (typeof document === 'undefined' || !document.body || kept.length === 0) {
        return;
    }
    if (!isCrashBannerEnabled()) {
        // Recording never stops; only the painting does.
        return;
    }
    if (document.getElementById(BANNER_ID)) {
        // Already up: rewrite its body rather than stacking a second one.
        const body = document.getElementById(BANNER_ID + '-body');
        if (body) {
            body.textContent = bannerText(kept);
        }
        return;
    }
    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.setAttribute('style', [
        'position:fixed',
        'top:0',
        'left:0',
        'right:0',
        'z-index:2147483647',
        'max-height:45%',
        'overflow:auto',
        'padding:10px 12px',
        'background:#b3272d',
        'color:#fff',
        'font:12px/1.5 monospace',
        'box-shadow:0 2px 10px rgba(0,0,0,0.35)',
        'white-space:pre-wrap',
        'word-break:break-word',
    ].join(';'));
    const title = document.createElement('div');
    title.textContent = bannerTitle(kept);
    title.setAttribute('style', 'font-weight:700;margin-bottom:6px');
    banner.appendChild(title);
    const body = document.createElement('div');
    body.id = BANNER_ID + '-body';
    body.textContent = bannerText(kept);
    banner.appendChild(body);
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '关闭';
    close.setAttribute('style', [
        'margin-top:8px',
        'padding:4px 10px',
        'background:#fff',
        'color:#b3272d',
        'border:0',
        'border-radius:4px',
        'font:12px sans-serif',
        'cursor:pointer',
    ].join(';'));
    close.addEventListener('click', dismiss);
    banner.appendChild(close);
    document.body.appendChild(banner);
}
/**
 * Starts catching uncaught errors and unhandled rejections.
 *
 * Idempotent: the plugin initialises once per page load, but a re-mount must not
 * leave two sets of handlers recording the same failure twice.
 */
function installCrashReporter() {
    if (installed || typeof window === 'undefined') {
        return;
    }
    installed = true;
    window.addEventListener('error', (event) => {
        recordCrash(event.error || event.message, 'error');
    });
    window.addEventListener('unhandledrejection', (event) => {
        if (isBenignRejection(event.reason)) {
            recordCrash(event.reason, 'rejection', { silent: true });
            return;
        }
        recordCrash(event.reason, 'rejection');
    });
}
exports.installCrashReporter = installCrashReporter;
/** Test hook: puts the global handlers back the way they were. */
function uninstallCrashReporter() {
    installed = false;
    dismiss();
}
exports.uninstallCrashReporter = uninstallCrashReporter;
function readOverride() {
    try {
        if (typeof localStorage === 'undefined') {
            return null;
        }
        const value = localStorage.getItem(BANNER_OVERRIDE_KEY);
        if (value === 'on') {
            return true;
        }
        if (value === 'off') {
            return false;
        }
    }
    catch {
        // Private mode: the setting stands.
    }
    return null;
}
/**
 * Turns the banner on or off for this page load, from the server configuration.
 *
 * Enabling it late still shows everything recorded so far: the reporter is installed
 * before the configuration has arrived, and the errors of those first milliseconds
 * are exactly the ones that explain a blank page.
 */
function setCrashBannerEnabled(enabled) {
    bannerEnabled = Boolean(enabled);
    if (!bannerEnabled) {
        dismiss();
        return;
    }
    if (kept.length > 0) {
        drawBanner();
    }
}
exports.setCrashBannerEnabled = setCrashBannerEnabled;
/** Whether the banner would be drawn right now: the setting, or the local override. */
function isCrashBannerEnabled() {
    const override = readOverride();
    return override === null ? bannerEnabled : override;
}
exports.isCrashBannerEnabled = isCrashBannerEnabled;
