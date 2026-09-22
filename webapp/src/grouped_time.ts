// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {Formatter} from './format';
import {createFormatter} from './format';

const STYLE_ID = 'customers-plugin-grouped-time-style';
const OVERLAY_ID = 'customers-plugin-grouped-time-overlay';

/**
 * Mattermost merges consecutive posts of the same author into a single block: from the
 * second post on, the profile picture is dropped and the timestamp is only rendered
 * while the row is hovered
 * (`post_component.tsx`: class `same--root` plus `hideProfilePicture`).
 *
 * This overlay renders that timestamp in a floating box instead, using the same custom
 * format as every other timestamp, and optionally hides the inline hover timestamp so
 * that the same value is not shown twice.
 *
 * `same--root` is the single marker Mattermost puts on "second or later row of a block"
 * (`hasSameRoot()`), and it covers both block shapes, so matching it alone gives the
 * same "from the second message on" rule everywhere:
 *   - consecutive root posts of one author — the classic merged block, whose `<time>`
 *     does not exist in the DOM at all until the row is hovered;
 *   - replies rendered inline in the channel (`post.root_id` set and collapsed threads
 *     off) — `hasSameRoot()` returns true for every reply with a `root_id`, but false
 *     for `isFirstReply`, so the first reply of a thread stays `other--root` and keeps
 *     its own header, exactly like the first message of a merged block.
 *
 * Centre channel only: rows there carry the id `post_<id>` and live in
 * `#postListContent` / `#virtualizedPostListContent`.
 */
const POST_ID_PATTERN = /^post_(.+)$/;
const POST_LIST_CONTAINERS = '#postListContent,#virtualizedPostListContent';

/** Hides the timestamp Mattermost renders in the header of a covered row. */
const HIDE_INLINE_CSS =
    '#postListContent .post.same--root .post__header time.post__time,' +
    '#virtualizedPostListContent .post.same--root .post__header time.post__time' +
    '{display:none !important;}';

/** Distance between the pointer and the box when it follows the cursor. */
const CURSOR_OFFSET_X = 14;
const CURSOR_OFFSET_Y = 18;

/** Keeps the box fully inside the viewport. */
const VIEWPORT_MARGIN = 8;

export type GroupedTimePosition = 'cursor' | 'left' | 'right';

export type GroupedTimeOptions = {
    /** Token based format string, e.g. "YYYY-MM-DD HH:mm". */
    format: string;

    /** BCP-47 locale used for localized month / weekday names. */
    locale: string;

    /** Optional IANA timezone; falls back to the browser timezone. */
    timeZone?: string;

    /** Where the floating box is anchored. */
    position: GroupedTimePosition;

    /** Hide the inline timestamp Mattermost shows on hover. */
    hideInline: boolean;
};

export type GroupedTimeProvider = {
    /** Resolves the creation time of a post, in milliseconds. */
    getCreateAt: (postId: string) => number | undefined;
};

type PointerState = {
    x: number;
    y: number;
    target: EventTarget | null;
};

/**
 * Floating timestamp for merged (consecutive) posts.
 *
 * A single element is reused and repositioned on pointer movement; the work is
 * coalesced into one animation frame so that fast mouse movement cannot flood the
 * main thread. The box never receives pointer events, so it cannot swallow clicks or
 * hover states of the message underneath it.
 */
export class GroupedTimeOverlay {
    private provider: GroupedTimeProvider;
    private options: GroupedTimeOptions | null = null;
    private formatter: Formatter | null = null;
    private overlay: HTMLDivElement | null = null;
    private style: HTMLStyleElement | null = null;
    private pointer: PointerState | null = null;
    private frame: number | null = null;
    private attached = false;

    constructor(provider: GroupedTimeProvider) {
        this.provider = provider;
    }

    /** Activates or updates the overlay. Pass `null` to disable it. */
    public update(options: GroupedTimeOptions | null): void {
        if (!options) {
            this.stop();
            return;
        }

        const needsNewFormatter = !this.options ||
            this.options.format !== options.format ||
            this.options.locale !== options.locale ||
            this.options.timeZone !== options.timeZone;

        const styleChanged = !this.options || this.options.hideInline !== options.hideInline;
        this.options = options;

        if (needsNewFormatter || !this.formatter) {
            this.formatter = createFormatter(options.format, options.locale, options.timeZone);
        }

        if (styleChanged) {
            this.applyStyle(options.hideInline);
        }

        this.attach();
    }

    /** Removes listeners, the box and the injected stylesheet. */
    public stop(): void {
        this.detach();

        if (this.frame !== null) {
            if (typeof cancelAnimationFrame === 'function') {
                cancelAnimationFrame(this.frame);
            } else {
                clearTimeout(this.frame);
            }
            this.frame = null;
        }

        this.overlay?.remove();
        this.overlay = null;

        this.style?.remove();
        this.style = null;

        this.options = null;
        this.formatter = null;
        this.pointer = null;
    }

    /** True while the box is visible. Exposed for tests. */
    public isVisible(): boolean {
        return Boolean(this.overlay && this.overlay.style.display === 'block');
    }

    /** Current text of the box. Exposed for tests. */
    public getText(): string {
        return this.overlay ? (this.overlay.textContent || '') : '';
    }

    private attach(): void {
        if (this.attached) {
            return;
        }

        document.addEventListener('mousemove', this.handleMouseMove, {passive: true});
        document.addEventListener('mouseleave', this.handleLeave);

        // Scrolling moves the row out from under the cursor without producing a
        // mouse event, so the box has to disappear. Capture phase catches the
        // virtualised list scrolling as well.
        document.addEventListener('scroll', this.handleLeave, true);
        window.addEventListener('blur', this.handleLeave);

        this.attached = true;
    }

