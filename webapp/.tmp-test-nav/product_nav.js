"use strict";
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
Object.defineProperty(exports, "__esModule", { value: true });
exports.installNavStyle = exports.blurHeaderButtonFocus = exports.exposeHeaderDiagnostic = exports.logHeaderStartupBaseline = exports.logHeaderButtonPaint = exports.noteHeaderRegistration = exports.shouldLogHeaderDiag = exports.installHeaderButtonQuietStyle = exports.syncHeaderButtonQuietStyle = exports.discoverHeaderButtonDomIds = exports.discoverHeaderButtons = exports.headerIconButtons = exports.HEADER_GLYPH_BULK = exports.HEADER_GLYPH_NAV = exports.HEADER_BUTTON_LABELS = exports.markSidebarOpen = exports.buildNavContent = exports.hasNavEntries = exports.normalizeNavDocument = exports.countUsableNavLinks = exports.collectNavProblems = exports.isBlankNavLink = exports.safeNavUrl = exports.navContentWidthPx = exports.normalizeLinksPerRow = void 0;
const constants_1 = require("./constants");
const STYLE_ID = 'customers-plugin-product-nav-style';
const CONTENT_CLASS = 'customers-plugin-nav-content';
const CATEGORY_CLASS = 'customers-plugin-nav-category';
const CATEGORY_TITLE_CLASS = 'customers-plugin-nav-category-title';
const LINKS_CLASS = 'customers-plugin-nav-links';
const LINK_CLASS = 'customers-plugin-nav-link';
const LOGO_CLASS = 'customers-plugin-nav-logo';
const NAME_CLASS = 'customers-plugin-nav-name';
const EMPTY_CLASS = 'customers-plugin-nav-empty';
/**
 * Mark put on <body> while the right-hand sidebar shows the navigation.
 *
 * Mattermost sizes the sidebar itself; this is what lets the stylesheet widen it
 * when the administrator asks for more columns than the default width can hold.
 * It is added and removed by the sidebar component, and the rules below only ever
 * match while it is present, so nothing else on the page moves.
 */
const BODY_OPEN_CLASS = 'customers-plugin-nav-rhs-open';
/** Gap between two link tiles, in pixels. */
const LINK_GAP_PX = 6;
/** Horizontal padding of the sidebar content, in pixels. */
const CONTENT_PADDING_X_PX = 14;
/** Narrowest tile that still holds a 32px logo and a readable caption. */
const LINK_MIN_WIDTH_PX = 56;
/**
 * Clamps an administrator-supplied row size into something renderable.
 *
 * The value arrives from the plugin settings as a free-form number, and a 0 or a
 * 500 would produce `repeat(0, ...)` — a column set with no columns at all — or one
 * wider than any screen. Out-of-range input falls back to the default rather
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
 * Width the navigation needs so that `linksPerRow` tiles always fit on one row.
 *
 * Derived from the same arithmetic the grid uses, so changing the row size moves
 * the width with it instead of leaving a stray tile to wrap.
 */
function navContentWidthPx(linksPerRow) {
    const n = normalizeLinksPerRow(linksPerRow);
    return 2 * CONTENT_PADDING_X_PX + n * LINK_MIN_WIDTH_PX + (n - 1) * LINK_GAP_PX;
}
exports.navContentWidthPx = navContentWidthPx;
/**
 * Keeps an administrator-supplied address only if it cannot leave the site.
 *
 * Two shapes survive: an absolute `http(s)` URL and a site-relative path. Everything
 * else — `javascript:`, `data:`, protocol-relative `//host` — comes back empty, and
 * callers treat that the same as "not configured".
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
function hasNavEntries(data) {
    if (!data || !Array.isArray(data.categories)) {
        return false;
    }
    return data.categories.some((category) => category && Array.isArray(category.links) && category.links.length > 0);
}
exports.hasNavEntries = hasNavEntries;
/** First character of the name, used when a link has no logo. */
function fallbackGlyph(name) {
    const trimmed = (name || '').trim();
    return trimmed ? Array.from(trimmed)[0].toUpperCase() : '?';
}
function buildLink(link) {
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
            logo.textContent = fallbackGlyph(link.name);
        });
        logo.appendChild(image);
    }
    else {
        logo.textContent = fallbackGlyph(link.name);
    }
    const name = document.createElement('span');
    name.className = NAME_CLASS;
    name.textContent = link.name || '';
    name.title = link.name || '';
    anchor.appendChild(logo);
    anchor.appendChild(name);
    return anchor;
}
/**
 * The navigation body as plain DOM.
 *
 * The sidebar mounts this rather than rendering a tree of components: Mattermost
 * already owns the column, and the markup has to match the stylesheet below, which
 * is one shared sheet rather than a component's own CSS module.
 */
