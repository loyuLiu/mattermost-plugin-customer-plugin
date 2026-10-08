"use strict";
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscribeNavDocument = exports.setNavDocument = exports.getNavDocument = void 0;
/**
 * The bridge between the two halves of the navigation.
 *
 * The entries are fetched once, when the plugin starts, because whether the button is
 * offered at all depends on there being something to show. The body is a React
 * component inside Mattermost's right-hand sidebar and cannot be given props, so it
 * reads the entries here instead — the same arrangement the bulk-delete channel header
 * button uses.
 *
 * The toggle action does not need a home here: the button is registered right next to
 * the sidebar registration, so it can close over the action directly.
 */
let entries = null;
const entryListeners = new Set();
function getNavDocument() {
    return entries;
}
exports.getNavDocument = getNavDocument;
/** Replaces the entries and tells every mounted sidebar to re-render. */
function setNavDocument(next) {
    entries = next;
    entryListeners.forEach((listener) => listener(entries));
}
exports.setNavDocument = setNavDocument;
function subscribeNavDocument(listener) {
    entryListeners.add(listener);
    return () => entryListeners.delete(listener);
}
exports.subscribeNavDocument = subscribeNavDocument;
