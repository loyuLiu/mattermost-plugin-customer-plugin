"use strict";
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
Object.defineProperty(exports, "__esModule", { value: true });
exports.HistoryGate = exports.planViewportRecovery = void 0;
const STYLE_ID = 'customers-plugin-history-gate-style';
const NOTICE_ID = 'customers-plugin-history-notice';
/**
 * Mattermost renders posts with predictable element ids:
 *   center channel -> post_<id>, right-hand side -> rhsPost_<id>,
 *   search results -> searchResult_<id>
 * Confirmed against webapp/channels/src/components/post/post_component.tsx (10.12).
 */
const POST_ROW_SELECTOR = '[id^="post_"],[id^="rhsPost_"],[id^="searchResult_"]';
const POST_ID_PATTERN = /^(post|rhsPost|searchResult)_(.+)$/;
/**
 * Prefix Mattermost puts in front of every system ("user activity") post id.
 *
 * `makeCombineUserActivityPosts` (mattermost-redux `utils/post_list.js`) rewrites
 * the ids of consecutive system posts into `user-activity-<id>[_<id>...]`, and it
 * does that even when the group holds a single post. `makeGenerateCombinedPost`
 * then synthesises the row straight from the underlying posts, so the combined id
 * **never exists in the redux store** — looking it up as-is finds nothing, and
 * every "X joined the channel" row sailed straight through the gate.
 */
const COMBINED_PREFIX = 'user-activity-';
/**
 * The real post ids behind a row id: one for an ordinary post, several for a
 * combined system row (`user-activity-<newest>_..._<oldest>`).
 */
function expandPostIds(postId) {
    if (!postId.startsWith(COMBINED_PREFIX)) {
        return [postId];
    }
    return postId.slice(COMBINED_PREFIX.length).split('_').filter((id) => id.length > 0);
}
/** Container of the (virtualized) centre post list. */
const POST_LIST_IDS = ['postListContent', 'virtualizedPostListContent'];
/**
 * The element that actually scrolls: the outer div of `DynamicVirtualizedList`
 * (post_list_virtualized.tsx passes `id='postListScrollContainer'` to it).
 *
 * `.innerList` is its only child, so the two are parent/child — which is how we
 * make sure a scroll correction only ever touches the centre channel.
 */
const SCROLLER_ID = 'postListScrollContainer';
/** How often a scroll may trigger a re-sync, in milliseconds. */
const SCROLL_SYNC_MS = 150;
/**
 * How long a user gesture keeps the scroll recovery quiet, in milliseconds.
 *
 * The recovery moves the viewport by itself, which is exactly what must never
 * happen while somebody is scrolling: they would be yanked away from wherever
 * they were reading. Waiting for a short pause after the last gesture keeps the
 * automatic fix (right after loading a channel) and drops the fights.
 */
const GESTURE_SUPPRESS_MS = 800;
/**
 * Root id of the "channel intro" row (welcome text of a fresh channel), rendered
 * by `ChannelIntroMessage` whenever the list sits at the channel's oldest post.
 *
 * With the post stream filtered, the oldest *kept* post is the first one after
 * the cutoff, so the intro shows up right above the join marker — exactly the
 * "频道起点信息" the gated member must not see. The row carries no post id, so
 * it is collected separately from the post scan.
 */
const INTRO_ID = 'channelIntro';
/**
 * The virtualised list wraps every item in `<div class="item_measurer">` and
 * measures **that wrapper** to size the row
 * (`dynamic_virtualized_list/list_item.tsx`, 10.12).
 *
 * Hiding only the post element inside it leaves the wrapper measured at whatever
 * height it happens to have, and every hidden history row then contributes a gap.
 * Those gaps are what "the channel looks blank until you scroll" is made of.
 */
const ROW_HOST_SELECTOR = '.item_measurer';
/** Rows definitely hidden by the gate. Applied to the whole measured wrapper. */
const HIDDEN_ATTR = 'data-customers-history-hidden';
/** Rows waiting for their boundary. Keeps its box, loses its content. */
const PENDING_ATTR = 'data-customers-history-pending';
/** Full rescan interval, as a safety net for virtualised rows. */
const RESCAN_MS = 3000;
/**
 * Decides whether the post list has to be sent back to its bottom.
 *
 * Pure so that it can be asserted without a layout engine: jsdom reports every
 * rect as 0, so the decision itself can never be tested through the DOM.
 *
 * Since 0.6.8 the post stream is filtered before it reaches redux, so a gated
 * member's list holds nothing but messages they may see and this plan is a pure
 * safety net: it only fires when the viewport is staring at empty space, which is
 * a state no user can mean to be in — a collapsed row has no height to scroll
 * into. The visible messages are always the newest ones, i.e. the bottom of the
 * list, so that is the only direction worth moving.
 */