function buildNavContent(data) {
    const root = document.createElement('div');
    root.className = CONTENT_CLASS;
    const categories = normalizeNavDocument(data);
    if (!hasNavEntries(data)) {
        const empty = document.createElement('p');
        empty.className = EMPTY_CLASS;
        empty.textContent = '暂无产品导航：到「系统控制台 → 插件 → 产品导航」添加链接。';
        root.appendChild(empty);
        return root;
    }
    categories.forEach((category) => {
        const block = document.createElement('div');
        block.className = CATEGORY_CLASS;
        const title = document.createElement('h4');
        title.className = CATEGORY_TITLE_CLASS;
        title.textContent = category.name || '';
        block.appendChild(title);
        const list = document.createElement('div');
        list.className = LINKS_CLASS;
        (category.links || []).forEach((link) => {
            const anchor = buildLink(link);
            if (anchor) {
                list.appendChild(anchor);
            }
        });
        block.appendChild(list);
        root.appendChild(block);
    });
    return root;
}
exports.buildNavContent = buildNavContent;
/**
 * Flags on <body> whether the navigation is currently filling the right-hand sidebar.
 *
 * Only the stylesheet above reads the mark, and only to widen the column, so it is
 * added and removed with the sidebar's lifetime and never with the page's.
 */
function markSidebarOpen(open) {
    if (typeof document === 'undefined' || !document.body) {
        return;
    }
    document.body.classList.toggle(BODY_OPEN_CLASS, Boolean(open));
}
exports.markSidebarOpen = markSidebarOpen;
/**
 * Style of the navigation body, wherever it is mounted.
 *
 * Nothing here positions the container: the right-hand sidebar owns its own box,
 * so this only describes the content inside it. The single positional rule is the
 * `min-width` on the sidebar, which keeps the tiles from being squeezed when the
 * administrator asks for more columns than the default sidebar width can hold.
 *
 * The button itself is rendered by Mattermost (it is registered through
 * `registerChannelHeaderButtonAction`), so it needs no rules here — see
 * `components/product_nav_icon.tsx`.
 */
const CONTENT_CSS = (linksPerRow) => `body.${BODY_OPEN_CLASS} #sidebar-right,body.${BODY_OPEN_CLASS} .sidebar--right{` +
    `min-width:${navContentWidthPx(linksPerRow)}px;}` +
    `.${CONTENT_CLASS}{padding:12px 14px;}` +
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
/** The whole stylesheet: the navigation body. */
function fullCss(linksPerRow) {
    return CONTENT_CSS(linksPerRow);
}
/** Id of the stylesheet that quiets the plugin buttons in the channel header. */
const BUTTON_QUIET_STYLE_ID = 'customers-plugin-header-button-quiet';
/**
 * Class Mattermost gives to every plugin channel-header button.
 *
 * The button is rendered by `ChannelHeaderPlug` as a bare `<button>` carrying
 * this class, so it is the only handle a stylesheet has.
 */
const BUTTON_CLASS = 'channel-header__icon';
/**
 * Tail every plugin button id ends with.
 *
 * `ChannelHeaderPlug` builds the id as `plug.id + 'ChannelHeaderButton'`, and
 * `plug.id` is generated per registration, so this suffix picks out exactly the
 * plugin buttons without touching any of Mattermost's own header icons.
 */
const BUTTON_ID_SUFFIX = 'ChannelHeaderButton';
/**
 * The single appearance these buttons are allowed to have, whatever Mattermost
 * thinks their state is.
 *
 * Clicking one of them used to leave the other looking switched on. Nothing in
 * `HeaderIconWrapper` carries state — it renders a bare button — so whatever lit
 * up came from the stylesheet: the focus ring, the fill of `:active`, or the
 * `channel-header__icon--active` modifier, whichever the header decided to leave
 * behind when it re-rendered to make room for the sidebar.
 *
 * Listing every visual property rather than the one seen once means the answer is
 * the same next time the styling moves on. Everything here is `!important` and keyed
 * by `#id`, which out-ranks anything a modifier class can do.
 *
 * `:hover` is among the states, because opening the sidebar re-flows the header —
 * the two buttons end up stacked where there was room for one row — and after the
 * re-flow the pointer no longer sits over the button that was clicked but over its
 * neighbour. A hover reward on the neighbour then reads exactly as "clicking the
 * navigation lights up the trash can", and it is why the two were asymmetric: only
 * opening the sidebar moves the header. The quieting follows the button that was
 * reported as wrongly lighting up; the navigation button keeps Mattermost's hover,
 * since that is the highlight the same report asked to keep.
 */
const BUTTON_QUIET_PROPS = 
// `background`, not `background-color`: a ring drawn as a background image
// survives a transparent colour.
'background:none!important;' +
    'outline:none!important;' +
    'box-shadow:none!important;' +
    'border:none!important;' +
    'color:inherit!important;' +
    'filter:none!important;';
/**
 * Selector for one button, from its real DOM id.
 *
 * A hexadecimal identifier can begin with a digit, and `#1abc…` is not a valid
 * selector, so anything that does not start with an identifier character falls back
 * to the attribute form.
 */
function buttonSelector(domId) {
    return /^[A-Za-z_]/.test(domId) ? `#${domId}` : `[id="${domId}"]`;
}
/**
 * Whether two selectors describe the same button.
 *
 * Used so the discovered set does not grow a duplicate of itself every time the
 * discovery runs and finds both forms of one id.
 */
