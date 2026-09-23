// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

const STYLE_ID = 'customers-plugin-read-status-style';
const BADGE_CLASS = 'customers-plugin-read-badge';
const DOT_CLASS = 'customers-plugin-read-dot';

/**
 * Mattermost renders posts with predictable element ids:
 *   center channel -> post_<id>, right-hand side -> rhsPost_<id>,
 *   search results -> searchResult_<id>
 * Confirmed against webapp/channels/src/components/post/post_component.tsx (10.12).
 */
const POST_ROW_SELECTOR = '[id^="post_"],[id^="rhsPost_"],[id^="searchResult_"]';
const POST_ID_PATTERN = /^(post|rhsPost|searchResult)_(.+)$/;

/**
 * Only direct and group messages are marked. `Constants.DM_CHANNEL` and
 * `Constants.GM_CHANNEL` in the webapp; inlined so the engine needs no webapp imports
 * and stays testable on its own.
 */
const DM_CHANNEL = 'D';
const GM_CHANNEL = 'G';

/** Debounce for MutationObserver bursts. */
const SYNC_DEBOUNCE_MS = 150;

/** Full rescan interval: the read position changes without touching the DOM. */
const RESCAN_MS = 3000;

/** Labels rendered next to the dot. */
const LABEL_UNREAD = '未讀';
const LABEL_READ = '已讀';

/**
 * The badge sits in the top-right corner of the post row. Colours follow the webapp
 * theme: `--away-indicator` (amber) for unread, `--online-indicator` (green) for read.
 */
const BADGE_CSS =
    `.${BADGE_CLASS}{` +
    'position:absolute;top:4px;right:8px;display:inline-flex;align-items:center;gap:4px;' +
    'padding:1px 6px;border-radius:9px;font-size:11px;line-height:16px;white-space:nowrap;' +
    'pointer-events:none;z-index:2;' +
    'color:var(--center-channel-color,#3f4350);' +
    'background:var(--center-channel-bg,#ffffff);' +
    'box-shadow:0 0 0 1px rgba(var(--center-channel-color-rgb,63,67,80),0.16);' +
    '}' +
    `.${BADGE_CLASS} .${DOT_CLASS}{width:6px;height:6px;border-radius:50%;flex:none;}` +
    `.${BADGE_CLASS}.is-unread .${DOT_CLASS}{background:var(--away-indicator,#ffbc1f);}` +
    `.${BADGE_CLASS}.is-read .${DOT_CLASS}{background:var(--online-indicator,#3db887);}`;

export type PostReadMeta = {
    /** Creation time of the post, in milliseconds. */
    createAt: number;

    /** Channel the post belongs to; the read position is per conversation. */
    channelId: string;

    /** Author of the post. Own posts are judged against the counterpart, not oneself. */
    userId: string;
};

/** Marker applied to a post row. `null` means "no marker at all". */
export type ReadState = 'unread' | 'read' | null;

export type ReadStatusProvider = {
    /** Looks a post up in the redux store. */
    getPostMeta: (postId: string) => PostReadMeta | undefined;

    /** Id of the logged-in user; decides which read position a post is judged against. */
    getCurrentUserId: () => string | undefined;

    /**
     * Time the current user last visited a conversation, in milliseconds, taken from
     * `entities.channels.myMembers[channelId].last_viewed_at`. Undefined when the
     * membership is unknown, in which case nothing is marked.
     */
    getLastViewedAt: (channelId: string) => number | undefined;

    /**
     * Time the *counterpart* last visited the conversation, in milliseconds. It comes
     * from the plugin's `/api/v1/read/peer` endpoint, because the webapp store only ever
     * holds the memberships of the logged-in user. Undefined until the answer arrives,
     * in which case nothing is marked yet.
     */
    getPeerLastViewedAt: (channelId: string) => number | undefined;

    /** Asks for the counterpart's read position. Called when it is not cached yet. */
    requestPeerLastViewedAt: (channelId: string) => void;

    /**
     * Channel type, e.g. `D` for a direct message and `G` for a group message. Only
     * those two are marked.
     */
    getChannelType: (channelId: string) => string | undefined;
};

/**
 * Marks direct and group messages with their read state in the top-right corner:
 * an amber dot plus "未讀" for messages that have not been read yet, a green dot plus
 * "已讀" for the ones that have.
 *
 * Whose read state it is depends on the author, which is the whole point of the feature:
 *   - a message the user received -> has *she* read it? (`myMembers.last_viewed_at`)
 *   - a message the user sent     -> has the *counterpart* read it? (plugin endpoint)
 * Judging own messages against one's own read position would mark every one of them as
 * read the moment it is sent, which says nothing.
 *
 * A message counts as unread when it was created after the relevant read position.
 * Channels are never marked.
 *
 * The badge is appended to the post row itself rather than to its header: React owns
 * the header and rebuilds it on hover, while the row element survives re-renders, so
 * the marker does not flicker. The row is made a positioning context so the badge can
 * be absolutely placed in its top-right corner.
 *
 * Every pass is idempotent — the badge is only rebuilt when its state actually changes
 * — so the MutationObserver cannot feed back on itself.
 */
