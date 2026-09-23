// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

const STYLE_ID = 'customers-plugin-bulk-select-style';
const BOX_CLASS = 'customers-plugin-bulk-select-box';

/**
 * Selection mode only covers the centre channel: that is where a conversation is read
 * and where "tick the messages you mean" makes sense. The right-hand side and the
 * search results deliberately stay untouched.
 *
 * Confirmed against webapp/channels/src/components/post/post_component.tsx (10.12):
 * centre rows carry the id `post_<id>`.
 */
const POST_ROW_SELECTOR = '[id^="post_"]';
const POST_ID_PATTERN = /^post_(.+)$/;
const POST_LIST_CONTAINERS = '#postListContent,#virtualizedPostListContent';

/** Debounce for MutationObserver bursts. */
const SYNC_DEBOUNCE_MS = 150;

/** Full rescan interval, as a safety net for virtualised rows. */
const RESCAN_MS = 3000;

/** Style of the tick box overlaid on a post row, and of the selected row itself. */
const SELECT_CSS =
    `.${BOX_CLASS}{` +
    'position:absolute;top:6px;left:6px;z-index:3;width:16px;height:16px;margin:0;' +
    'cursor:pointer;accent-color:var(--button-bg,#1c58d9);' +
    'box-shadow:0 0 0 2px var(--center-channel-bg,#ffffff);' +
    '}';

export type BulkSelectState = {
    /** Whether the selection mode is on. */
    active: boolean;

    /** Ids of the ticked posts. */
    selected: string[];
};

/**
 * Tiny store shared between the channel header button and the toolbar component.
 *
 * The registry hands the header button a plain callback with no arguments, so the two
 * ends cannot be wired through props; both talk to this module instead.
 */
let state: BulkSelectState = {active: false, selected: []};
const listeners = new Set<(next: BulkSelectState) => void>();

function emit(next: BulkSelectState): void {
    state = next;
    listeners.forEach((listener) => listener(state));
}

export function getBulkSelectState(): BulkSelectState {
    return state;
}

export function subscribeBulkSelect(listener: (next: BulkSelectState) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function setBulkSelectActive(active: boolean): void {
    emit({active, selected: active ? state.selected : []});
}

export function setBulkSelection(selected: string[]): void {
    emit({...state, selected});
}

/**
 * Overlays a tick box on every post row of the centre channel while the selection mode
 * is on.
 *
 * As with the other engines in this plugin, the work is done on the row element rather
 * than inside its header, which React owns and rebuilds on hover. Every pass is
 * idempotent: a row either already carries its box or gets one.
 */
export class BulkSelectEngine {
    private onChange: (selected: string[]) => void;

    private style: HTMLStyleElement | null = null;
    private observer: MutationObserver | null = null;
    private interval: number | null = null;
    private debounce: number | null = null;
    private started = false;

    private selected = new Set<string>();

    constructor(onChange: (selected: string[]) => void) {
        this.onChange = onChange;
    }

    public start(): void {
        if (this.started) {
            return;
        }

        this.started = true;
        this.ensureStyle();

        // One delegated listener instead of one per box: rows come and go constantly.
        document.addEventListener('change', this.handleChange, true);

        this.observer = new MutationObserver(() => this.schedule());
        this.observer.observe(document.body, {childList: true, subtree: true});

        this.interval = window.setInterval(() => this.sync(), RESCAN_MS);
        this.sync();
    }

    public stop(): void {
        if (!this.started) {
            return;
        }

        this.started = false;

        document.removeEventListener('change', this.handleChange, true);

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

        this.clearBoxes();

        this.style?.remove();
        this.style = null;

        this.selected.clear();
    }

    /** Ticks every post currently rendered, which is what "select all" can offer. */
    public selectAll(): void {
        this.eachRow((row, postId) => {
            const box = row.querySelector<HTMLInputElement>(`.${BOX_CLASS}`);
            if (box) {
                box.checked = true;
            }

            this.selected.add(postId);
            this.highlight(row, true);
        });

        this.publish();
    }

    public clearSelection(): void {
        this.selected.clear();

        this.eachRow((row) => {
            const box = row.querySelector<HTMLInputElement>(`.${BOX_CLASS}`);
            if (box) {
                box.checked = false;
            }

            this.highlight(row, false);
        });

        this.publish();
    }

    /** Overlays the tick boxes; safe to call at any time. Returns the row count. */
    public sync(): number {
        if (!this.started) {
            return 0;
        }

        let rows = 0;

        this.eachRow((row, postId) => {
            rows++;

            let box = row.querySelector<HTMLInputElement>(`.${BOX_CLASS}`);
            if (!box) {
                box = document.createElement('input');
                box.type = 'checkbox';
                box.className = BOX_CLASS;
                box.dataset.postId = postId;
                box.setAttribute('aria-label', '选择此消息');

                // The box is absolutely positioned, so the row has to become a
                // containing block. Inline style survives React re-renders.
                if (row.style.position !== 'relative') {
                    row.style.position = 'relative';
                }

                row.appendChild(box);
            }

            const ticked = this.selected.has(postId);
            if (box.checked !== ticked) {
                box.checked = ticked;
            }

            this.highlight(row, ticked);
        });

        return rows;
    }

    private handleChange = (event: Event): void => {
        const target = event.target as HTMLInputElement | null;
        if (!target || !target.classList || !target.classList.contains(BOX_CLASS)) {
            return;
        }

        const postId = target.dataset.postId;
        if (!postId) {
            return;
        }

        if (target.checked) {
            this.selected.add(postId);
        } else {
            this.selected.delete(postId);
        }

        const row = target.parentElement;
        if (row) {
            this.highlight(row, target.checked);
        }

        this.publish();
    };

    private publish(): void {
        this.onChange(Array.from(this.selected));
    }

    private highlight(row: HTMLElement, on: boolean): void {
        if (on) {
            row.style.outline = '2px solid var(--button-bg,#1c58d9)';
            row.style.outlineOffset = '-2px';
        } else if (row.style.outline) {
            row.style.outline = '';
            row.style.outlineOffset = '';
        }
    }

    private eachRow(visit: (row: HTMLElement, postId: string) => void): void {
        document.querySelectorAll<HTMLElement>(POST_LIST_CONTAINERS).forEach((container) => {
            container.querySelectorAll<HTMLElement>(POST_ROW_SELECTOR).forEach((row) => {
                const match = POST_ID_PATTERN.exec(row.id);
                if (match) {
                    visit(row, match[1]);
                }
            });
        });
    }

    private clearBoxes(): void {
        document.querySelectorAll(`.${BOX_CLASS}`).forEach((box) => {
            const row = box.parentElement;
            box.remove();

            // `row` is the post row; the check keeps the helper usable outside a browser.
            if (row && row.style) {
                row.style.outline = '';
                row.style.outlineOffset = '';
            }
        });
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
        style.textContent = SELECT_CSS;
    }
}