function describesSameButton(domId, other) {
    if (domId === other) {
        return true;
    }
    return domId.endsWith(other) || other.endsWith(domId);
}
/**
 * Every state selector for one button.
 *
 * The plain selector is what does the heavy lifting: whatever class or pseudo-class
 * the button is carrying, the base appearance is re-asserted. The rest are spelled
 * out so a rule targeting a state specifically cannot win by specificity.
 */
function buttonQuietRules(domId, everyState) {
    const sel = buttonSelector(domId);
    const states = `${sel},` +
        `${sel}:focus,` +
        `${sel}:focus-visible,` +
        `${sel}:active,` +
        `${sel}.${BUTTON_CLASS}--active,`;
    if (!everyState) {
        // The navigation button keeps Mattermost's hover. It is the one highlight the
        // report asked to keep, and its `:hover` is what makes the click feel answered.
        return `${states}{${BUTTON_QUIET_PROPS}}` +
            `${sel}::before,${sel}::after{content:none!important;}` +
            `${sel} *{outline:none!important;box-shadow:none!important;filter:none!important;}`;
    }
    const every = `${states}` +
        `${sel}:hover,` +
        `${sel}:hover:focus,` +
        `${sel}.${BUTTON_CLASS}:hover:focus`;
    return `${every}{${BUTTON_QUIET_PROPS}}` +
        // Nothing decorative the active modifier could paint with a pseudo-element,
        // and nothing its icon or a descendant could paint with a shadow of its own.
        `${sel}.${BUTTON_CLASS}--active::before,${sel}.${BUTTON_CLASS}--active::after{content:none!important;}` +
        `${sel}::before,${sel}::after{content:none!important;}` +
        `${sel} *{outline:none!important;box-shadow:none!important;filter:none!important;}`;
}
/**
 * The aria-labels this plugin's own header buttons carry.
 *
 * Both are what `registerChannelHeaderButtonAction` was given as the tooltip, and
 * `HeaderIconWrapper` copies it onto `aria-label`. Kept next to the discovery below
 * because that is the only reason they exist; `index.tsx` imports the same constants
 * to register with.
 */
exports.HEADER_BUTTON_LABELS = [constants_1.PRODUCT_NAV_TITLE, constants_1.BULK_DELETE_TOOLTIP];
/**
 * The marker this plugin's own header icons carry, as `data-cp-glyph` on the glyph.
 *
 * `HeaderIconWrapper` renders a bare `<button id class onClick>` and copies nothing of
 * the tooltip onto it, so neither the aria-label nor the title can be relied on to
 * recognise these two buttons — instrumenting a live page showed the header holding
 * nothing but Mattermost's own tooltips, and every rule keyed by a label matched
 * nothing, which is why the quieting never reached the trash can. The glyph is the
 * one part of the header button that belongs to this plugin: it is rendered from the
 * element handed to `registerChannelHeaderButtonAction`, so whatever the webapp does
 * to the button around it, the marker and with it the button's identity survive.
 */
exports.HEADER_GLYPH_NAV = 'product-nav';
exports.HEADER_GLYPH_BULK = 'bulk-delete';
/** The channel header's own container, if it is on the page. */
/** Hard ceiling on one search, so a missing header cannot mean scanning the page. */
const HEADER_SCAN_LIMIT = 200;
function headerRoot() {
    if (typeof document === 'undefined') {
        return null;
    }
    return document.querySelector('.channel-header');
}
/**
 * Every clickable element inside the channel header.
 *
 * This used to be `button.channel-header__icon`, which is what `ChannelHeaderPlug`
 * renders and what made the discovery look so reliable. Instrumenting a live page
 * showed the header holding nothing but Mattermost's own two icons at that moment,
 * so the class cannot be leaned on any more — and neither can the element type:
 * a plugin button is a `<button>` when it is rendered directly and something else
 * otherwise. Everything clickable inside the header is collected and the
 * aria-label is what picks this plugin's two out of the list.
 *
 * A missing header root widens the scope to the whole document rather than
 * returning nothing, so a renamed container degrades to a broader search instead
 * of a silent miss.
 */
function headerIconButtons() {
    if (typeof document === 'undefined') {
        return [];
    }
    // Without the container this used to mean "every clickable element on the page",
    // which on a long channel is hundreds of nodes searched once per header change.
    const scope = headerRoot() || document;
    return Array.from(scope.querySelectorAll('button, [role="button"], a')).
        slice(0, HEADER_SCAN_LIMIT);
}
exports.headerIconButtons = headerIconButtons;
/**
 * The real DOM ids of this plugin's header buttons.
 *
 * The identifier `registerChannelHeaderButtonAction` hands back turned out **not**
 * to be the one the rendered button carries — instrumenting a live page showed every
 * id built from it missing, which means every `#…ChannelHeaderButton` rule written
 * so far matched nothing. So the buttons are looked up instead of derived: by their
 * own aria-label first, which picks exactly the two that belong to this plugin, and
 * by the id pattern `ChannelHeaderPlug` uses only if no label matches.
 */
