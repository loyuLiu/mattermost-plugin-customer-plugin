"use strict";
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductNavEngine = exports.normalizeNavDocument = exports.countUsableNavLinks = exports.collectNavProblems = exports.isBlankNavLink = exports.safeNavUrl = exports.panelWidthPx = exports.normalizeLinksPerRow = void 0;
const constants_1 = require("./constants");
const STYLE_ID = 'customers-plugin-product-nav-style';
const BUTTON_ID = 'customers-plugin-product-nav-button';
const PANEL_ID = 'customers-plugin-product-nav-panel';
const BUTTON_CLASS = 'customers-plugin-nav-button';
const CATEGORY_CLASS = 'customers-plugin-nav-category';
const CATEGORY_TITLE_CLASS = 'customers-plugin-nav-category-title';
const LINKS_CLASS = 'customers-plugin-nav-links';
const LINK_CLASS = 'customers-plugin-nav-link';
const LOGO_CLASS = 'customers-plugin-nav-logo';
const NAME_CLASS = 'customers-plugin-nav-name';
const EMPTY_CLASS = 'customers-plugin-nav-empty';
/**
 * Where the button is inserted, in the global header.
 *
 * `right_controls/right_controls.tsx` of the 10.12 webapp renders
 * `id={'RightControlsContainer'}` around the @mentions, saved-posts and settings
 * buttons. The navigation is prepended so it sits left of them, still in the top-right
 * corner. The id is inlined rather than imported so the engine needs no webapp imports
 * and stays testable on its own.
 */
const CONTAINER_ID = 'RightControlsContainer';
/** Debounce for MutationObserver bursts. */
const SYNC_DEBOUNCE_MS = 150;
/**
 * Full rescan interval. The header is rebuilt when the route changes, and the
 * MutationObserver only fires on mutations — this catches the cases where it is
 * replaced wholesale or where the container appears later than the plugin.
 */
const RESCAN_MS = 3000;
/** Gap between the button and the panel, in pixels. */
const PANEL_GAP_PX = 8;
/** Minimum distance from the right edge of the viewport, in pixels. */
const PANEL_MARGIN_PX = 8;
/** Gap between two link tiles, in pixels. */
const LINK_GAP_PX = 6;
/** Horizontal padding of the panel, in pixels. */
const PANEL_PADDING_X_PX = 14;
/** Narrowest tile that still holds a 32px logo and a readable caption. */
const LINK_MIN_WIDTH_PX = 56;
/**
 * Clamps an administrator-supplied row size into something renderable.
 *
 * The value arrives from the plugin settings as a free-form number, and a 0 or a
 * 500 would produce `repeat(0, ...)` — a panel with no columns at all — or one
 * wider than the viewport. Out-of-range input falls back to the default rather
 * than to the nearest bound, so a typo is obvious instead of silently odd.
 */
function normalizeLinksPerRow(value) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) {
        return constants_1.DEFAULT_PRODUCT_NAV_LINKS_PER_ROW;
    }
    if (n < constants_1.MIN_PRODUCT_NAV_LINKS_PER_ROW || n > constants_1.MAX_PRODUCT_NAV_LINKS_PER_ROW) {
        return constants_1.DEFAULT_PRODUCT_NAV_LINKS_PER_ROW;
    }
    return n;
}
exports.normalizeLinksPerRow = normalizeLinksPerRow;
/**
 * Width the panel needs so that `linksPerRow` tiles always fit on one row.
 *
 * Derived from the same arithmetic the grid uses, so changing the row size moves
 * the width with it instead of leaving a stray tile to wrap.
 */
function panelWidthPx(linksPerRow) {
    const n = normalizeLinksPerRow(linksPerRow);
    return 2 * PANEL_PADDING_X_PX + n * LINK_MIN_WIDTH_PX + (n - 1) * LINK_GAP_PX;
}
exports.panelWidthPx = panelWidthPx;
const BUTTON_CSS = `#${BUTTON_ID}{` +
    'display:inline-flex;align-items:center;justify-content:center;' +
    'width:32px;height:32px;margin:0 2px;padding:0;border:none;border-radius:4px;' +
    'background:transparent;color:inherit;cursor:pointer;' +
    '}' +
    `#${BUTTON_ID}:hover{background:rgba(var(--center-channel-color-rgb,63,67,80),0.08);}` +
    `#${BUTTON_ID} svg{width:20px;height:20px;display:block;}` +
    `#${BUTTON_ID} img{width:20px;height:20px;display:block;object-fit:contain;}`;