    private detach(): void {
        if (!this.attached) {
            return;
        }

        document.removeEventListener('mousemove', this.handleMouseMove);
        document.removeEventListener('mouseleave', this.handleLeave);
        document.removeEventListener('scroll', this.handleLeave, true);
        window.removeEventListener('blur', this.handleLeave);

        this.attached = false;
    }

    private handleMouseMove = (event: Event): void => {
        const mouse = event as MouseEvent;
        this.pointer = {x: mouse.clientX, y: mouse.clientY, target: mouse.target};
        this.schedule();
    };

    private handleLeave = (): void => {
        this.pointer = null;
        this.hide();
    };

    private schedule(): void {
        if (this.frame !== null) {
            return;
        }

        const run = () => {
            this.frame = null;
            this.render();
        };

        if (typeof requestAnimationFrame === 'function') {
            this.frame = requestAnimationFrame(run);
        } else {
            this.frame = window.setTimeout(run, 50);
        }
    }

    private render(): void {
        const options = this.options;
        const formatter = this.formatter;
        const pointer = this.pointer;

        if (!options || !formatter || !pointer) {
            this.hide();
            return;
        }

        const row = this.findMergedRow(pointer.target);
        if (!row) {
            this.hide();
            return;
        }

        const match = POST_ID_PATTERN.exec(row.id);
        const postId = match ? match[1] : '';
        const createAt = postId ? this.provider.getCreateAt(postId) : undefined;
        if (!createAt) {
            this.hide();
            return;
        }

        const overlay = this.ensureOverlay();
        const text = formatter(new Date(createAt));
        if (overlay.textContent !== text) {
            overlay.textContent = text;
        }

        this.place(overlay, row, pointer.x, pointer.y, options.position);
        this.show();
    }

    /**
     * Returns the centre-channel row under the pointer when the floating timestamp
     * applies to it, `null` otherwise.
     *
     * Only `same--root` matches: it is set from the second message of a merged block of
     * consecutive root posts *and* from the second reply of a thread on. The first
     * message of either shape (`other--root`) keeps its inline header.
     */
    private findMergedRow(target: EventTarget | null): HTMLElement | null {
        if (!target || typeof (target as Element).closest !== 'function') {
            return null;
        }

        const row = (target as Element).closest('[id^="post_"]') as HTMLElement | null;
        if (!row || !POST_ID_PATTERN.test(row.id)) {
            return null;
        }

        if (!row.classList.contains('same--root')) {
            return null;
        }

        if (!row.closest(POST_LIST_CONTAINERS)) {
            return null;
        }

        return row;
    }

    private ensureOverlay(): HTMLDivElement {
        const existing = this.overlay;
        if (existing) {
            return existing;
        }

        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.setAttribute('aria-hidden', 'true');

        overlay.style.position = 'fixed';
        overlay.style.zIndex = '9999';
        overlay.style.pointerEvents = 'none';
        overlay.style.display = 'none';
        overlay.style.opacity = '0';
        overlay.style.padding = '4px 8px';
        overlay.style.borderRadius = '4px';
        overlay.style.fontSize = '12px';
        overlay.style.lineHeight = '16px';
        overlay.style.whiteSpace = 'nowrap';
        overlay.style.transition = 'opacity 90ms linear';

        // Follow the webapp theme; the fallbacks cover servers with a custom palette.
        overlay.style.background = 'var(--center-channel-bg, #ffffff)';
        overlay.style.color = 'var(--center-channel-color, #3f4350)';
        overlay.style.border = '1px solid rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.16)';
        overlay.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.16)';

        document.body.appendChild(overlay);
        this.overlay = overlay;

        return overlay;
    }

    private place(
        overlay: HTMLDivElement,
        row: HTMLElement,
        x: number,
        y: number,
        position: GroupedTimePosition,
    ): void {
        const width = overlay.offsetWidth || 0;
        const height = overlay.offsetHeight || 0;

        let left = x + CURSOR_OFFSET_X;
        let top = y + CURSOR_OFFSET_Y;

        if (position !== 'cursor') {
            const rect = row.getBoundingClientRect();

            if (position === 'left') {
                left = rect.left - width - 8;
                top = rect.top + 2;
            } else {
                left = rect.right - width;
                top = rect.top - height - 6;
                if (top < 0) {
                    top = rect.top + 2;
                }
            }
        }

        const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
        const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);

        overlay.style.left = `${Math.min(Math.max(left, VIEWPORT_MARGIN), maxLeft)}px`;
        overlay.style.top = `${Math.min(Math.max(top, VIEWPORT_MARGIN), maxTop)}px`;
    }

    private show(): void {
        if (!this.overlay) {
            return;
        }

        this.overlay.style.display = 'block';
        this.overlay.style.opacity = '1';
    }

    private hide(): void {
        if (!this.overlay) {
            return;
        }

        this.overlay.style.display = 'none';
        this.overlay.style.opacity = '0';
    }

    private applyStyle(hideInline: boolean): void {
        if (!this.style) {
            const style = document.createElement('style');
            style.id = STYLE_ID;

            // Lives in <head> so that writing to it does not re-trigger observers
            // watching document.body.
            document.head.appendChild(style);
            this.style = style;
        }

        const css = hideInline ? HIDE_INLINE_CSS : '';
        if (this.style.textContent !== css) {
            this.style.textContent = css;
        }
    }
}