function labelOf(el) {
    const candidates = [
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
    ].concat(Array.from(el.querySelectorAll('[aria-label]')).map((child) => child.getAttribute('aria-label')));
    for (const candidate of candidates) {
        if (candidate && candidate.trim()) {
            return candidate.trim();
        }
    }
    return '';
}
/**
 * Whether a header button carries this plugin's glyph marker, and which one.
 *
 * The marker lives on the icon, one level below the button, and it is the attribute
 * this plugin sets — so it answers "is this ours" without asking the webapp to label
 * anything on its behalf.
 */
function glyphOf(el) {
    const marked = el.matches && el.matches('[data-cp-glyph]') ? el : el.querySelector('[data-cp-glyph]');
    return marked ? (marked.getAttribute('data-cp-glyph') || '') : '';
}
/**
 * This plugin's header buttons, found in the DOM rather than derived from an id.
 *
 * Three passes, richest handle first. The glyph marker is what decides in a real
 * page; the tooltip is kept because some builds do copy it onto the button and that
 * is enough when no marker is around; the id suffix is the last resort for a build
 * that renders neither, and it can only ever hand back buttons of the
 * `…ChannelHeaderButton` shape other plugins share, never Mattermost's own icons.
 */
function discoverHeaderButtons(candidates) {
    const buttons = candidates || headerIconButtons();
    if (buttons.length === 0) {
        return [];
    }
    const found = [];
    const seen = new Set();
    const push = (el, kind) => {
        if (!el.id || seen.has(el.id)) {
            return;
        }
        seen.add(el.id);
        found.push({ domId: el.id, kind, label: labelOf(el) });
    };
    for (const el of buttons) {
        const glyph = glyphOf(el);
        if (glyph !== exports.HEADER_GLYPH_NAV && glyph !== exports.HEADER_GLYPH_BULK) {
            continue;
        }
        push(el, glyph === exports.HEADER_GLYPH_BULK ? 'bulk' : 'nav');
    }
    if (found.length === 0) {
        const labels = exports.HEADER_BUTTON_LABELS;
        for (const el of buttons) {
            const label = labelOf(el);
            if (labels.indexOf(label) < 0) {
                continue;
            }
            push(el, label === constants_1.PRODUCT_NAV_TITLE ? 'nav' : 'bulk');
        }
    }
    if (found.length === 0) {
        for (const el of buttons) {
            if ((el.id || '').endsWith(BUTTON_ID_SUFFIX)) {
                push(el, 'other');
            }
        }
    }
    return found;
}
exports.discoverHeaderButtons = discoverHeaderButtons;
function discoverHeaderButtonDomIds() {
    return discoverHeaderButtons().map((found) => found.domId);
}
exports.discoverHeaderButtonDomIds = discoverHeaderButtonDomIds;
/** Idle gap between discovery attempts, in milliseconds. */
const DISCOVERY_BACKOFF_MS = [0, 100, 300, 800, 1500];
/**
 * Most clickable elements one diagnostic line is allowed to list.
 *
 * The line has to stay copy-pasteable, so the header's own handful of icons is
 * fine and the whole page is not: when the channel header has not mounted yet the
 * scope widens to the document, and there the list runs into hundreds.
 */
/**
 * Labels printed when the header is not up and the scope has widened to the
 * page. Counts, not boxes: that reading exists to name the page, not to list
 * every link in the system menu.
 */
const HEADER_LABEL_SCAN_LIMIT = 8;
const DIAGNOSTIC_LIST_LIMIT = 12;
/**
 * Moments the start-up baseline looks for the channel header, in milliseconds.
 *
 * The header is not up while the plugin starts, and it is not worth printing a
 * reading at every moment until it is — the first ones would say nothing but that
 * the page is still mounting.
 */
const BASELINE_PROBE_MS = [0, 300, 700, 1200, 2000];
/**
 * Everything discovery has ever found, so a later attempt that catches only one
 * button does not drop the other.
 */
const discoveredIds = new Set();
/**
 * The two appearances these buttons are pinned to.
 *
 * The trash can is the one that has to stop replying to the pointer: opening the
 * navigation sidebar re-flows the header, the pointer ends up over it, and its hover
 * reward reads as "the bulk delete button switched on". The navigation button keeps
 * Mattermost's own hover, because that is the one highlight the report asked to keep.
 */
const quietAllIds = new Set();
const quietBaseIds = new Set();
/**
 * Whether the "header is up and none of this plugin's buttons was in it" report has
 * already been printed during the current stretch of attempts.
 *
 * Discovery normally runs before the channel header mounts, and that silence is
 * ordinary — it says nothing, and saying it would be noise. The moment it runs with
 * the header already up and still finds nothing is a different matter: that is the
 * one failure no reading has ever answered, and asking for it with
 * `customersPluginDiag(...)` asks the user to type, which is a step that keeps
 * failing. So the plugin says it once, by itself, and stays quiet afterwards —
 * flagged per stretch, so a whole backoff sequence does not report twice the same.
 */