const PANEL_CSS = (linksPerRow) => `#${PANEL_ID}{` +
    `position:fixed;z-index:1200;width:${panelWidthPx(linksPerRow)}px;max-height:70vh;overflow-y:auto;` +
    'padding:12px 14px;border-radius:8px;box-sizing:border-box;' +
    'background:var(--center-channel-bg,#ffffff);' +
    'color:var(--center-channel-color,#3f4350);' +
    'box-shadow:0 8px 24px rgba(0,0,0,0.24);font-size:14px;' +
    '}' +
    `.${CATEGORY_CLASS}{margin-bottom:12px;}` +
    `.${CATEGORY_CLASS}:last-child{margin-bottom:0;}` +
    `.${CATEGORY_TITLE_CLASS}{` +
    'margin:0 0 6px;font-size:12px;font-weight:600;line-height:16px;' +
    'color:rgba(var(--center-channel-color-rgb,63,67,80),0.75);' +
    '}' +
    // A grid rather than `flex-wrap`: wrapping depends on the intrinsic width of
    // each tile, so the row count drifted with the length of the captions. With
    // `repeat(N, minmax(0,1fr))` a category shows exactly N tiles per row and the
    // tiles share the width evenly, whatever the names are.
    `.${LINKS_CLASS}{` +
    `display:grid;grid-template-columns:repeat(${normalizeLinksPerRow(linksPerRow)},minmax(0,1fr));gap:${LINK_GAP_PX}px;` +
    '}' +
    `.${LINK_CLASS}{` +
    'display:flex;flex-direction:column;align-items:center;gap:4px;' +
    'width:100%;min-width:0;padding:8px 2px;border-radius:6px;text-decoration:none;' +
    'color:inherit;box-sizing:border-box;' +
    '}' +
    `.${LINK_CLASS}:hover{background:rgba(var(--center-channel-color-rgb,63,67,80),0.08);}` +
    `.${LOGO_CLASS}{` +
    'display:flex;align-items:center;justify-content:center;' +
    'width:32px;height:32px;border-radius:8px;overflow:hidden;flex:none;' +
    'background:rgba(var(--button-bg-rgb,28,88,217),0.12);' +
    'color:var(--button-bg,#1c58d9);font-size:14px;font-weight:600;' +
    '}' +
    `.${LOGO_CLASS} img{width:32px;height:32px;object-fit:contain;}` +
    // Two lines at most: a 5-across tile is too narrow for a single-line caption
    // to say anything, and the full name is in the tooltip either way. The
    // `max-height` is the fallback for engines that ignore `-webkit-line-clamp`
    // (they clip instead of ellipsising, which is still bounded).
    `.${NAME_CLASS}{` +
    'max-width:100%;font-size:12px;line-height:15px;text-align:center;' +
    'display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;' +
    'max-height:30px;overflow:hidden;overflow-wrap:anywhere;' +
    '}' +
    `.${EMPTY_CLASS}{margin:0;font-size:13px;color:rgba(var(--center-channel-color-rgb,63,67,80),0.75);}`;
/**
 * Built-in button icon: a 2x2 grid, the usual "apps / products" glyph. Inlined rather
 * than taken from the webapp's icon font, which a plugin cannot rely on.
 */
const DEFAULT_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
    ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<rect x="3" y="3" width="7" height="7" rx="1"/>' +
    '<rect x="14" y="3" width="7" height="7" rx="1"/>' +
    '<rect x="3" y="14" width="7" height="7" rx="1"/>' +
    '<rect x="14" y="14" width="7" height="7" rx="1"/>' +
    '</svg>';
/**
 * Keeps only targets it is safe to put into `href`/`src`.
 *
 * The server already sanitises what it stores; this is the second half of the same
 * decision, so a hand-edited payload or a future endpoint cannot inject a
 * `javascript:` link into every user's header.
 */
function safeNavUrl(raw) {
    if (!raw) {
        return '';
    }
    const value = raw.trim();
    if (!value) {
        return '';
    }
    // Whitespace and control characters are how "java\nscript:alert(1)" smuggles a
    // scheme past a naive prefix check.
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code <= 0x20 || code === 0x7f) {
            return '';
        }
    }
    if (/^https?:\/\//i.test(value)) {
        return value;
    }
    // Site-relative path. `//host` would leave the site, so it is rejected.
    if (value.charAt(0) === '/' && value.charAt(1) !== '/' && value.charAt(1) !== '\\') {
        return value;
    }
    return '';
}
exports.safeNavUrl = safeNavUrl;
/** A row the administrator has not typed anything into yet. */
function isBlankNavLink(link) {
    return !(link.name || '').trim() && !(link.url || '').trim() && !(link.iconUrl || '').trim();
}
exports.isBlankNavLink = isBlankNavLink;
/**
 * Checks a draft against what the server will keep, before it is sent.
 *
 * The server silently drops a link whose target or caption is unusable, which from the
 * panel looks like "I saved and it vanished". Catching it here turns that into a
 * message that names the row. Entirely empty rows are ignored on purpose: they are what
 * "+ 添加链接" produces, and leaving one behind is normal.
 */
