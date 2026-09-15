// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {Formatter} from './format';
import {createFormatter} from './format';

export type EngineOptions = {
    /** CSS selector matching the elements to rewrite. */
    selector: string;

    /** Token based format string, e.g. "YYYY-MM-DD HH:mm". */
    format: string;

    /** BCP-47 locale used for localized month / weekday names. */
    locale: string;

    /** Optional IANA timezone; falls back to the browser timezone. */
    timeZone?: string;
};

/**
 * Keeps every <time datetime="..."> element matching `selector` rendered using the
 * configured format.
 *
 * Because the webapp re-renders timestamps on its own schedule (relative time updates,
 * new posts, reactions...) a MutationObserver is used to detect whenever React writes a
 * new value, and the custom format is re-applied. Writing the formatted value triggers
 * another mutation, so every pass is idempotent: nothing is written when the text
 * already matches the expected output, which terminates the feedback loop. A periodic
 * resync covers virtualized lists that reuse existing nodes.
 */
export default class TimeFormatEngine {
    private options: EngineOptions | null = null;
    private formatter: Formatter | null = null;
    private observer: MutationObserver | null = null;
    private pending: number | null = null;
    private resyncTimer: number | null = null;
    private resyncInterval: number;

    constructor(resyncInterval: number) {
        this.resyncInterval = resyncInterval;
    }

    /** Activates or updates the engine. Pass `null` to disable it. */
    public update(options: EngineOptions | null): void {
        if (!options) {
            this.stop();
            return;
        }

        const needsNewFormatter = !this.options ||
            this.options.format !== options.format ||
            this.options.locale !== options.locale ||
            this.options.timeZone !== options.timeZone;

        this.options = options;

        if (needsNewFormatter || !this.formatter) {
            this.formatter = createFormatter(options.format, options.locale, options.timeZone);
        }

        this.startObserver();
        this.startResyncTimer();
        this.apply();
    }

    /** Stops observing and leaves whatever is currently rendered in place. */
    public stop(): void {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        if (this.pending !== null) {
            if (typeof cancelAnimationFrame === 'function') {
                cancelAnimationFrame(this.pending);
            } else {
                clearTimeout(this.pending);
            }
            this.pending = null;
        }

        if (this.resyncTimer !== null) {
            clearTimeout(this.resyncTimer);
            this.resyncTimer = null;
        }

        this.options = null;
        this.formatter = null;
    }

    private startObserver(): void {
        if (this.observer || typeof MutationObserver === 'undefined') {
            return;
        }

        this.observer = new MutationObserver(() => this.schedule());
        this.observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['datetime'],
        });
    }

    private startResyncTimer(): void {
        if (this.resyncTimer !== null || this.resyncInterval <= 0) {
            return;
        }

        this.resyncTimer = window.setTimeout(() => {
            this.resyncTimer = null;
            if (this.options) {
                this.apply();
                this.startResyncTimer();
            }
        }, this.resyncInterval);
    }

    private schedule(): void {
        if (this.pending !== null) {
            return;
        }

        const run = () => {
            this.pending = null;
            this.apply();
        };

        if (typeof requestAnimationFrame === 'function') {
            this.pending = requestAnimationFrame(run);
        } else {
            this.pending = window.setTimeout(run, 100);
        }
    }

    /** Idempotent DOM pass. Returns the number of elements that were updated. */
    public apply(): number {
        const options = this.options;
        const formatter = this.formatter;
        if (!options || !formatter) {
            return 0;
        }

        const nodes = document.querySelectorAll(options.selector);
        let changed = 0;

        nodes.forEach((node) => {
            const el = node as HTMLElement;
            const raw = el.getAttribute('datetime');
            if (!raw) {
                return;
            }

            const parsed = Date.parse(raw);
            if (Number.isNaN(parsed)) {
                return;
            }

            const expected = formatter(new Date(parsed));
            if (el.textContent !== expected) {
                el.textContent = expected;
                changed++;
            }
        });

        return changed;
    }
}