let missedHeaderReported = false;
function remember(found) {
    for (const known of Array.from(discoveredIds)) {
        if (describesSameButton(found.domId, known)) {
            return;
        }
    }
    discoveredIds.add(found.domId);
    if (found.kind === 'nav') {
        quietBaseIds.add(found.domId);
        return;
    }
    quietAllIds.add(found.domId);
}
let headerWatcher = null;
let headerWatched = null;
let headerWatchTimer = null;
let headerWatchSyncs = 0;
let installedKey = '';
/**
 * How long the watcher waits after a change before searching again.
 *
 * The channel header re-renders in bursts — a channel switch alone replaces most of
 * it — and every mutation would otherwise start a full search. Waiting a beat turns a
 * burst into one search.
 */
const HEADER_WATCH_COOLDOWN_MS = 150;
/**
 * How many searches a single watching stretch may run before giving up.
 *
 * Watching exists to catch the one render that brings the buttons in, not to follow
 * the header for the rest of the session; a header that keeps changing without ever
 * growing a button of ours is not going to, and a phone has no CPU to spare.
 */
const HEADER_WATCH_MAX_SYNCS = 30;
function stopWatchingHeader() {
    if (headerWatchTimer !== null && typeof window !== 'undefined') {
        window.clearTimeout(headerWatchTimer);
        headerWatchTimer = null;
    }
    if (headerWatcher) {
        headerWatcher.disconnect();
        headerWatcher = null;
        headerWatched = null;
    }
}
/**
 * Waits for this plugin's buttons to arrive in the channel header.
 *
 * The buttons are registered while the plugin starts, but Mattermost does not
 * necessarily render them before the channel view re-renders — opening the sidebar
 * is one of the few things that will. A backoff that has already run is over by
 * then, so a fixed schedule can step straight over the only stretch in which the
 * buttons exist, and every reading taken in that stretch reports none. This waits
 * for them instead: nothing is injected and nothing is re-arranged, and the moment
 * a button turns up the search runs again.
 *
 * Watching stops as soon as one is recognised. The DOM id is minted once, so
 * another channel's re-render brings the same id back rather than a new one; there
 * is no second button to wait for.
 */
function watchHeaderForButtons() {
    if (typeof document === 'undefined' ||
        typeof window === 'undefined' ||
        typeof window.MutationObserver !== 'function') {
        return;
    }
    // A watcher whose container has since gone away would keep every later attempt
    // from reaching `attach` below: this returns early whenever a watcher is around,
    // and the one that is around belongs to a branch that is no longer in the
    // document. Dropping it here is what lets the header be watched again.
    if (headerWatcher && headerWatched && !headerWatched.isConnected) {
        stopWatchingHeader();
    }
    if (headerWatcher) {
        return;
    }
    const root = headerRoot();
    if (!root || !root.isConnected) {
        return;
    }
    headerWatched = root;
    const Observer = window.MutationObserver;
    headerWatcher = new Observer(() => {
        // The container can go away with the channel view. Losing it is the same
        // case as not having it: watch the current one, not a detached branch.
        if (!headerWatched || !headerWatched.isConnected) {
            stopWatchingHeader();
            watchHeaderForButtons();
            return;
        }
        // One search per burst. Without this a single channel switch — which
        // replaces most of the header — ran the search once per replaced node, and
        // each of those searches started a backoff of its own.
        if (headerWatchTimer !== null) {
            return;
        }
        headerWatchTimer = window.setTimeout(() => {
            headerWatchTimer = null;
            headerWatchSyncs += 1;
            if (headerWatchSyncs > HEADER_WATCH_MAX_SYNCS) {
                stopWatchingHeader();
                return;
            }
            syncHeaderButtonQuietStyle();
            if (discoveredIds.size > 0) {
                stopWatchingHeader();
            }
        }, HEADER_WATCH_COOLDOWN_MS);
    });
    headerWatcher.observe(root, { childList: true, subtree: true });
}
/**
 * Makes sure this plugin's channel-header buttons keep one appearance in every state.
 *
 * The buttons are discovered rather than derived, so this can run before the first
 * header render; it retries on a short backoff while nothing has appeared yet, which
 * is the normal case: registration happens while Mattermost is still mounting the
 * channel view, and the buttons themselves only arrive with the next render. Safe to
 * call again later — the sheet is rewritten only when its contents change, and once
 * a button has been found it is never dropped.
 */