function planViewportRecovery(viewportTop, viewportBottom, visibleTop, visibleBottom, hasVisible) {
    if (!hasVisible) {
        return { mode: 'bottom' };
    }
    // Any overlap at all means the viewport holds a message: leave it alone.
    if (visibleBottom > viewportTop && visibleTop < viewportBottom) {
        return { mode: 'none' };
    }
    return { mode: 'bottom' };
}
exports.planViewportRecovery = planViewportRecovery;
/**
 * The element whose height the virtualised list will measure for this row.
 *
 * Falls back to the row itself outside the virtualised list (right-hand side,
 * search results, the non-virtualised layout), where there is no wrapper.
 */
function rowHost(row) {
    var _a;
    return (_a = row.closest(ROW_HOST_SELECTOR)) !== null && _a !== void 0 ? _a : row;
}
/** True for the date separator rows (`Separator` + `BasicSeparator`). */
function isSeparator(el) {
    return el.classList.contains('BasicSeparator');
}
/**
 * The post row held by one list item, or null when the item is something else
 * (a date separator, the new-messages line, the "load more" row).
 */
function rowIn(item) {
    if (POST_ID_PATTERN.test(item.id)) {
        return item;
    }
    return item.querySelector(POST_ROW_SELECTOR);
}
/**
 * Hides posts that the current user is not allowed to see.
 *
 * The hidden set is applied as a single stylesheet rule instead of per-node inline
 * styles: React cannot undo it on re-render, and the virtualised post list only
 * keeps a few dozen rows in the DOM, so the rule stays small.
 */
