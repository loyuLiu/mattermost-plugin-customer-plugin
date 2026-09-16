// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {CutoffLookup, PostMeta} from './types/history';

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

/** Container of the (virtualized) centre post list. */
const POST_LIST_IDS = ['postListContent', 'virtualizedPostListContent'];

/** Debounce for MutationObserver bursts. */
const SYNC_DEBOUNCE_MS = 150;

/** Full rescan interval, as a safety net for virtualised rows. */
const RESCAN_MS = 3000;

export type GateProvider = {
    /** Looks a post up in the redux store. */
    getPostMeta: (postId: string) => PostMeta | undefined;

    /** Cutoff for a channel; undefined when it has not been fetched yet. */
    getCutoff: (channelId: string) => CutoffLookup;

    /** Asks the caller to fetch the cutoff; the gate re-syncs afterwards. */
    requestCutoff: (channelId: string) => void;
};

export type GateOptions = {
    provider: GateProvider;
    noticeEnabled: boolean;
    noticeText: string;

    /** When false, only the centre channel is filtered. */
    hideInSearch: boolean;
};

/**
 * Hides posts that the current user is not allowed to see.
 *
 * The hidden set is applied as a single stylesheet rule instead of per-node inline
 * styles: React cannot undo it on re-render, and the virtualised post list only
 * keeps a few dozen rows in the DOM, so the rule stays small.
 */
export class HistoryGate {
    private provider: GateProvider;
    private noticeEnabled: boolean;
    private noticeText: string;
    private hideInSearch: boolean;

    private style: HTMLStyleElement | null = null;
    private observer: MutationObserver | null = null;
    private interval: number | null = null;
    private debounce: number | null = null;
    private lastRule = '';
    private hiddenSeparators: HTMLElement[] = [];

    constructor(options: GateOptions) {
        this.provider = options.provider;
        this.noticeEnabled = options.noticeEnabled;
        this.noticeText = options.noticeText;
        this.hideInSearch = options.hideInSearch;
    }

    start(): void {
        this.ensureStyle();

        this.observer = new MutationObserver(() => this.schedule());

        // Only childList matters: hiding is done through a stylesheet rule and
        // separator visibility through the style attribute, neither of which
        // produces childList mutations (so this cannot feed back on itself).
        this.observer.observe(document.body, {childList: true, subtree: true});

        this.interval = window.setInterval(() => this.sync(), RESCAN_MS);
        this.sync();
    }

    stop(): void {
        this.observer?.disconnect();
        this.observer = null;

        if (this.interval !== null) {
            window.clearInterval(this.interval);
            this.interval = null;
        }

        if (this.debounce !== null) {
            window.clearTimeout(this.debounce);
            this.debounce = null;
        }

        this.restoreSeparators();
        this.removeNotice();

        this.style?.remove();
        this.style = null;
        this.lastRule = '';
    }

    private schedule(): void {
        if (this.debounce !== null) {
            return;
        }

        this.debounce = window.setTimeout(() => {
            this.debounce = null;
            this.sync();
        }, SYNC_DEBOUNCE_MS);
    }

    /** Recomputes the hidden set and applies it. Safe to call at any time. */
    sync(): void {
        const hidden = new Set<string>();

        document.querySelectorAll<HTMLElement>(POST_ROW_SELECTOR).forEach((row) => {
            const match = POST_ID_PATTERN.exec(row.id);
            if (!match) {
                return;
            }

            const [, location, postId] = match;
            if (!this.hideInSearch && location !== 'post') {
                return;
            }

            const meta = this.provider.getPostMeta(postId);
            if (!meta) {
                return;
            }

            const cutoff = this.provider.getCutoff(meta.channelId);
            if (cutoff === undefined) {
                this.provider.requestCutoff(meta.channelId);
                return;
            }

            if (cutoff > 0 && meta.createAt < cutoff) {
                hidden.add(row.id);
            }
        });

        this.applyRule(hidden);
        this.restoreSeparators();
        this.hideLeadingSeparators(hidden);
        this.updateNotice(hidden.size > 0);
    }

    private ensureStyle(): void {
        if (this.style) {
            return;
        }

        const style = document.createElement('style');
        style.id = STYLE_ID;

        // Lives in <head> so that writing to it does not re-trigger the observer.
        document.head.appendChild(style);
        this.style = style;
    }

    private applyRule(hidden: Set<string>): void {
        if (!this.style) {
            return;
        }

        let rule = '';
        if (hidden.size > 0) {
            const selectors = Array.from(hidden).map((id) => `[id="${id}"]`);
            rule = `${selectors.join(',')}{display:none !important;}`;
        }

        if (rule === this.lastRule) {
            return;
        }

        this.style.textContent = rule;
        this.lastRule = rule;
    }

    private restoreSeparators(): void {
        this.hiddenSeparators.forEach((el) => {
            el.style.removeProperty('display');
        });
        this.hiddenSeparators = [];
    }

    /**
     * Hides date separators that sit above the first visible post, i.e. the
     * separators belonging entirely to hidden history.
     */
    private hideLeadingSeparators(hidden: Set<string>): void {
        let container: HTMLElement | null = null;
        for (const id of POST_LIST_IDS) {
            container = document.getElementById(id);
            if (container) {
                break;
            }
        }

        if (!container) {
            return;
        }

        const children = Array.from(container.children) as HTMLElement[];
        let seenVisiblePost = false;

        for (const child of children) {
            if (POST_ID_PATTERN.test(child.id)) {
                if (!hidden.has(child.id)) {
                    seenVisiblePost = true;
                }

                continue;
            }

            if (!seenVisiblePost && child.classList.contains('BasicSeparator')) {
                child.style.setProperty('display', 'none', 'important');
                this.hiddenSeparators.push(child);
            }
        }
    }

    private updateNotice(visible: boolean): void {
        const existing = document.getElementById(NOTICE_ID);

        if (!visible || !this.noticeEnabled) {
            existing?.remove();
            return;
        }

        const host = document.getElementById('channel-header');
        if (!host) {
            return;
        }

        const notice = existing ?? document.createElement('div');
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

    private removeNotice(): void {
        document.getElementById(NOTICE_ID)?.remove();
    }
}