function syncHeaderButtonQuietStyle(attempt = 0) {
    if (typeof document === 'undefined') {
        return;
    }
    const found = discoverHeaderButtons();
    found.forEach(remember);
    const ids = Array.from(discoveredIds).sort();
    const key = ids.map((domId) => `${domId}:${quietAllIds.has(domId) ? '全' : '基'}`).join(',');
    if (key !== installedKey) {
        installedKey = key;
        installHeaderButtonQuietStyle(ids.map((domId) => ({
            domId,
            quiet: quietAllIds.has(domId),
        })));
    }
    if (found.length > 0) {
        missedHeaderReported = false;
    }
    else if (!missedHeaderReported &&
        navSidebarHasOpened() &&
        typeof window !== 'undefined' &&
        typeof window.getComputedStyle !== 'undefined') {
        // Only now: after the sidebar, so after the click that re-rendered the header.
        // Before it, a header with no buttons of ours in it is just `not yet`, and
        // reporting that is what made the reading worthless.
        missedHeaderReported = true;
        printHeaderReading(`补钉没认出来（第 ${attempt + 1} 次）`, true, false);
        // The header itself, since this is what distinguishes "Mattermost rendered an
        // empty shell" from "the marker never got into the bundle". A row in the list
        // above can call a button `无标签`, which is where eight iterations went to
        // guessing.
        const root = headerRoot();
        if (root) {
            console.info(`头部长这样：${(root.outerHTML || '').slice(0, 360)}`);
        }
    }
    if (found.length > 0 || typeof window === 'undefined') {
        return;
    }
    // Nothing yet. Wait for the header to put the buttons in rather than only for
    // the backoff, which by now has run.
    watchHeaderForButtons();
    // Watching and the backoff are two retries for the same thing. Once the header
    // is being watched, the backoff only multiplies searches — and it was started
    // again by every one of them.
    if (headerWatcher) {
        return;
    }
    const next = DISCOVERY_BACKOFF_MS[attempt + 1];
    if (next === undefined) {
        return;
    }
    window.setTimeout(() => syncHeaderButtonQuietStyle(attempt + 1), next);
}
exports.syncHeaderButtonQuietStyle = syncHeaderButtonQuietStyle;
function installHeaderButtonQuietStyle(targets) {
    if (typeof document === 'undefined' || !document.head || targets.length === 0) {
        return;
    }
    let style = document.getElementById(BUTTON_QUIET_STYLE_ID);
    if (!style) {
        style = document.createElement('style');
        style.id = BUTTON_QUIET_STYLE_ID;
        document.head.appendChild(style);
    }
    style.textContent = targets.map((target) => buttonQuietRules(target.domId, target.quiet)).join('');
}
exports.installHeaderButtonQuietStyle = installHeaderButtonQuietStyle;
const HEADER_DIAG_FLAG = 'customers-plugin:diag';
function shouldLogHeaderDiag() {
    try {
        return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined' &&
            window.localStorage.getItem(HEADER_DIAG_FLAG) === '1';
    }
    catch {
        // Storage blocked (private mode, sandboxed frame): the diagnostic asks,
        // and a question it cannot answer is answered with "no".
        return false;
    }
}
exports.shouldLogHeaderDiag = shouldLogHeaderDiag;
/**
 * Prints what the header buttons are actually wearing, and where they are.
 *
 * Temporary instrumentation for the "clicking the navigation lights up the trash
 * can" report: instead of guessing which property paints the highlight, the real
 * computed values are read while this goes on. Three things matter and none of
 * them was being checked:
 *
 * - whether this plugin's buttons are in the DOM at all at each moment, since a
 *   button that has been unmounted cannot be the one wearing a ring;
 * - whether they carry the class the stylesheet is keyed by, so the same listing
 *   doubles as the check that the discovery above is finding the right elements;
 * - what the rest of the header looks like beside them, because when the sidebar
 *   opens the header re-flows and whatever the pointer lands on next reads as the
 *   button that was clicked.
 *
 * It lists every clickable element in the header rather than the two it thinks are
 * its own — that is how the id mismatch was found, and it is the same class of
 * guess that has to be kept out of this. Removed once the answer is known.
 *
 * `when` labels the moment of the click that caused it; the same reading is
 * repeated afterwards so a button that appears or disappears with the re-render is
 * visible rather than sampled once.
 *
 * Every reading is printed as **one line of text**, not as an object: the first
 * version logged objects, and a report of them came back with nothing but
 * `[customers-plugin] 头部按钮现状 … Object` — the payload folded shut and the one
 * thing the instrumentation existed to answer was lost in the copy-paste. A compact
 * line carries the same fields and survives being pasted into a reply; the header
 * structure gets its own line because it is long enough to bury the rest.
 *
 * `force` prints without the flag. The plugin takes exactly one reading of its own
 * while it starts — the "sidebar still closed" baseline, which is the one reading
 * nothing else can stand in for — and asks before the rest.
 */
/**
 * Whether each of this plugin's header buttons was offered while the plugin started,
 * and what stopped it.
 *
 * The DOM cannot say this. A button that was never registered is absent, and an
 * absent button looks exactly like a registered one that Mattermost has not drawn
 * yet — the two readings below print the same list of icons either way. So
 * `index.tsx` reports what it decided and the reading prints that beside what the
 * DOM holds, which is the only way one glance can separate "this button was never
 * offered" from "this button is somewhere the scan is not looking".
 */
const headerRegistration = {
    productNav: { registered: null, reason: '还没读完配置' },
    bulkDelete: { registered: null, reason: '还没读完配置' },
};
/** Records the registration decision for one of the header buttons. */
function noteHeaderRegistration(kind, registered, reason) {
    headerRegistration[kind] = { registered, reason };
}
exports.noteHeaderRegistration = noteHeaderRegistration;
/**
 * One clickable element of the header, as it stands at the moment of the reading.
 *
 * The properties that could be painting the highlight are the ones worth having:
 * an outline or a ring is what "lit up" looks like, and the box is what says whether
 * the element sits where the pointer and the eye expect it.
 */