class HistoryGate {
    constructor(options) {
        var _a;
        this.style = null;
        this.observer = null;
        this.interval = null;
        this.lastRule = '';
        this.hiddenSeparators = [];
        this.marked = [];
        this.started = false;
        this.lastGestureAt = 0;
        this.lastScrollSyncAt = 0;
        this.programmaticUntil = 0;
        /** Re-syncs after a scroll, but at most once per `SCROLL_SYNC_MS`. */
        this.onScroll = () => {
            if (Date.now() < this.programmaticUntil) {
                return;
            }
            this.lastGestureAt = Date.now();
            const now = Date.now();
            if (now - this.lastScrollSyncAt < SCROLL_SYNC_MS) {
                return;
            }
            this.lastScrollSyncAt = now;
            this.sync();
        };
        /** Remembers that a human is driving, so the recovery stays out of the way. */
        this.onGesture = () => {
            this.lastGestureAt = Date.now();
        };
        this.provider = options.provider;
        this.noticeEnabled = options.noticeEnabled;
        this.noticeText = options.noticeText;
        this.hideInSearch = options.hideInSearch;
        this.pendingPolicy = (_a = options.pendingPolicy) !== null && _a !== void 0 ? _a : 'blank';
    }
    start() {
        this.started = true;
        this.ensureStyle();
        // Synced straight from the observer callback rather than through a timer.
        //
        // Timing requirement, in order:
        //  1. before the browser paints, or the user sees history flash by;
        //  2. before `list_item.tsx` measures the row, or the virtualised list
        //     records a non-zero height for a row we are about to collapse.
        //
        // `MutationObserver` callbacks run in the microtask queue right after the
        // mutations, i.e. earlier than either React's passive effects or the next
        // paint, so syncing here satisfies both. One callback already covers a
        // whole React commit, so this does not degenerate into one scan per node.
        this.observer = new MutationObserver(() => this.sync());
        // Only childList matters: hiding is done through a stylesheet rule and
        // separator visibility through the style attribute, neither of which
        // produces childList mutations (so this cannot feed back on itself).
        this.observer.observe(document.body, { childList: true, subtree: true });
        // Scrolls change which rows exist (virtualisation) without necessarily
        // producing the childList mutations the observer sees, and they are the
        // moment a stale row height becomes visible. Capture, so that the inner
        // scroller is caught too.
        window.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
        window.addEventListener('wheel', this.onGesture, { capture: true, passive: true });
        window.addEventListener('touchmove', this.onGesture, { capture: true, passive: true });
        window.addEventListener('keydown', this.onGesture, { capture: true });
        this.interval = window.setInterval(() => this.sync(), RESCAN_MS);
        this.sync();
    }
    stop() {
        var _a, _b;
        this.started = false;
        (_a = this.observer) === null || _a === void 0 ? void 0 : _a.disconnect();
        this.observer = null;
        window.removeEventListener('scroll', this.onScroll, { capture: true });
        window.removeEventListener('wheel', this.onGesture, { capture: true });
        window.removeEventListener('touchmove', this.onGesture, { capture: true });
        window.removeEventListener('keydown', this.onGesture, { capture: true });
        if (this.interval !== null) {
            window.clearInterval(this.interval);
            this.interval = null;
        }
        this.restoreSeparators();
        this.removeNotice();
        this.clearMarks();
        (_b = this.style) === null || _b === void 0 ? void 0 : _b.remove();
        this.style = null;
        this.lastRule = '';
    }
    /**
     * Recomputes the hidden set and applies it. Safe to call at any time.
     *
     * Returns the number of rows that were actually removed from view, which the
     * caller can use to decide whether the "history hidden" notice applies.
     */
    sync() {
        var _a, _b;
        if (!this.started) {
            return 0;
        }
        const hidden = new Set();
        const pending = new Set();
        // Rows that are real, hidden post rows — the intro row does not count,
        // or the "history hidden" notice would show merely because the welcome
        // text was removed.
        let hiddenPostRows = 0;
        document.querySelectorAll(POST_ROW_SELECTOR).forEach((row) => {
            const match = POST_ID_PATTERN.exec(row.id);
            if (!match) {
                return;
            }
            const [, location, postId] = match;
            if (!this.hideInSearch && location !== 'post') {
                return;
            }
            // A system row can stand for several posts. They are always from the
            // same channel, so the first one that resolves picks the cutoff.
            const metas = expandPostIds(postId).
                map((id) => this.provider.getPostMeta(id)).
                filter((meta) => Boolean(meta));
            if (metas.length === 0) {
                return;
            }
            if (metas.some((meta) => meta.forceVisible)) {
                return;
            }
            const channelId = metas[0].channelId;
            const cutoff = this.provider.getCutoff(channelId);
            if (cutoff === undefined) {
                // Still in flight. Never show history we have not cleared yet: keep
                // the row in place (so the scroll position does not move) but blank.
                this.provider.requestCutoff(channelId);
                if (this.pendingPolicy === 'blank') {
                    pending.add(rowHost(row));
                }
                return;
            }
            // Hide as soon as any covered post is history. The combined row would
            // show it anyway, and its own timestamp is the *oldest* post of the
            // group, so this is exactly what Mattermost renders for it.
            if (cutoff > 0 && metas.some((meta) => meta.createAt < cutoff)) {
                hidden.add(rowHost(row));
                hiddenPostRows++;
            }
        });
        // The intro row: hide it when the channel being viewed is gated. With the
        // post stream filtered the intro only appears once the list has walked all
        // the way down to the first kept post, and it sits right above the join
        // marker — visible to the member, meant to be removed.
        const introHost = this.introRowHost();
        if (introHost) {
            const channelId = (_b = (_a = this.provider).getCurrentChannelId) === null || _b === void 0 ? void 0 : _b.call(_a);
            const cutoff = channelId === undefined ? undefined : this.provider.getCutoff(channelId);
            if (cutoff !== undefined && cutoff > 0) {
                hidden.add(introHost);
            }
        }
        this.applyRules(hidden, pending);
        this.restoreSeparators();
        this.hideLeadingSeparators(hidden);
        this.recoverViewport(hidden);
        this.updateNotice(hiddenPostRows > 0);
        return hiddenPostRows;
    }
    /**
     * The measured wrapper around the channel-intro row, or null when it is not
     * rendered right now (it only exists while the list is at the oldest post).
     */
    introRowHost() {
        var _a;
        const intro = document.getElementById(INTRO_ID);
        if (!intro) {
            return null;
        }
        return (_a = intro.closest(ROW_HOST_SELECTOR)) !== null && _a !== void 0 ? _a : intro;
    }
    /**
     * Brings the visible messages back on screen when the viewport is staring at
     * nothing but collapsed history.
     *
     * A safety net, not the mechanism: since 0.6.8 the post stream is filtered
     * before it reaches redux, so history is normally never rendered at all. The
     * filter falls back to letting rows through when the boundary cannot be
     * fetched (network, timeout), and it is only then that a row can be measured
     * before the gate collapses it — and a row measured before the collapse keeps
     * its old height in `itemSizeMap` forever (the shared ResizeObserver that
     * would correct it is debounced by 200 ms and cancelled outright when the row
     * unmounts first). Once the row leaves the render window that stale height is
     * replayed by a placeholder div that carries neither class nor id, so no
     * stylesheet can reach it.
     *
     * A viewport that holds no visible message is never a place a user meant to be:
     * a collapsed row has no height to scroll into. So stepping in there is safe,
     * and it converges in one step. It is additionally muted for a moment after
     * every user gesture, so it can never fight somebody who is scrolling.
     */
    recoverViewport(hidden) {
        if (hidden.size === 0) {
            return;
        }
        if (Date.now() - this.lastGestureAt < GESTURE_SUPPRESS_MS) {
            return;
        }
        const scroller = document.getElementById(SCROLLER_ID);
        const container = this.listContainer();
        if (!scroller || !container || container.parentElement !== scroller) {
            return;
        }
        const box = scroller.getBoundingClientRect();
        if (box.height <= 0) {
            // Not laid out (or a headless DOM): every rect is 0 and any decision
            // made from them would be noise.
            return;
        }
        // Visible messages are the newest ones, so they are always one contiguous
        // block. Its bounding box is enough to decide whether anything is on screen.
        let top = Infinity;
        let bottom = -Infinity;
        let found = false;
        for (const child of Array.from(container.children)) {
            const row = rowIn(child);
            if (!row || hidden.has(rowHost(row))) {
                continue;
            }
            const rect = row.getBoundingClientRect();
            if (rect.bottom <= rect.top) {
                continue;
            }
            if (rect.top < top) {
                top = rect.top;
            }
            if (rect.bottom > bottom) {
                bottom = rect.bottom;
            }
            found = true;
        }
        const plan = planViewportRecovery(box.top, box.bottom, top, bottom, found);
        if (plan.mode === 'none') {
            return;
        }
        this.programmaticUntil = Date.now() + 200;
        scroller.scrollTop = scroller.scrollHeight;
    }
    ensureStyle() {
        if (this.style) {
            return;
        }
        const style = document.createElement('style');
        style.id = STYLE_ID;
        // Lives in <head> so that writing to it does not re-trigger the observer.
        document.head.appendChild(style);
        this.style = style;
    }
    /**
     * Writes the two rules that make up the gate.
     *
     * `hidden` rows are removed from the layout outright; `pending` rows keep their
     * box and only lose their content, so a boundary that is still in flight cannot
     * either leak history or make the post list jump.
     *
     * Both are marked on the element the virtualised list actually measures, which
     * is why this has to be a `data-` attribute rather than an id selector: the row
     * wrapper carries no id.
     */
    applyRules(hidden, pending) {
        if (!this.style) {
            return;
        }
        this.clearMarks();
        let rule = '';
        if (hidden.size > 0) {
            hidden.forEach((row) => row.setAttribute(HIDDEN_ATTR, 'true'));
            // Deliberately *not* `display:none`.
            //
            // The row's height is recorded in `DynamicVirtualizedList`'s
            // `itemSizeMap` and, once the row leaves the render window, is
            // replayed by a placeholder div (`height: <cached>`) that carries no
            // class or id — unreachable from CSS. A row that was measured while
            // it was still visible therefore keeps reserving its old height
            // forever unless the list is told about the collapse, and the only
            // channel we have for that is the shared ResizeObserver in
            // `list_item.tsx`. That observer skips elements without a box, which
            // is exactly what `display:none` produces, and its 200 ms debounce is
            // cancelled outright if the row unmounts first — so the collapse is
            // frequently never reported and the top of the channel fills up with
            // invisible-but-space-taking boxes.
            //
            // `height:0` keeps a (zero-sized) box, so the observer always fires
            // and always reports 0, and the mount-time measurement
            // (`rowRef.current.offsetHeight`) is 0 either way.
            rule += `[${HIDDEN_ATTR}]{` +
                'height:0 !important;' +
                'min-height:0 !important;' +
                'max-height:0 !important;' +
                'padding-top:0 !important;' +
                'padding-bottom:0 !important;' +
                'border-top-width:0 !important;' +
                'border-bottom-width:0 !important;' +
                'margin-top:0 !important;' +
                'margin-bottom:0 !important;' +
                'overflow:hidden !important;' +
                'visibility:hidden !important;' +
                '}';
        }
        if (pending.size > 0) {
            pending.forEach((row) => row.setAttribute(PENDING_ATTR, 'true'));
            rule += `[${PENDING_ATTR}]{visibility:hidden !important;}`;
        }
        this.marked = [...hidden, ...pending];
        if (rule === this.lastRule) {
            return;
        }
        this.style.textContent = rule;
        this.lastRule = rule;
    }
    clearMarks() {
        this.marked.forEach((row) => {
            row.removeAttribute(HIDDEN_ATTR);
            row.removeAttribute(PENDING_ATTR);
        });
        this.marked = [];
    }
    restoreSeparators() {
        this.hiddenSeparators.forEach((el) => {
            el.style.removeProperty('display');
        });
        this.hiddenSeparators = [];
    }
    /**
     * Hides date separators that sit above the first visible post, i.e. the
     * separators belonging entirely to hidden history.
     *
     * The whole measured wrapper has to go, exactly like for post rows — a
     * separator left at its natural height contributes the same kind of gap.
     */
    hideLeadingSeparators(hidden) {
        const container = this.listContainer();
        if (!container) {
            return;
        }
        const children = Array.from(container.children);
        let seenVisiblePost = false;
        for (const child of children) {
            const row = rowIn(child);
            if (row) {
                if (!hidden.has(rowHost(row))) {
                    // Everything past the first visible post is left alone, so
                    // there is nothing left to scan — and under virtualisation
                    // this list can hold hundreds of entries.
                    seenVisiblePost = true;
                    break;
                }
                continue;
            }
            if (!seenVisiblePost && (isSeparator(child) || child.querySelector('.BasicSeparator'))) {
                child.style.setProperty('display', 'none', 'important');
                this.hiddenSeparators.push(child);
            }
        }
    }
    /**
     * The element that actually holds the rows.
     *
     * Under virtualisation the rows live in `.innerList`, several levels below
     * `#virtualizedPostListContent`, so walking up from one of them is both more
     * reliable and cheaper than guessing a container id.
     */
    listContainer() {
        const anchor = document.querySelector(POST_ROW_SELECTOR);
        if (anchor) {
            const inner = anchor.closest('.innerList');
            if (inner) {
                return inner;
            }
        }
        for (const id of POST_LIST_IDS) {
            const el = document.getElementById(id);
            if (el) {
                return el;
            }
        }
        return null;
    }
    updateNotice(visible) {
        const existing = document.getElementById(NOTICE_ID);
        if (!visible || !this.noticeEnabled) {
            existing === null || existing === void 0 ? void 0 : existing.remove();
            return;
        }
        const host = document.getElementById('channel-header');
        if (!host) {
            return;
        }
        const notice = existing !== null && existing !== void 0 ? existing : document.createElement('div');
        if (!existing) {
            notice.id = NOTICE_ID;
            notice.style.display = 'inline-flex';
            notice.style.alignItems = 'center';
            notice.style.marginLeft = '8px';
            notice.style.padding = '2px 8px';
            notice.style.borderRadius = '4px';
            notice.style.fontSize = '12px';
            notice.style.maxWidth = '320px';
            notice.style.whiteSpace = 'nowrap';
            notice.style.overflow = 'hidden';
            notice.style.textOverflow = 'ellipsis';
            notice.style.opacity = '0.75';
            host.appendChild(notice);
        }
        const text = this.noticeText;
        if (notice.textContent !== text) {
            notice.textContent = text;
        }
        notice.title = text;
    }
    removeNotice() {
        var _a;
        (_a = document.getElementById(NOTICE_ID)) === null || _a === void 0 ? void 0 : _a.remove();
    }
}
exports.HistoryGate = HistoryGate;
