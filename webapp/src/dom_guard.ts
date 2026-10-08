// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {recordCrash} from './crash_report';

/**
 * Keeps a DOM-ownership conflict from taking the whole page down.
 *
 * The phone white-screen was React dying in its own commit-deletion phase with
 * Safari's `NotFoundError: The object can not be found here` from `removeChild` —
 * i.e. a node React was removing no longer lived under the parent React believed
 * it did. That is an ownership conflict between React and whatever else touched
 * the tree, and it happens during React's commit, where error boundaries cannot
 * reach: the whole app unmounts, and the page comes up blank.
 *
 * This guard wraps the two primitives that can throw that error — `removeChild`
 * and `insertBefore` — and only diverges from the native behaviour in the case
 * that would have thrown:
 *
 * - `removeChild` of a node that moved: remove it from where it actually lives,
 *   which is what the caller wanted anyway;
 * - `removeChild` of a node already detached: the caller's goal is met, return;
 * - `insertBefore` past a reference node that moved: insert next to the place the
 *   reference actually is;
 * - anything else re-throws untouched.
 *
 * Every intervention is recorded (silently — no red banner for a save) so a
 * phone session still leaves evidence in `localStorage` for later.
 */

/** One intervention at most per this many ms reaches the record store. */
const REPORT_THROTTLE_MS = 2000;

let installed = false;
let originalRemoveChild: ((child: Node) => Node) | null = null;
let originalInsertBefore: ((node: Node, ref: Node | null) => Node) | null = null;
let lastReportedAt = 0;

function note(kind: string): void {
    const now = Date.now();
    if (now - lastReportedAt < REPORT_THROTTLE_MS) {
        return;
    }

    lastReportedAt = now;
    recordCrash(new Error(`DOM 兜底介入：${kind}`), 'dom-guard', {silent: true});
}

/**
 * Installs the tolerant wrappers. Idempotent; the native functions stay in
 * `original*` so the tests can put the world back.
 */
export function installDomGuard(): void {
    if (installed || typeof Node === 'undefined') {
        return;
    }

    const proto = Node.prototype as {
        removeChild: (child: Node) => Node;
        insertBefore: (node: Node, ref: Node | null) => Node;
    };

    installed = true;
    originalRemoveChild = proto.removeChild;
    originalInsertBefore = proto.insertBefore;

    proto.removeChild = function removeChild(child: Node): Node {
        try {
            return originalRemoveChild!.call(this, child);
        } catch (error) {
            if (child && child.parentNode) {
                // Moved, not gone: remove it from where it actually is.
                note('removeChild 的节点已挪位，改为从实际父节点删除');
                return originalRemoveChild!.call(child.parentNode, child);
            }

            if (child) {
                // Already gone: the caller wanted it out of the tree, and it is.
                note('removeChild 的节点已不在树里，按已删除处理');
                return child;
            }

            throw error;
        }
    };

    proto.insertBefore = function insertBefore(node: Node, ref: Node | null): Node {
        try {
            return originalInsertBefore!.call(this, node, ref);
        } catch (error) {
            if (ref && ref.parentNode && ref.parentNode !== this) {
                // The reference moved: keep the node next to the place the
                // reference actually occupies.
                note('insertBefore 的参照节点已挪位，改为插到参照点旁边');
                return originalInsertBefore!.call(ref.parentNode, node, ref);
            }

            note('insertBefore 无法定位参照点，改为追加');
            return this.appendChild(node);
        }
    };
}

/** Test hook: puts the native primitives back. */
export function uninstallDomGuard(): void {
    if (!installed) {
        return;
    }

    const proto = Node.prototype as {
        removeChild: (child: Node) => Node;
        insertBefore: (node: Node, ref: Node | null) => Node;
    };

    if (originalRemoveChild) {
        proto.removeChild = originalRemoveChild;
    }

    if (originalInsertBefore) {
        proto.insertBefore = originalInsertBefore;
    }

    installed = false;
    originalRemoveChild = null;
    originalInsertBefore = null;
    lastReportedAt = 0;
}

/** Test hook: forgets the throttle so the next intervention reports again. */
export function resetDomGuardRecords(): void {
    lastReportedAt = 0;
}