function describeHeaderButton(el) {
    const cs = window.getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return {
        tag: el.tagName,
        id: el.id || '(无 id)',
        aria: (el.getAttribute('aria-label') || '').trim(),
        pinned: quietAllIds.has(el.id) ? '已钉(全)' : quietBaseIds.has(el.id) ? '已钉(基)' : '未钉',
        // `:hover` is unknown to a headless DOM, and a throw here would take the
        // whole reading down with it; an unanswerable question prints as `?` rather
        // than being settled by a guess.
        hovered: (() => {
            if (!el.matches) {
                return null;
            }
            try {
                return el.matches(':hover');
            }
            catch {
                return null;
            }
        })(),
        focused: document.activeElement === el,
        disabled: el.disabled === true,
        outline: cs.outlineStyle === 'none' ? 'none' : `${cs.outlineWidth} ${cs.outlineColor}`,
        shadow: cs.boxShadow === 'none' ? 'none' : cs.boxShadow.slice(0, 90),
        background: cs.backgroundColor + (cs.backgroundImage === 'none' ? '' : ' +image'),
        rect: `${Math.round(box.left)},${Math.round(box.top)} ${Math.round(box.width)}x${Math.round(box.height)}`,
        // A button with no icon in it cannot carry the marker: this is what tells
        // the reading apart from "the marker was found but the button is a stranger".
        content: `${el.children.length}子${el.querySelector('svg') ? '+svg' : '无svg'}`,
        markerOnSelf: !!(el.matches && el.matches('[data-cp-glyph]')),
    };
}
/** The same reading, short enough to sit on one line beside the others. */
function compactHeaderRow(row) {
    const short = (value, max) => (value.length > max ? `${value.slice(0, max)}…` : value);
    return `<${row.tag}#${row.id}|${row.aria || '无标签'}|${row.pinned}` +
        `|hover${row.hovered === true ? 'Y' : row.hovered === false ? 'n' : '?'}` +
        `|焦点${row.focused ? 'Y' : 'n'}${row.disabled ? '|禁用' : ''}` +
        `|框${row.outline === 'none' ? '无' : row.outline}|影${row.shadow === 'none' ? '无' : short(row.shadow, 30)}` +
        `|${row.content}${row.markerOnSelf ? '|标记在自身' : ''}` +
        `|${row.rect}>`;
}
/** The header's own clickable elements, or the page's if the header is not up yet. */
function headerScope() {
    const root = headerRoot();
    const scope = root || document;
    return { root, buttons: Array.from(scope.querySelectorAll('button, [role="button"], a')) };
}
/**
 * Whether the navigation sidebar has been opened since this page came up.
 *
 * Opening it is the render that puts this plugin's header buttons into the DOM, so it
 * is also the point after which "no buttons in the header" stops being ordinary and
 * starts being a failure worth a line.
 */
function navSidebarHasOpened() {
    return typeof document !== 'undefined' && !!document.body &&
        document.body.classList.contains(BODY_OPEN_CLASS);
}
/** What `index.tsx` decided about each header button, and why. */
function registrationLine() {
    const cell = (kind) => {
        const record = headerRegistration[kind];
        const mark = record.registered === true ? 'Y' : record.registered === false ? 'N' : '?';
        return `${kind === 'productNav' ? '导航' : '删除'}${mark}(${record.reason})`;
    };
    return `注册:${cell('productNav')}/${cell('bulkDelete')}`;
}
/**
 * The one line the diagnostic prints.
 *
 * Two rules keep it one line. The header's own handful of icons is listed and the
 * page is not: when the header has not mounted yet the scope widens to the whole
 * document, and the list there runs into hundreds — four rounds of that is what put
 * the console under water once. And past the limit the count is kept and the items
 * dropped, so the reading stays short enough to paste back into a reply.
 */
