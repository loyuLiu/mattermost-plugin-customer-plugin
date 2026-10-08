// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

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

export type CrashRecord = {
    /** When it happened, ISO. */
    at: string;

    /** `error.message`, or a description of the rejection. */
    message: string;

    /** Stack, truncated for storage. */
    stack: string;

    /** Where the error came from: `error`, `rejection`, or a React boundary. */
    source: string;
};

let installed = false;

let kept: CrashRecord[] = [];

/** Read back what has been recorded so far (tests, and the console). */
export function getCrashRecords(): CrashRecord[] {
    return kept.slice();
}

/** Clears the in-memory records. The `localStorage` mirror is left alone on purpose. */
export function resetCrashRecords(): void {
    kept = [];
}

/**
 * A denial that reaches nobody and breaks nothing.
 *
 * `media.play()` returns a promise, and mobile browsers refuse autoplay by
 * policy — the new-message chime of the host app is simply not played, an
 * unhandled rejection is all that is left, and it names the platform, not a
 * fault. Painting the red banner for it would train the reader that the banner
 * lies, which is the one thing this banner must never do.
 */
function isBenignRejection(reason: unknown): boolean {
    const error = reason as Error | null;
    if (!error || typeof error.message !== 'string') {
        return false;
    }

    const notAllowed = error.message.indexOf('not allowed by the user agent') >= 0 ||
        error.name === 'NotAllowedError';

    return notAllowed && /\bplay\b|play@|play \(/i.test(error.stack || '');
}

function push(record: CrashRecord, showBanner = true): void {
    if (kept.length >= MAX_KEPT) {
        return;
    }

    kept.push(record);
    mirror();

    if (showBanner) {
        drawBanner();
    }
}

function mirror(): void {
    try {
        if (typeof localStorage === 'undefined') {
            return;
        }

        localStorage.setItem(STORE_KEY, JSON.stringify(kept));
    } catch {
        // Private mode or a full quota: the banner is still there.
    }
}

/** Turns anything into a record; rejections arrive as values, not as errors. */
function describe(thrown: unknown, source: string): CrashRecord {
    const error = thrown as Error | null;
    const message = error && typeof error.message === 'string' && error.message ?
        error.message :
        String(thrown);

    return {
        at: new Date().toISOString(),
        message: message.slice(0, 400),
        stack: (error && typeof error.stack === 'string' ? error.stack : '').slice(0, 2000),
        source,
    };
}

export type CrashRecordOptions = {
    /**
     * Records without drawing the banner. For interventions that *saved* the page
     * (the DOM guard): evidence belongs in the store, but a red banner on a page
     * that is actually fine would read as an alarm.
     */
    silent?: boolean;
};

/**
 * Records one error that this plugin caused or took part in.
 *
 * Called from the global handlers below, from the React boundary, and from plugin
 * initialisation, so that a failure has one place to land instead of taking the page
 * down silently.
 */
export function recordCrash(thrown: unknown, source = 'error', options?: CrashRecordOptions): void {
    push(describe(thrown, source), !options?.silent);
}

function bannerText(records: CrashRecord[]): string {
    return records.map((record, index) => (
        `#${index + 1} [${record.source}] ${record.at}\n${record.message}\n${record.stack}`
    )).join('\n\n');
}

function dismiss(): void {
    const existing = document.getElementById(BANNER_ID);
    if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
    }
}

function drawBanner(): void {
    if (typeof document === 'undefined' || !document.body || kept.length === 0) {
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
    title.textContent = `customers-plugin 报错 ${kept.length} 条（页面若白屏，这段就是原因；可截图反馈）`;
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
export function installCrashReporter(): void {
    if (installed || typeof window === 'undefined') {
        return;
    }

    installed = true;

    window.addEventListener('error', (event: ErrorEvent) => {
        recordCrash(event.error || event.message, 'error');
    });

    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
        if (isBenignRejection(event.reason)) {
            recordCrash(event.reason, 'rejection', {silent: true});
            return;
        }

        recordCrash(event.reason, 'rejection');
    });
}

/** Test hook: puts the global handlers back the way they were. */
export function uninstallCrashReporter(): void {
    installed = false;
    dismiss();
}