export class ReadStatusEngine {
    private provider: ReadStatusProvider;

    private style: HTMLStyleElement | null = null;
    private observer: MutationObserver | null = null;
    private interval: number | null = null;
    private debounce: number | null = null;
    private started = false;

    constructor(provider: ReadStatusProvider) {
        this.provider = provider;
    }

    public start(): void {
        this.started = true;
        this.ensureStyle();

        this.observer = new MutationObserver(() => this.schedule());
        this.observer.observe(document.body, {childList: true, subtree: true});

        this.interval = window.setInterval(() => this.sync(), RESCAN_MS);
        this.sync();
    }

    public stop(): void {
        this.started = false;

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

        this.clearBadges();

        this.style?.remove();
        this.style = null;
    }

    /**
     * Recomputes the markers. Safe to call at any time; does nothing once the engine
     * has been stopped, so a late call cannot resurrect badges without their stylesheet.
     * Returns the number of marked posts.
     */
    public sync(): number {
        if (!this.started) {
            return 0;
        }

        let marked = 0;

        document.querySelectorAll<HTMLElement>(POST_ROW_SELECTOR).forEach((row) => {
            const match = POST_ID_PATTERN.exec(row.id);
            const state = match ? this.readStateOf(match[2]) : null;

            if (!state) {
                this.removeBadge(row);
                return;
            }

            this.applyBadge(row, state);
            marked++;
        });

        return marked;
    }

    private readStateOf(postId: string): ReadState {
        const meta = this.provider.getPostMeta(postId);
        if (!meta) {
            return null;
        }

        if (!this.isDirectMessage(meta.channelId)) {
            return null;
        }

        // Received messages are judged against one's own read position; sent ones
        // against the counterpart's, which the plugin server has to supply.
        const isOwn = !!meta.userId && meta.userId === this.provider.getCurrentUserId();
        if (isOwn) {
            const peerAt = this.provider.getPeerLastViewedAt(meta.channelId);
            if (peerAt === undefined) {
                this.provider.requestPeerLastViewedAt(meta.channelId);
                return null;
            }

            return meta.createAt > peerAt ? 'unread' : 'read';
        }

        const lastViewedAt = this.provider.getLastViewedAt(meta.channelId);
        if (lastViewedAt === undefined) {
            return null;
        }

        return meta.createAt > lastViewedAt ? 'unread' : 'read';
    }

    private isDirectMessage(channelId: string): boolean {
        const type = this.provider.getChannelType(channelId);
        return type === DM_CHANNEL || type === GM_CHANNEL;
    }

    private applyBadge(row: HTMLElement, state: Exclude<ReadState, null>): void {
        const existing = row.querySelector<HTMLElement>(`.${BADGE_CLASS}`);
        if (existing && existing.dataset.readState === state) {
            return;
        }

        existing?.remove();

        // The badge is absolutely positioned, so the row has to establish a containing
        // block. Inline style survives React re-renders better than a class, which
        // React overwrites together with the rest of `className`.
        if (row.style.position !== 'relative') {
            row.style.position = 'relative';
        }

        const badge = document.createElement('span');
        badge.className = `${BADGE_CLASS} ${state === 'unread' ? 'is-unread' : 'is-read'}`;
        badge.dataset.readState = state;
        badge.setAttribute('aria-hidden', 'true');

        const dot = document.createElement('span');
        dot.className = DOT_CLASS;
        badge.appendChild(dot);
        badge.appendChild(document.createTextNode(state === 'unread' ? LABEL_UNREAD : LABEL_READ));

        row.appendChild(badge);
    }

    private removeBadge(row: HTMLElement): void {
        row.querySelector(`.${BADGE_CLASS}`)?.remove();
    }

    private clearBadges(): void {
        document.querySelectorAll(`.${BADGE_CLASS}`).forEach((badge) => badge.remove());
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

    private ensureStyle(): void {
        if (this.style) {
            return;
        }

        const style = document.createElement('style');
        style.id = STYLE_ID;

        // Lives in <head> so that writing to it does not re-trigger the observer.
        document.head.appendChild(style);
        this.style = style;
        style.textContent = BADGE_CSS;
    }
}