function headerReadingLine(moment, wantList) {
    const rhs = ['#right-hand-sidebar', '.sidebar--right', '.rhs-container'].filter((sel) => !!document.querySelector(sel));
    const { root, buttons } = headerScope();
    const found = discoverHeaderButtons(buttons);
    const ours = buttons.filter((el) => found.some((head) => head.domId === el.id));
    const navCount = found.filter((head) => head.kind === 'nav').length;
    const bulkCount = found.filter((head) => head.kind === 'bulk').length;
    let body;
    if (!root) {
        const names = buttons
            .slice(0, HEADER_LABEL_SCAN_LIMIT)
            .map((el) => labelOf(el))
            .filter((name) => !!name);
        body = `头部未挂载（此刻全页可点共 ${buttons.length} 个，只列 ${names.length} 个标签：${names.join(',') || '无'}）`;
    }
    else if (wantList) {
        const rows = (ours.length > 0 ? ours : buttons).map(describeHeaderButton);
        body = `头部可点共 ${rows.length} 个：` + rows
            .slice(0, DIAGNOSTIC_LIST_LIMIT)
            .map(compactHeaderRow)
            .join(' ') + (rows.length > DIAGNOSTIC_LIST_LIMIT ? ` …（共 ${rows.length} 个）` : '');
    }
    else {
        body = `头部可点共 ${buttons.length} 个（头部没挂上，这一轮不列）`;
    }
    return `[customers-plugin] 头部按钮 ${moment}` +
        `｜${registrationLine()}` +
        `｜侧栏:${rhs.length > 0 ? rhs.join(',') : '无'}` +
        `｜已发现:${Array.from(discoveredIds).join(',') || '无'}` +
        `｜我们的:${ours.length} 个（导航${navCount}/删除${bulkCount}）` +
        `｜${body}`;
}
/** Prints the reading. The structure gets its own line only when it was asked for. */
function printHeaderReading(moment, wantList, withStructure) {
    // eslint-disable-next-line no-console
    console.info(headerReadingLine(moment, wantList));
    if (!withStructure) {
        return;
    }
    const root = headerRoot();
    if (root) {
        const html = root.innerHTML.replace(/\s+/g, ' ').slice(0, 500);
        // eslint-disable-next-line no-console
        console.info(`[customers-plugin] 头部结构 ${moment}｜${html}…`);
    }
}
function logHeaderButtonPaint(when, force = false) {
    if (!force && !shouldLogHeaderDiag()) {
        return;
    }
    if (typeof document === 'undefined' || typeof window === 'undefined' || !window.getComputedStyle) {
        return;
    }
    const sample = (moment) => () => {
        printHeaderReading(moment, true, force);
    };
    sample(when)();
    window.setTimeout(sample(`${when} +300ms`), 300);
    window.setTimeout(sample(`${when} +1000ms`), 1000);
    window.setTimeout(sample(`${when} +2000ms`), 2000);
}
exports.logHeaderButtonPaint = logHeaderButtonPaint;
/**
 * The one reading the plugin takes on its own, while it is starting.
 *
 * Two things make this worth having and worth keeping short. The header is usually
 * not mounted yet at this moment, so the reading waits for it rather than printing
 * the page instead — a page listing is what made the console unreadable, and it
 * answers nothing. And nothing is printed until both registration decisions are in,
 * because a reading taken before they are would report `?` for exactly the question
 * it exists to answer.
 *
 * Everything after this waits to be asked: `customersPluginDiag('点导航后')` in the
 * console, or the `customers-plugin:diag` flag for every reading.
 */
function logHeaderStartupBaseline() {
    if (typeof window === 'undefined' || typeof window.setTimeout === 'undefined' || !window.getComputedStyle) {
        return;
    }
    const decisionsPending = () => (headerRegistration.productNav.registered === null && headerRegistration.bulkDelete.registered === null);
    let printed = false;
    const at = (moment, isLast) => () => {
        if (printed || decisionsPending()) {
            return;
        }
        const root = headerRoot();
        if (root) {
            printed = true;
            printHeaderReading(moment, true, false);
            return;
        }
        // Nothing to read yet, and nothing left to wait for: say so once, briefly.
        if (isLast) {
            printed = true;
            printHeaderReading(moment, false, false);
        }
    };
    for (let index = 0; index < BASELINE_PROBE_MS.length; index += 1) {
        const delay = BASELINE_PROBE_MS[index];
        const probe = at('启动时（面板未开）', index === BASELINE_PROBE_MS.length - 1);
        window.setTimeout(probe, delay);
    }
}
exports.logHeaderStartupBaseline = logHeaderStartupBaseline;
/**
 * Puts the header diagnostic on the console.
 *
 * The most direct way to take a reading: no flag, no reload — whichever moment is
 * the interesting one is typed by hand. It prints regardless of the flag, so the
 * call works before anything has been switched on.
 */
function exposeHeaderDiagnostic() {
    if (typeof window === 'undefined') {
        return;
    }
    window.customersPluginDiag = (when = '手动取样') => logHeaderButtonPaint(when, true);
}
exports.exposeHeaderDiagnostic = exposeHeaderDiagnostic;
/**
 * Takes the focus off a plugin button in the channel header, if there is one.
 *
 * Clicking a button gives it the focus ring; when the header re-renders, a ring
 * left on the bulk-delete button looks like that button being switched on. Only
 * buttons of this plugin are touched, and nothing else is focused — the focus ring
 * of a keyboard user on another control is left where it is.
 */
function blurHeaderButtonFocus() {
    if (typeof document === 'undefined') {
        return;
    }
    const active = document.activeElement;
    if (active && typeof active.classList === 'object' && active.classList.contains(BUTTON_CLASS)) {
        active.blur();
    }
}
exports.blurHeaderButtonFocus = blurHeaderButtonFocus;
/**
 * Makes sure the navigation stylesheet is in the document and current.
 *
 * Called twice on purpose: once when the plugin starts (so the sidebar is styled from
 * the first paint) and again by the sidebar component, which also owns the row size
 * and rewrites the sheet when the setting changes.
 *
 * The existing element is reused when one is already there, so a second caller —
 * or a remount that races the old one — cannot leave two stylesheets with the
 * same id fighting over the last write.
 */
function installNavStyle(linksPerRow) {
    const existing = document.getElementById(STYLE_ID);
    if (existing) {
        existing.textContent = fullCss(linksPerRow);
        return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
    style.textContent = fullCss(linksPerRow);
}
exports.installNavStyle = installNavStyle;