function collectNavProblems(categories) {
    const problems = [];
    (categories || []).forEach((category, categoryIndex) => {
        const where = `第 ${categoryIndex + 1} 个分类`;
        (category.links || []).forEach((link, linkIndex) => {
            if (isBlankNavLink(link)) {
                return;
            }
            const at = `${where} 第 ${linkIndex + 1} 条链接`;
            if (!(link.name || '').trim()) {
                problems.push(`${at}：缺少名称`);
            }
            const url = (link.url || '').trim();
            if (!url) {
                problems.push(`${at}：缺少地址`);
                return;
            }
            if (!safeNavUrl(url)) {
                problems.push(`${at}：地址「${url}」不可用，必须填 https:// 开头或 / 开头的站点相对路径`);
            }
        });
    });
    return problems;
}
exports.collectNavProblems = collectNavProblems;
/** Number of links that would actually be kept by the server. */
function countUsableNavLinks(categories) {
    return (categories || []).reduce((total, category) => (total + (category.links || []).filter((link) => (!isBlankNavLink(link) && safeNavUrl(link.url) && (link.name || '').trim())).length), 0);
}
exports.countUsableNavLinks = countUsableNavLinks;
/**
 * Normalises whatever the server sent into something safe to iterate.
 *
 * The server now always writes arrays, but a document stored by an older build can
 * still hold `null` in either field, and the panel is not the only reader.
 */
function normalizeNavDocument(document) {
    const raw = document && Array.isArray(document.categories) ? document.categories : [];
    return raw.filter((category) => Boolean(category)).map((category) => ({
        id: category.id || '',
        name: category.name || '',
        links: (Array.isArray(category.links) ? category.links : []).map((link) => ({
            id: link.id || '',
            name: link.name || '',
            url: link.url || '',
            iconUrl: link.iconUrl || '',
        })),
    }));
}
exports.normalizeNavDocument = normalizeNavDocument;
/** True when there is at least one link to show. */
function hasEntries(data) {
    if (!data || !Array.isArray(data.categories)) {
        return false;
    }
    return data.categories.some((category) => category && Array.isArray(category.links) && category.links.length > 0);
}
/**
 * Adds the product navigation button to the global header and opens a panel of links
 * grouped by category when it is clicked.
 *
 * Everything is plain DOM for two reasons: the header is owned by React, so a component
 * cannot be mounted into it, and the engine stays testable without a React tree.
 *
 * The button hides itself while no entry is configured, so enabling the feature in the
 * system console costs nothing until something is actually added.
 *
 * Every pass is idempotent — the button and the panel are only rebuilt when their
 * content actually changes — so the MutationObserver cannot feed back on itself.
 */
class ProductNavEngine {
    constructor(options = {}) {
        this.data = null;
        this.iconUrl = '';
        this.style = null;
        this.button = null;
        this.panel = null;
        this.observer = null;
        this.interval = null;
        this.debounce = null;
        this.panelOpen = false;
        this.started = false;
        this.onDocumentClick = (event) => {
            var _a, _b;
            if (!this.panelOpen) {
                return;
            }
            const target = event.target;
            if (target && (((_a = this.button) === null || _a === void 0 ? void 0 : _a.contains(target)) || ((_b = this.panel) === null || _b === void 0 ? void 0 : _b.contains(target)))) {
                return;
            }
            this.close();
        };
        this.onKeyDown = (event) => {
            if (event.key === 'Escape' && this.panelOpen) {
                this.close();
            }
        };
        this.iconUrl = options.iconUrl || '';
        this.title = options.title || constants_1.PRODUCT_NAV_TITLE;
        this.linksPerRow = normalizeLinksPerRow(options.linksPerRow);
    }
    start() {
        this.started = true;
        this.ensureStyle();
        document.addEventListener('click', this.onDocumentClick, true);
        document.addEventListener('keydown', this.onKeyDown, true);
        this.observer = new MutationObserver(() => this.schedule());
        this.observer.observe(document.body, { childList: true, subtree: true });
        this.interval = window.setInterval(() => this.sync(), RESCAN_MS);
        this.sync();
    }
    stop() {
        var _a, _b;
        this.started = false;
        document.removeEventListener('click', this.onDocumentClick, true);
        document.removeEventListener('keydown', this.onKeyDown, true);
        (_a = this.observer) === null || _a === void 0 ? void 0 : _a.disconnect();
        this.observer = null;
        if (this.interval !== null) {
            window.clearInterval(this.interval);
            this.interval = null;
        }
        if (this.debounce !== null) {
            window.clearTimeout(this.debounce);
            this.debounce = null;
        }
        this.removePanel();
        this.removeButton();
        this.panelOpen = false;
        (_b = this.style) === null || _b === void 0 ? void 0 : _b.remove();
        this.style = null;
    }
    /** Replaces the entries. Rebuilds the panel when it is currently open. */
    setData(data) {
        this.data = data;
        if (!this.started) {
            return;
        }
        if (this.panelOpen) {
            this.removePanel();
            this.renderPanel();
        }
        this.sync();
    }
    /** Replaces the button icon. Empty means "use the built-in icon". */
    setIconUrl(iconUrl) {
        const next = iconUrl || '';
        if (next === this.iconUrl) {
            return;
        }
        this.iconUrl = next;
        if (this.started && this.button) {
            this.removeButton();
            this.sync();
        }
    }
    /**
     * Changes how many links a category shows per row.
     *
     * The value is part of the stylesheet (both the grid columns and the panel
     * width), so the rule is rewritten in place and an open panel is re-rendered
     * at its new width. No restart, no flicker of the button.
     */
    setLinksPerRow(linksPerRow) {
        const next = normalizeLinksPerRow(linksPerRow);
        if (next === this.linksPerRow) {
            return;
        }
        this.linksPerRow = next;
        if (!this.started || !this.style) {
            return;
        }
        this.style.textContent = BUTTON_CSS + PANEL_CSS(this.linksPerRow);
        if (this.panelOpen) {
            this.removePanel();
            this.renderPanel();
        }
    }
    /** Links shown per row, after clamping. */
    getLinksPerRow() {
        return this.linksPerRow;
    }
    /** Whether the panel is currently shown. */
    isOpen() {
        return this.panelOpen;
    }
    open() {
        var _a;
        if (!this.started || this.panelOpen) {
            return;
        }
        this.renderPanel();
        this.panelOpen = this.panel !== null;
        (_a = this.button) === null || _a === void 0 ? void 0 : _a.setAttribute('aria-expanded', String(this.panelOpen));
    }
    close() {
        var _a;
        if (!this.panelOpen) {
            return;
        }
        this.removePanel();
        this.panelOpen = false;
        (_a = this.button) === null || _a === void 0 ? void 0 : _a.setAttribute('aria-expanded', 'false');
    }
    toggle() {
        if (this.panelOpen) {
            this.close();
            return;
        }
        this.open();
    }
    /**
     * Makes sure the button is (or is not) in the header.
     *
     * Returns whether the button is present. Safe to call at any time; does nothing
     * once the engine has been stopped, so a late call cannot resurrect a button
     * without its stylesheet or listeners.
     */
    sync() {
        if (!this.started) {
            return false;
        }
        if (!hasEntries(this.data)) {
            // No entries: hide everything rather than offering an empty panel.
            if (this.panelOpen) {
                this.close();
            }
            this.removeButton();
            return false;
        }
        const container = document.getElementById(CONTAINER_ID);
        if (!container) {
            // The header has not been rendered yet; the observer and the rescan timer
            // will call again.
            return false;
        }
        this.ensureButton(container);
        return this.button !== null;
    }
    ensureButton(container) {
        const existing = document.getElementById(BUTTON_ID);
        if (existing && existing.parentElement === container) {
            this.button = existing;
            return;
        }
        // A stale one (header rebuilt elsewhere) is dropped first, so there is never
        // more than a single button on the page.
        existing === null || existing === void 0 ? void 0 : existing.remove();
        const button = document.createElement('button');
        button.id = BUTTON_ID;
        button.className = BUTTON_CLASS;
        button.type = 'button';
        button.title = this.title;
        button.setAttribute('aria-label', this.title);
        button.setAttribute('aria-haspopup', 'true');
        button.setAttribute('aria-expanded', 'false');
        button.dataset.pluginNav = 'button';
        const icon = safeNavUrl(this.iconUrl);
        if (icon) {
            const image = document.createElement('img');
            image.src = icon;
            image.alt = '';
            button.appendChild(image);
        }
        else {
            button.innerHTML = DEFAULT_ICON_SVG;
        }
        button.addEventListener('click', () => this.toggle());
        container.insertBefore(button, container.firstChild);
        this.button = button;
    }
    removeButton() {
        var _a, _b;
        (_a = this.button) === null || _a === void 0 ? void 0 : _a.remove();
        this.button = null;
        (_b = document.getElementById(BUTTON_ID)) === null || _b === void 0 ? void 0 : _b.remove();
    }
    removePanel() {
        var _a, _b;
        (_a = this.panel) === null || _a === void 0 ? void 0 : _a.remove();
        this.panel = null;
        (_b = document.getElementById(PANEL_ID)) === null || _b === void 0 ? void 0 : _b.remove();
    }
    renderPanel() {
        var _a;
        if (!hasEntries(this.data)) {
            return;
        }
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.setAttribute('role', 'menu');
        panel.dataset.pluginNav = 'panel';
        const categories = (((_a = this.data) === null || _a === void 0 ? void 0 : _a.categories) || []).filter((category) => (category && Array.isArray(category.links) && category.links.length > 0));
        if (categories.length === 0) {
            const empty = document.createElement('p');
            empty.className = EMPTY_CLASS;
            empty.textContent = '暂无产品导航';
            panel.appendChild(empty);
        }
        categories.forEach((category) => {
            panel.appendChild(this.renderCategory(category));
        });
        document.body.appendChild(panel);
        this.panel = panel;
        this.positionPanel(panel);
    }
    renderCategory(category) {
        const block = document.createElement('div');
        block.className = CATEGORY_CLASS;
        const title = document.createElement('h4');
        title.className = CATEGORY_TITLE_CLASS;
        title.textContent = category.name || '';
        block.appendChild(title);
        const list = document.createElement('div');
        list.className = LINKS_CLASS;
        (category.links || []).forEach((link) => {
            const anchor = this.renderLink(link);
            if (anchor) {
                list.appendChild(anchor);
            }
        });
        block.appendChild(list);
        return block;
    }
    renderLink(link) {
        const url = safeNavUrl(link.url);
        if (!url) {
            return null;
        }
        const anchor = document.createElement('a');
        anchor.className = LINK_CLASS;
        anchor.href = url;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.setAttribute('role', 'menuitem');
        anchor.dataset.pluginNav = 'link';
        const logo = document.createElement('span');
        logo.className = LOGO_CLASS;
        const icon = safeNavUrl(link.iconUrl);
        if (icon) {
            const image = document.createElement('img');
            image.src = icon;
            image.alt = '';
            image.addEventListener('error', () => {
                image.remove();
                logo.textContent = this.fallbackGlyph(link.name);
            });
            logo.appendChild(image);
        }
        else {
            logo.textContent = this.fallbackGlyph(link.name);
        }
        const name = document.createElement('span');
        name.className = NAME_CLASS;
        name.textContent = link.name || '';
        name.title = link.name || '';
        anchor.appendChild(logo);
        anchor.appendChild(name);
        anchor.addEventListener('click', () => this.close());
        return anchor;
    }
    /** First character of the name, used when a link has no logo. */
    fallbackGlyph(name) {
        const trimmed = (name || '').trim();
        return trimmed ? Array.from(trimmed)[0].toUpperCase() : '?';
    }
    positionPanel(panel) {
        var _a;
        const rect = (_a = this.button) === null || _a === void 0 ? void 0 : _a.getBoundingClientRect();
        const top = rect && rect.height ? rect.bottom + PANEL_GAP_PX : 56;
        const right = rect && rect.width ? Math.max(PANEL_MARGIN_PX, window.innerWidth - rect.right) : PANEL_MARGIN_PX;
        panel.style.top = `${Math.round(top)}px`;
        panel.style.right = `${Math.round(right)}px`;
    }
    schedule() {
        if (this.debounce !== null) {
            return;
        }
        this.debounce = window.setTimeout(() => {
            this.debounce = null;
            this.sync();
        }, SYNC_DEBOUNCE_MS);
    }
    ensureStyle() {
        if (this.style) {
            return;
        }
        // Reused when one is already in the document, so that a second engine —
        // or a remount that races the old one — cannot leave two stylesheets with
        // the same id fighting over the last write.
        const existing = document.getElementById(STYLE_ID);
        if (existing) {
            this.style = existing;
            existing.textContent = BUTTON_CSS + PANEL_CSS(this.linksPerRow);
            return;
        }
        const style = document.createElement('style');
        style.id = STYLE_ID;
        // Lives in <head> so that writing to it does not re-trigger the observer.
        document.head.appendChild(style);
        this.style = style;
        style.textContent = BUTTON_CSS + PANEL_CSS(this.linksPerRow);
    }
}
exports.ProductNavEngine = ProductNavEngine;
