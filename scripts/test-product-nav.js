/*
 * 用 jsdom 实测「产品导航」。
 *
 * 导航按钮是 Mattermost 的频道头部按钮（`registerChannelHeaderButtonAction`），
 * 由 webapp 渲染，这里测不到也无需测；能测的是它复用的那些纯函数：地址清洗、
 * 保存前校验、条目归一化、正文构建（`buildNavContent`，右侧栏组件用的就是它）、
 * 列数与宽度、样式表、栏位打开标记，以及条目在「插件启动」与「右侧栏组件」之间
 * 传递的那座桥。
 *
 * 最后用正则读 `src/index.tsx`，守住两条容易踩回去的注册写法。
 *
 * 运行（需先在 webapp 目录 npm install 过）：
 *   NODE_PATH="C:/Users/cheny/.workbuddy/binaries/node/workspace/node_modules" \
 *     node scripts/test-product-nav.js
 */
'use strict';

const {execFileSync} = require('child_process');
const fs = require('fs');
const path = require('path');
const {JSDOM} = require('jsdom');

const WEBAPP = path.resolve(__dirname, '..', 'webapp');
const OUT = path.join(WEBAPP, '.tmp-test-nav');

let pass = 0;
let fail = 0;
function ok(cond, label) {
    if (cond) {
        pass++;
        console.log('  PASS - ' + label);
    } else {
        fail++;
        console.log('  FAIL - ' + label);
    }
}

/* ---------- 1. 编译 TS ---------- */
fs.rmSync(OUT, {recursive: true, force: true});
const tsc = path.join(WEBAPP, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(process.execPath, [
    tsc,
    'src/product_nav.ts',
    'src/product_nav_store.ts',
    'src/crash_report.ts',
    '--outDir', '.tmp-test-nav',
    '--module', 'commonjs',
    '--target', 'es2019',
    '--lib', 'dom,es2019',
    '--moduleResolution', 'node',
    '--skipLibCheck',
    '--esModuleInterop',
], {cwd: WEBAPP, stdio: 'inherit'});

const {
    DEFAULT_PRODUCT_NAV_LINKS_PER_ROW,
    MIN_PRODUCT_NAV_LINKS_PER_ROW,
    MAX_PRODUCT_NAV_LINKS_PER_ROW,
} = require(path.join(OUT, 'constants.js'));

const {
    normalizeLinksPerRow,
    navContentWidthPx,
    collectNavProblems,
    countUsableNavLinks,
    isBlankNavLink,
    normalizeNavDocument,
    safeNavUrl,
    buildNavContent,
    applyNavFilter,
    hasNavEntries,
    installNavStyle,
    markSidebarOpen,
    installHeaderButtonQuietStyle,
    blurHeaderButtonFocus,
    discoverHeaderButtonDomIds,
    discoverHeaderButtons,
    syncHeaderButtonQuietStyle,
    logHeaderButtonPaint,
    logHeaderStartupBaseline,
    noteHeaderRegistration,
    exposeHeaderDiagnostic,
    shouldLogHeaderDiag,
    headerQuietStyleText,
    HEADER_BUTTON_LABELS,
} = require(path.join(OUT, 'product_nav.js'));

const {
    getNavDocument,
    setNavDocument,
    subscribeNavDocument,
} = require(path.join(OUT, 'product_nav_store.js'));

/* ---------- 2. DOM ---------- */
const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://localhost/'});

global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;

const document = dom.window.document;

const STYLE_ID = 'customers-plugin-product-nav-style';
const BODY_OPEN_CLASS = 'customers-plugin-nav-rhs-open';
const LINK = '.customers-plugin-nav-link';
const CATEGORY = '.customers-plugin-nav-category';
const CATEGORY_TITLE = '.customers-plugin-nav-category-title';
const CATEGORY_ICON = '.customers-plugin-nav-category-icon';

const DATA = {
    categories: [
        {
            id: 'cat-1',
            name: '内部系统',
            iconUrl: 'https://example.com/cat.png',
            links: [
                {id: 'l1', name: '工单系统', url: 'https://example.com/ticket', iconUrl: 'https://example.com/t.png'},
                {id: 'l2', name: '知识库', url: 'https://example.com/wiki', iconUrl: ''},
                {
                    id: 'l5',
                    name: '易研方案',
                    url: 'https://example.com/portal',
                    subLinks: [
                        {name: '媒体页', url: 'https://example.com/portal/media'},
                        {name: '下载页', url: 'https://example.com/portal/download'},
                    ],
                },
            ],
        },
        {
            id: 'cat-2',
            name: '外部资源',
            links: [
                {id: 'l3', name: '官网', url: 'https://example.org'},
                {id: 'l4', name: '恶意链接', url: 'javascript:alert(1)'},
            ],
        },
    ],
};

function css() {
    const style = document.getElementById(STYLE_ID);
    return style ? style.textContent : '';
}

(async () => {
    console.log('\n[1] safeNavUrl');
    ok(safeNavUrl('https://example.com/a') === 'https://example.com/a', 'https 保留');
    ok(safeNavUrl('http://example.com/a') === 'http://example.com/a', 'http 保留');
    ok(safeNavUrl('/static/nav.png') === '/static/nav.png', '站点相对路径保留');
    ok(safeNavUrl('javascript:alert(1)') === '', 'javascript: 被拒');
    ok(safeNavUrl('data:image/png;base64,AA') === '', 'data: 被拒');
    ok(safeNavUrl('//evil.example.com') === '', '协议相对被拒');
    ok(safeNavUrl('https://example.com/a b') === '', '带空格被拒');
    ok(safeNavUrl('') === '' && safeNavUrl(undefined) === '', '空值被拒');

    console.log('\n[1.5] 保存前校验（避免"保存后东西消失了"）');
    ok(isBlankNavLink({id: 'x', name: '', url: '', iconUrl: ''}) === true, '全空的行算空白');
    ok(isBlankNavLink({id: 'x', name: '工单', url: '', iconUrl: ''}) === false, '填了名称就不算空白');
    ok(isBlankNavLink({id: 'x', name: '', url: '', iconUrl: 'https://e.com/a.png'}) === false, '只填 logo 也不算空白');

    const blankRow = {id: 'c', name: '内部', links: [{id: 'l', name: '', url: '', iconUrl: ''}]};
    ok(collectNavProblems([blankRow]).length === 0, '空白行不报错（新增行很常见）');

    ok(collectNavProblems([{id: 'c', name: '内部', links: [{id: 'l', name: '工单', url: ''}]}]).length === 1, '缺地址会报错');
    ok(collectNavProblems([{id: 'c', name: '内部', links: [{id: 'l', name: '', url: 'https://e.com'}]}]).length === 1, '缺名称会报错');
    ok(collectNavProblems([{id: 'c', name: '内部', links: [{id: 'l', name: '工单', url: 'example.com'}]}]).length === 1, '缺 https:// 会报错');
    ok(collectNavProblems([{id: 'c', name: '内部', links: [{id: 'l', name: '工单', url: 'javascript:alert(1)'}]}]).length === 1, '脚本地址会报错');
    ok(collectNavProblems([{id: 'c', name: '内部', links: [{id: 'l', name: '工单', url: '/admin_console'}]}]).length === 0, '站点相对路径合法');

    const problem = collectNavProblems([{id: 'c', name: '内部', links: [{id: 'l', name: '工单', url: 'example.com'}]}])[0];
    ok(problem.indexOf('第 1 个分类 第 1 条链接') === 0, '报错指明是哪一行（' + problem + '）');

    ok(countUsableNavLinks([{id: 'c', name: 'x', links: [
        {id: 'a', name: '可用', url: 'https://e.com'},
        {id: 'b', name: '', url: ''},
        {id: 'd', name: '坏地址', url: 'example.com'},
    ]}]) === 1, '只数服务端会保留的链接');

    console.log('\n[1.55] 子链接校验（同一产品的附加入口）');
    const subProblems = collectNavProblems([{id: 'c', name: '分类', links: [{
        id: 'l', name: '工单', url: 'https://e.com', subLinks: [
            {name: '', url: 'https://e.com/a'},
            {name: '没有地址', url: ''},
            {name: '脚本', url: 'javascript:alert(1)'},
            {name: '正常', url: 'https://e.com/b'},
        ],
    }]}]);
    ok(subProblems.length === 3, '3 条坏子链接各报一条（' + subProblems.length + '）');
    ok(subProblems[0].indexOf('第 1 个子链接：缺少名称') > 0, '报错指明是第几个子链接');
    ok(subProblems[1].indexOf('缺少地址') > 0, '缺地址的子链接有报错');
    ok(subProblems[2].indexOf('javascript:') > 0, '脚本地址的子链接有报错');

    // 一行只有子链接、名称和地址都空着不算空行的问题行？——算空行（新建行的常态）。
    const blankWithSub = collectNavProblems([{id: 'c', name: '分类', links: [{
        id: 'l', name: '', url: '', subLinks: [],
    }]}]);
    ok(blankWithSub.length === 0, '完全空白的行不报错');

    console.log('\n[1.6] normalizeNavDocument（服务端旧数据可能带 null）');
    ok(Array.isArray(normalizeNavDocument(null)) && normalizeNavDocument(null).length === 0, 'null 文档不会炸');
    ok(Array.isArray(normalizeNavDocument(undefined)) && normalizeNavDocument(undefined).length === 0, 'undefined 文档不会炸');
    ok(normalizeNavDocument({categories: null}).length === 0, 'categories: null 变空数组');
    ok(normalizeNavDocument({categories: undefined}).length === 0, 'categories 缺失变空数组');
    ok(normalizeNavDocument({}).length === 0, '空对象变空数组');

    const nullLinks = normalizeNavDocument({categories: [{id: 'c', name: '内部', links: null}]});
    ok(nullLinks.length === 1 && Array.isArray(nullLinks[0].links) && nullLinks[0].links.length === 0,
        'links: null 变空数组（本次崩溃的直接原因）');

    const noLinksField = normalizeNavDocument({categories: [{id: 'c', name: '内部'}]});
    ok(Array.isArray(noLinksField[0].links) && noLinksField[0].links.length === 0, '缺 links 字段也安全');

    const nullCategory = normalizeNavDocument({categories: [null, {id: 'c', name: '内部', links: null}]});
    ok(nullCategory.length === 1 && nullCategory[0].name === '内部', '数组里的 null 分类被跳过');

    const filled = normalizeNavDocument({
        categories: [{id: 'c', name: '内部', iconUrl: 'https://e.com/cat.png', links: [{id: 'l', name: '工单', url: 'https://e.com'}]}],
    });
    ok(filled[0].links[0].iconUrl === '', '缺 iconUrl 补空串（不会读到 undefined）');
    ok(filled[0].iconUrl === 'https://e.com/cat.png', '分类的 iconUrl 原样保留');
    ok(filled[0].links[0].url === 'https://e.com', '正常数据原样保留');

    const noCatIcon = normalizeNavDocument({
        categories: [{id: 'c', name: '内部', links: []}],
    });
    ok(noCatIcon[0].iconUrl === '', '分类缺 iconUrl 也补空串（旧数据是老版本存的）');

    const withSubs = normalizeNavDocument({
        categories: [{id: 'c', name: '内部', links: [{id: 'l', name: '工单', url: 'https://e.com', subLinks: [
            {name: '媒体页', url: 'https://e.com/media'},
        ]}]}, {id: 'c2', name: '旧数据', links: [{id: 'l2', name: '工单', url: 'https://e.com'}]}],
    });
    ok(withSubs[0].links[0].subLinks.length === 1 && withSubs[0].links[0].subLinks[0].name === '媒体页',
        '子链接原样保留');
    ok(withSubs[1].links[0].subLinks.length === 0, '旧数据没有子链接字段，补成空数组（不读到 undefined）');

    console.log('\n[2] 样式表（只有正文；按钮由 Mattermost 渲染）');
    installNavStyle(DEFAULT_PRODUCT_NAV_LINKS_PER_ROW);
    ok(!!document.getElementById(STYLE_ID), '注入了样式表');
    ok(css().indexOf('display:grid') >= 0, '链接容器用 grid 布局');
    ok(css().indexOf('position:fixed') < 0, '不再注入 position:fixed（正文交给右侧栏托管）');
    ok(css().indexOf(BODY_OPEN_CLASS) >= 0, '样式里带「右侧栏打开」的标记，用来按需加宽栏位');
    ok(css().indexOf('customers-plugin-nav-button') < 0, '不再注入按钮样式（按钮是频道头部的原生按钮）');
    ok(/body\.customers-plugin-nav-rhs-open \.customers-plugin-nav-sidebar\{[^}]*overflow-y:auto/.test(css()),
        '侧栏容器自己滚动（内容超长不再被裁掉，10.12 的插件正文没有自带滚动容器）');
    ok(/body\.customers-plugin-nav-rhs-open \.customers-plugin-nav-sidebar\{[^}]*min-height:0/.test(css()),
        '带 min-height:0（flex 子项不缩到内容以下，这条没有它滚不起来）');
    ok(/\.customers-plugin-nav-search\{[^}]*position:sticky/.test(css()),
        '搜索框吸顶（长列表滚下去还能接着搜）');

    console.log('\n[2.5] 手机端滚动（窄屏外层没有确定高度，正文会撑开而不是滚动）');
    ok(css().indexOf('@media screen and (max-width: 768px)') >= 0, '样式里有手机断点（768 = Mattermost 自己的分界）');
    const mobile = css().slice(css().indexOf('@media screen and (max-width: 768px)'));
    ok(/body\.customers-plugin-nav-rhs-open \.sidebar-right__body\{[^}]*height:calc\(100vh - 56px\)/.test(mobile),
        '手机上给正文一个视口基准高度（外层高度不确定时它才滚得起来）');
    ok(/body\.customers-plugin-nav-rhs-open \.sidebar-right__body\{[^}]*max-height:100%/.test(mobile),
        '带 max-height:100% 兜底（外层其实有确定高度时不会算过头、不会盖到别的区域）');
    ok(/body\.customers-plugin-nav-rhs-open \.customers-plugin-nav-sidebar\{[^}]*-webkit-overflow-scrolling:touch/.test(mobile),
        '手机上开了惯性滚动（iOS 否则像卡住）');
    ok(mobile.indexOf('customers-plugin-nav-sidebar{flex:1 1 auto') >= 0 ||
        /customers-plugin-nav-sidebar\{[^}]*flex:1 1 auto/.test(mobile),
        '手机上的正文自己滚动（不是靠页面滚）');

    console.log('\n[3] 导航正文构建（右侧栏组件复用的就是它）');
    const content = buildNavContent(DATA);
    ok(content.className === 'customers-plugin-nav-content', '根节点带内容 class（样式表认它）');
    ok(content.querySelectorAll(CATEGORY).length === 2, '渲染了 2 个分类');
    ok(content.textContent.indexOf('内部系统') >= 0, '分类名渲染出来了');

    const links = content.querySelectorAll(LINK);
    ok(links.length === 4, '渲染了 4 个链接（恶意链接被过滤）');
    ok(links[0].getAttribute('href') === 'https://example.com/ticket', '链接地址正确');
    ok(links[0].getAttribute('target') === '_blank', '新窗口打开');
    ok(links[0].getAttribute('rel') === 'noopener noreferrer', '带 noopener noreferrer');
    ok(!!links[0].querySelector('img'), '有 logo 的链接渲染 img');
    ok(!links[1].querySelector('img'), '没有 logo 的链接不渲染 img');
    ok(links[1].querySelector('.customers-plugin-nav-logo').textContent === '知', '无 logo 时显示名称首字');

    console.log('\n[3.2] 分类 logo（v0.6.37：分类标题前的小图标）');
    const titles = content.querySelectorAll(CATEGORY_TITLE);
    ok(titles.length === 2, '两个分类标题都在');
    const catImg = titles[0].querySelector('img' + CATEGORY_ICON);
    ok(Boolean(catImg), '带 logo 的分类标题渲染 img');
    ok(catImg && catImg.getAttribute('src') === 'https://example.com/cat.png', '分类 logo 地址正确');
    ok(catImg && catImg.getAttribute('alt') === '', '分类 logo 不带 alt（装饰图，读屏器只念标题）');
    ok(titles[0].textContent.indexOf('内部系统') >= 0, '标题文字还在（img 旁边是 span 文字）');
    ok(!titles[1].querySelector('img'), '没有 logo 的分类只渲染文字');
    ok(content.textContent.indexOf('外部资源') >= 0, '无 logo 分类的标题文字不受影响');

    // logo 404 时退回纯文字标题，不留破图图标。
    const broken = titles[0].querySelector('img' + CATEGORY_ICON);
    broken.dispatchEvent(new dom.window.Event('error'));
    ok(!titles[0].querySelector('img'), '分类 logo 加载失败后退回纯文字（不留破图）');
    ok(titles[0].textContent.indexOf('内部系统') >= 0, '退回后标题文字还在');

    // 危险地址不许当分类 logo。
    const evil = buildNavContent({categories: [
        {id: 'c', name: '坏分类', iconUrl: 'javascript:alert(1)', links: [{id: 'l', name: '工单', url: 'https://e.com'}]},
    ]});
    ok(!evil.querySelector(CATEGORY_TITLE + ' img'), 'javascript: 不能当分类 logo');

    ok(css().indexOf('customers-plugin-nav-category-icon') >= 0, '样式表里有分类 logo 的规则');

    console.log('\n[3.3] 一个产品多条链接（v0.6.39：点卡片弹菜单）');
    const multiData = buildNavContent(DATA);
    const multi = multiData.querySelectorAll(LINK)[2];
    ok(multi && multi.tagName === 'DIV', '多链接产品渲染成卡片（div），不是 <a>');
    ok(multi.getAttribute('role') === 'button', '带 role=button');
    ok(multi.getAttribute('aria-expanded') === 'false', '初始收起');
    ok(multi.textContent.indexOf('易研方案') >= 0, '产品名称照常显示');
    const mChevron = multi.querySelector('.customers-plugin-nav-chevron');
    ok(Boolean(mChevron), '带展开角标');
    const mMenu = multi.querySelector('.customers-plugin-nav-submenu');
    ok(mMenu && mMenu.hidden, '菜单初始隐藏');
    ok(multi.dataset.pluginNav === 'link', '卡片可寻址（搜索与诊断按这个标记认它）');

    // 单链接产品保持 <a> 直跳。
    const singleLink = multiData.querySelectorAll(LINK)[0];
    ok(singleLink.tagName === 'A' && singleLink.getAttribute('href') === 'https://example.com/ticket',
        '单链接产品仍是 <a>，点击直接跳');

    // 点击展开 / 再点收起。
    const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', {bubbles: true}));
    click(multi);
    ok(!mMenu.hidden, '点击卡片展开菜单');
    ok(multi.getAttribute('aria-expanded') === 'true', 'aria-expanded 跟随展开');
    const mItems = mMenu.querySelectorAll('a.customers-plugin-nav-submenu-item');
    ok(mItems.length === 3, '菜单含主链接 + 2 条子链接');
    ok(mItems[0].getAttribute('href') === 'https://example.com/portal' && mItems[0].textContent.indexOf('主链接') >= 0,
        '第一项是主链接并带标注');
    ok(mItems[1].getAttribute('href') === 'https://example.com/portal/media', '子链接地址正确');
    ok(mItems[1].getAttribute('target') === '_blank', '子链接新窗口打开');
    click(multi);
    ok(mMenu.hidden, '再点卡片收起菜单');

    // 同时只展开一张：开第二张，第一张自动收。
    const twoMulti = buildNavContent({categories: [{id: 'c', name: '分类', links: [
        {id: 'a', name: '产品A', url: 'https://e.com/a', subLinks: [{name: 'a2', url: 'https://e.com/a/2'}]},
        {id: 'b', name: '产品B', url: 'https://e.com/b', subLinks: [{name: 'b2', url: 'https://e.com/b/2'}]},
    ]}]});
    const tA = twoMulti.querySelectorAll(LINK)[0];
    const tB = twoMulti.querySelectorAll(LINK)[1];
    const mA = tA.querySelector('.customers-plugin-nav-submenu');
    const mB = tB.querySelector('.customers-plugin-nav-submenu');
    click(tA);
    ok(!mA.hidden, '第一张展开');
    click(tB);
    ok(!mB.hidden && mA.hidden, '开第二张时第一张自动收起');

    // 点菜单项 = 跳转，不再把菜单开开合合。
    mB.querySelectorAll('a.customers-plugin-nav-submenu-item')[0].
        dispatchEvent(new dom.window.MouseEvent('click', {bubbles: true}));
    ok(mB.hidden, '点菜单项后菜单收起（跳转走，不顺手再弹开）');

    // 点卡片外面收起。
    click(tB);
    ok(!mB.hidden, '再次点卡片重新展开');
    document.body.dispatchEvent(new dom.window.MouseEvent('click', {bubbles: true}));
    ok(mB.hidden, '点卡片外面收起菜单');

    // 只有一条子链接时不足以弹菜单，回到普通 <a>。
    const oneSub = buildNavContent({categories: [{id: 'c', name: '分类', links: [
        {id: 'a', name: '产品', url: 'https://e.com', subLinks: [{name: '唯一', url: 'javascript:alert(1)'}]},
    ]}]});
    ok(oneSub.querySelectorAll(LINK)[0].tagName === 'A',
        '子链接被清洗到不足 2 条时，仍是普通直跳卡片');

    console.log('\n[3.4] 分类分割线（v0.6.38：若隐若现，上下留白大）');
    const divider = css().match(/\.customers-plugin-nav-category \+ \.customers-plugin-nav-category\{[^}]*\}/);
    ok(Boolean(divider), '分隔线规则写在相邻分类上（第一个分类顶上没有线）');
    ok(divider && divider[0].indexOf('border-top:1px solid') >= 0, '线是 1px 的 border-top');
    ok(divider && /border-top:1px solid rgba\([^\n]*0\.07\)/.test(divider[0]), '颜色极淡（0.07 透明度，若隐若现）');
    ok(divider && divider[0].indexOf('margin-top:14px;padding-top:14px') >= 0, '线上下各留 14px 空气');

    console.log('\n[3.45] 分类产品计数（v0.6.40：标题后的小徽标，搜索时跟数）');
    const cntContent = buildNavContent(DATA);
    const cntBlocks = cntContent.querySelectorAll(CATEGORY);
    const cntBadges = cntContent.querySelectorAll('.customers-plugin-nav-category-count');
    ok(cntBadges.length === 2, '两个分类都有计数徽标');
    ok(cntBadges[0].textContent === '3' && cntBadges[1].textContent === '1',
        '计数 = 分类里的产品数（服务端会过滤掉的坏链接不算）');
    ok(cntBlocks[0].dataset.navTotal === '3', '总数记在分类节点上（搜索收场要还回这个数）');
    const cntBox = cntContent.querySelector('input.customers-plugin-nav-search');
    cntBox.value = '知识';
    cntBox.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
    ok(cntBadges[0].textContent === '1', '搜索时徽标显示该分类的匹配数');
    cntBox.value = '';
    cntBox.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
    ok(cntBadges[0].textContent === '3', '清空搜索恢复总数');
    ok(css().indexOf('customers-plugin-nav-category-count') >= 0, '样式表里有计数徽标规则');

    console.log('\n[3.5] 搜索时分割线的边角');
    const divContent = buildNavContent(DATA);
    const divBox = divContent.querySelector('input.customers-plugin-nav-search');
    const divBlocks = divContent.querySelectorAll(CATEGORY);
    divBox.value = '知识';
    divBox.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
    ok(divBlocks[0].style.borderTopWidth === '0px' || divBlocks[0].style.borderTopWidth === '0',
        '搜索时第一条可见分类不带分割线（它前面的分类被隐藏了，CSS 却看不见 display:none）');
    divBox.value = '';
    divBox.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
    ok(divBlocks[0].style.borderTopWidth === '' && divBlocks[1].style.borderTopWidth === '',
        '清空搜索后分割线交还给样式表规则');

    console.log('\n[4] 没有条目时不注册按钮');
    ok(hasNavEntries(DATA) === true, '有条目 -> 显示按钮');
    ok(hasNavEntries({categories: []}) === false, '分类为空 -> 不显示按钮');
    ok(hasNavEntries(null) === false, '数据还没到 -> 不显示按钮');
    ok(buildNavContent(null).textContent.indexOf('暂无产品导航') >= 0, '正文给一句空态文案（而不是空白栏位）');
    ok(buildNavContent({categories: []}).querySelectorAll(LINK).length === 0, '空数据不渲染任何链接');

    console.log('\n[4.5] 搜索框（v0.6.34：按名称/地址就地过滤）');
    const searchable = buildNavContent(DATA);
    const box = searchable.querySelector('input.customers-plugin-nav-search');
    ok(Boolean(box), '正文顶部有一个搜索框');
    ok(box && box.getAttribute('placeholder') === '搜索产品…', '占位文案写明是搜产品');
    ok(box && box.getAttribute('aria-label') === '搜索产品', '带 aria-label（读屏器念得出它是干嘛的）');
    ok(searchable.querySelector('.customers-plugin-nav-no-match').style.display === 'none',
        '没打字时不显示「没有匹配」');
    ok(!buildNavContent(null).querySelector('input'), '空态（暂无产品导航）时不放搜索框');

    // 打字 = input 事件触发就地过滤，不重建 DOM（重建会把输入框焦点打掉）。
    const hide = (el) => el.style.display === 'none';
    box.value = '知识';
    box.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
    const sLinks = Array.from(searchable.querySelectorAll(LINK));
    ok(hide(sLinks[0]), '打「知识」：工单系统被隐藏');
    ok(!hide(sLinks[1]), '打「知识」：知识库保留');
    ok(searchable.querySelectorAll(CATEGORY + ':not([style*="none"])').length === 1,
        '打「知识」：链接全被滤掉的分类整块隐藏');
    ok(searchable.querySelector('.customers-plugin-nav-no-match').style.display === 'none',
        '还有匹配时不显示「没有匹配」');

    // 大小写与地址也能搜。
    box.value = 'EXAMPLE.ORG';
    box.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
    const byUrl = Array.from(searchable.querySelectorAll(LINK));
    ok(hide(byUrl[0]) && hide(byUrl[1]) && hide(byUrl[2]) && !hide(byUrl[3]), '按地址搜（不区分大小写）也能命中');
    ok(hide(searchable.querySelectorAll(CATEGORY)[0]),
        '第一个分类整体被隐藏（它的链接一个都不匹配）');

    box.value = '不存在的产品';
    box.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
    ok(Array.from(searchable.querySelectorAll(LINK)).every(hide), '全部不匹配时所有链接都隐藏');
    ok(searchable.querySelector('.customers-plugin-nav-no-match').style.display !== 'none',
        '全部不匹配时显示「没有匹配的产品」');

    box.value = '  ';
    box.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
    ok(!Array.from(searchable.querySelectorAll(LINK)).some(hide), '清空（纯空白也算）后全部恢复');
    ok(searchable.querySelector('.customers-plugin-nav-no-match').style.display === 'none',
        '清空后「没有匹配」也收走');

    // applyNavFilter 直接调用与走事件是同一条路。
    applyNavFilter(searchable, '工单');
    ok(hide(searchable.querySelectorAll(LINK)[1]) && hide(searchable.querySelectorAll(LINK)[2]),
        'applyNavFilter 也能直接过滤（导出的纯函数，事件里调的就是它）');

    // 子链接名称也能搜到产品卡片。
    applyNavFilter(searchable, '媒体页');
    const sAll = Array.from(searchable.querySelectorAll(LINK));
    ok(!hide(sAll[2]) && [0, 1, 3].every((i) => hide(sAll[i])),
        '按子链接名称搜，能带出产品卡片（其他产品隐藏）');
    applyNavFilter(searchable, '');

    // 条目刷新会重建整个正文：打过的搜索词必须活着带到新正文上。
    const rebuilt = buildNavContent(DATA);
    const rebuiltBox = rebuilt.querySelector('input.customers-plugin-nav-search');
    ok(rebuiltBox.value === '  ', '重建后的正文把上一次的搜索词带回输入框');
    ok(!Array.from(rebuilt.querySelectorAll(LINK)).some(hide), '空白词在新正文上不过滤任何链接');
    rebuiltBox.value = '官网';
    rebuiltBox.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
    ok(hide(rebuilt.querySelectorAll(LINK)[0]), '新正文上打字照常过滤');
    box.value = '';
    box.dispatchEvent(new dom.window.Event('input', {bubbles: true}));

    console.log('\n[5] 每行 5 个链接');

    ok(DEFAULT_PRODUCT_NAV_LINKS_PER_ROW === 5, '默认每行 5 个链接');
    ok(new RegExp('repeat\\(' + DEFAULT_PRODUCT_NAV_LINKS_PER_ROW + ',minmax\\(0,1fr\\)\\)').test(css()),
        '链接容器是 ' + DEFAULT_PRODUCT_NAV_LINKS_PER_ROW + ' 列网格（不是靠 flex-wrap 碰运气）');

    const needed = 5 * 56 + 4 * 6 + 2 * 14;
    ok(navContentWidthPx(5) === needed, '正文需要 ' + needed + 'px 才装得下 5 个瓦片');
    ok(new RegExp('min-width:' + needed + 'px').test(css()), '样式表按这个宽度请求加宽右侧栏');

    // 瓦片自己不能再有固定宽度，否则列宽由它决定、网格失效。
    const linkRule = (/\.customers-plugin-nav-link\{([^}]*)\}/.exec(css()) || [])[1] || '';
    ok(linkRule.indexOf('width:100%') >= 0 && linkRule.indexOf('width:88px') < 0,
        '瓦片宽度交给网格（width:100%，不再是写死的 88px）');

    // 5 列时名字会窄到一行显示不下，所以必须限高两行。
    ok(css().indexOf('-webkit-line-clamp:2') >= 0, '名称最多两行（5 列瓦片太窄，单行会被截没）');

    const many = buildNavContent({
        categories: [{id: 'cat-row', name: '一排', links: [1, 2, 3, 4, 5, 6].map((n) => ({
            id: 'l' + n,
            name: '系统' + n,
            url: 'https://example.com/' + n,
        }))}],
    });
    ok(many.querySelectorAll(LINK).length === 6, '6 条链接全部渲染（第 6 条换到第二行）');
    ok(many.querySelectorAll('.customers-plugin-nav-links').length === 1, '一个分类只有一个链接容器');

    console.log('\n[6] 每行个数可配置（插件设置）');
    ok(normalizeLinksPerRow(4) === 4, '填 4 就是 4');
    ok(normalizeLinksPerRow(1) === MIN_PRODUCT_NAV_LINKS_PER_ROW, '最少 1');
    ok(normalizeLinksPerRow(12) === MAX_PRODUCT_NAV_LINKS_PER_ROW, '最多 12');
    ok(normalizeLinksPerRow(0) === DEFAULT_PRODUCT_NAV_LINKS_PER_ROW, '填 0 / 留空 -> 回默认 5');
    ok(normalizeLinksPerRow(undefined) === DEFAULT_PRODUCT_NAV_LINKS_PER_ROW, '服务端没下发 -> 回默认 5');
    ok(normalizeLinksPerRow('6') === 6, '字符串数字也能用（控制台里可能存成字符串）');
    ok(normalizeLinksPerRow('abc') === DEFAULT_PRODUCT_NAV_LINKS_PER_ROW, '非数字 -> 回默认');
    ok(normalizeLinksPerRow(99) === DEFAULT_PRODUCT_NAV_LINKS_PER_ROW, '超上限不夹到 12，直接回默认（填错要看得出来）');
    ok(normalizeLinksPerRow(-3) === DEFAULT_PRODUCT_NAV_LINKS_PER_ROW, '负数同样回默认');

    ok(navContentWidthPx(1) === 2 * 14 + 56, '1 列：宽度 = 内边距 + 一个瓦片');
    ok(navContentWidthPx(6) === 2 * 14 + 6 * 56 + 5 * 6, '6 列：宽度随列数增长');
    ok(navContentWidthPx(6) > navContentWidthPx(5), '列数越多需要的宽度越大（不会让第 6 个换行）');
    ok(navContentWidthPx(0) === navContentWidthPx(DEFAULT_PRODUCT_NAV_LINKS_PER_ROW), '非法列数用默认宽度');

    // 改列数就是重写样式表：同一 id 的那一份被就地改写，不会出现第二份。
    installNavStyle(6);
    ok(new RegExp('repeat\\(6,minmax\\(0,1fr\\)\\)').test(css()), '样式表立刻改成 6 列');
    ok(new RegExp('min-width:' + navContentWidthPx(6) + 'px').test(css()), '右侧栏请求宽度同步变成 ' + navContentWidthPx(6) + 'px');

    console.log('\n[7] 样式与「栏位打开」标记');
    // 右侧栏组件也会装一次样式：它可能在按钮之前挂载，那时文档里还没有样式表。
    installNavStyle(6);
    ok(!!document.getElementById(STYLE_ID), 'installNavStyle 补回了样式表');
    ok(new RegExp('repeat\\(6,minmax\\(0,1fr\\)\\)').test(css()), '装的时候带的是传入的列数');
    installNavStyle(3);
    ok(document.querySelectorAll('style#' + STYLE_ID).length === 1, '反复安装不会出现第二份样式表');

    markSidebarOpen(true);
    ok(document.body.classList.contains(BODY_OPEN_CLASS), '栏位打开 -> body 打标记（样式据此加宽栏位）');
    markSidebarOpen(false);
    ok(!document.body.classList.contains(BODY_OPEN_CLASS), '栏位关闭 -> 标记移除');
    document.getElementById(STYLE_ID).remove();

    console.log('\n[8] 条目在「插件启动」与「右侧栏组件」之间的桥');
    let seen = 0;
    let lastSeen = null;
    const unsubscribe = subscribeNavDocument((next) => {
        seen++;
        lastSeen = next;
    });
    setNavDocument(DATA);
    ok(seen === 1, '条目更新会通知订阅者（右侧栏据此重渲染）');
    ok(lastSeen === DATA && getNavDocument() === DATA, '订阅者拿到的是最新条目');
    unsubscribe();
    setNavDocument(null);
    ok(seen === 1, '退订后不再收到通知');
    ok(getNavDocument() === null, '条目可以被清空');

    console.log('\n[9] 频道头部按钮不再互相点亮（点导航，批量删除按钮不该跟着亮）');
    // 这条走得比源码远一步：`registerChannelHeaderButtonAction` 返回的是它内部 `generateId()`
    // 造的 id，但在真实页面上按 `<id>ChannelHeaderButton` 去查，**一个都查不到**（现场日志全是
    // missing: true）。也就是说此前几版写的 `#id` 规则从未命中过任何按钮。所以不再推导 id，
    // 改成按 aria-label 在 DOM 里把按钮找出来，再用它真实的 id 写规则。
    const QUIET_ID = 'customers-plugin-header-button-quiet';

    const navBtn = document.createElement('button');
    navBtn.id = 'e45d9cc5-ccf0-42f5-90ac-db93e37744a2ChannelHeaderButton';
    navBtn.className = 'channel-header__icon';
    navBtn.setAttribute('aria-label', '产品导航');
    document.body.appendChild(navBtn);

    const bulkBtn = document.createElement('button');
    bulkBtn.id = 'c3c27c3c-fa5e-463e-8ea0-57b5308c8dcaChannelHeaderButton';
    bulkBtn.className = 'channel-header__icon';
    bulkBtn.setAttribute('aria-label', '批量删除消息');
    document.body.appendChild(bulkBtn);

    const foreignBtn = document.createElement('button');
    foreignBtn.id = 'other-pluginChannelHeaderButton';
    foreignBtn.className = 'channel-header__icon';
    foreignBtn.setAttribute('aria-label', '别人的插件按钮');
    document.body.appendChild(foreignBtn);

    const mutedBtn = document.createElement('button');
    mutedBtn.id = 'mutedPostsChannelHeaderButton';
    mutedBtn.className = 'channel-header__icon';
    mutedBtn.setAttribute('aria-label', '静音');
    document.body.appendChild(mutedBtn);

    ok(discoverHeaderButtonDomIds().length === 2, '按 aria-label 只认出本插件的两个按钮');
    ok(discoverHeaderButtonDomIds().indexOf(navBtn.id) >= 0, '认出的是导航按钮的真实 DOM id');
    ok(discoverHeaderButtonDomIds().indexOf(bulkBtn.id) >= 0, '认出的是批量删除按钮的真实 DOM id');
    ok(discoverHeaderButtonDomIds().indexOf(foreignBtn.id) < 0, '别的插件的头部按钮不被卷进来');
    ok(discoverHeaderButtonDomIds().indexOf(mutedBtn.id) < 0, 'Mattermost 自己的头部图标也不被卷进来');

    // 但真实页面上这招一直没命中过：`HeaderIconWrapper` 渲染的是裸按钮，标签压根不在上面。
    // 现场读数里「我们的:0 个」正是这么来的——也就是说此前的静音规则一条都没落到按钮上，
    // 批量删除按钮还在照常画它自己的 hover。图标上自己埋的 data-cp-glyph 才是能靠的东西。
    const glyphHost = document.createElement('div');
    glyphHost.className = 'channel-header';
    const glyphNav = document.createElement('button');
    glyphNav.id = 'glyph-nav-id';
    glyphNav.innerHTML = '<svg data-cp-glyph="product-nav"></svg>';
    const glyphBulk = document.createElement('button');
    glyphBulk.id = 'glyph-bulk-id';
    glyphBulk.innerHTML = '<svg data-cp-glyph="bulk-delete"></svg>';
    const glyphStranger = document.createElement('button');
    glyphStranger.id = 'glyph-stranger-id';
    glyphStranger.innerHTML = '<img data-cp-glyph="somebody-elses"/>';
    const glyphPlain = document.createElement('button');
    glyphPlain.id = 'glyph-plain-id';
    glyphPlain.innerHTML = '<svg></svg>';
    [glyphNav, glyphBulk, glyphStranger, glyphPlain].forEach((el) => glyphHost.appendChild(el));
    document.body.appendChild(glyphHost);

    const byGlyph = discoverHeaderButtons([glyphNav, glyphBulk, glyphStranger, glyphPlain]);
    ok(byGlyph.length === 2, '按图标标记认按钮：带标记的两条算本插件的，异体标记与没标记的一条都不算');
    const glyphDerived = byGlyph.filter((head) => head.domId === 'glyph-nav-id' || head.domId === 'glyph-bulk-id');
    ok(glyphDerived.length === 2 && glyphDerived.every((head) => head.label === ''),
        '裸按钮上没有标签也照样认出来（这正是现场读数里卡住的地方）');
    ok(byGlyph.some((head) => head.domId === 'glyph-bulk-id' && head.kind === 'bulk'),
        '批量删除按钮按 bulk-delete 标记归到「全状态静音」那一档');
    ok(byGlyph.some((head) => head.domId === 'glyph-nav-id' && head.kind === 'nav'),
        '导航按钮按 product-nav 标记归到「只还原基础态」那一档');
    ok(byGlyph.every((head) => head.domId !== 'glyph-stranger-id' && head.domId !== 'glyph-plain-id'),
        '别的插件的标记和没标记的按钮都不认');

    const byLabel = discoverHeaderButtons([navBtn, bulkBtn, glyphStranger, glyphPlain]);
    ok(byLabel.length === 2 && byLabel.every((head) => head.domId.indexOf('glyph') < 0),
        '没有标记时退回按标签认（老版本那条路还在）');

    [glyphNav, glyphBulk, glyphStranger, glyphPlain].forEach((el) => el.remove());
    document.body.removeChild(glyphHost);

    syncHeaderButtonQuietStyle();
    const quietStyle = document.getElementById(QUIET_ID);
    ok(Boolean(quietStyle), '注入了头部按钮配色规则');
    const quietCss = quietStyle ? quietStyle.textContent : '';

    ok(quietCss.indexOf('#' + navBtn.id) >= 0, '规则用导航按钮的真实 id');
    ok(quietCss.indexOf('#' + bulkBtn.id) >= 0, '规则用批量删除按钮的真实 id');
    ok(quietCss.indexOf('#' + foreignBtn.id) < 0, '不会顺手压掉别的插件按钮的外观');
    ok(quietCss.indexOf('#' + mutedBtn.id) < 0, '不会顺手压掉 Mattermost 自己图标的外观');

    const blockOf = (id) => {
        const at = quietCss.indexOf('#' + id);
        return quietCss.slice(at, quietCss.indexOf('{', at));
    };
    const navRule = blockOf(navBtn.id);
    const bulkRule = blockOf(bulkBtn.id);
    ok(navRule.indexOf('#' + navBtn.id + ',') >= 0, '基础态排在第一位（不管什么状态都先还原成它）');
    ok(navRule.indexOf('--active') >= 0, '导航按钮：Mattermost 的 --active 修饰类压掉');
    ok(navRule.indexOf(':hover') < 0, '导航按钮保留它自己的 hover 高亮（截图反馈：只有它该亮）');
    ok(bulkRule.indexOf(':focus') >= 0 && bulkRule.indexOf(':focus-visible') >= 0, '删除按钮：焦点态与键盘焦点态一并覆盖');
    ok(bulkRule.indexOf(':hover') >= 0 && bulkRule.indexOf(':active') >= 0, '删除按钮：hover 与按下态一并覆盖');
    ok(bulkRule.indexOf('--active') >= 0, '删除按钮：--active 修饰类也覆盖');
    ok(quietCss.indexOf(':hover') > quietCss.indexOf('#' + bulkBtn.id),
        'hover 只出现在删除按钮那一段，不会顺手把导航按钮的 hover 也压掉');

    ok(/outline:none!important/.test(quietCss) && /box-shadow:none!important/.test(quietCss) &&
        /border:none!important/.test(quietCss), '描边、阴影、边框全压掉（这些就是「一圈蓝」的画法）');
    ok(/background:none!important/.test(quietCss) && /color:inherit!important/.test(quietCss),
        '背景整个清空（background 而非 background-color，背景图画的圆环也活不下来）、颜色回到继承值');
    ok(/content:none!important/.test(quietCss) && /::before,/.test(quietCss), '伪元素画的装饰也去掉');
    ok(new RegExp('#' + navBtn.id + ' \\*\\{outline:none!important').test(quietCss),
        '按钮内部的后代（svg 图标）同样不许画描边/阴影/滤镜');
    ok(!/:hover\{background-color:rgba\(/.test(quietCss), '不再有单独的 hover 规则（重排落到邻居上也不会亮）');

    // —— v0.6.30 定案的那一条：选择器列表以尾逗号结尾 = 整条规则被浏览器丢弃。
    // 导航段当初就是这样产出的，所以「导航按钮的基础态压制」从来没生效过；
    // 测试只做字符串包含断言，这个形状被完整掩盖了十几个版本。
    ok(quietCss.indexOf(',{') < 0 && quietCss.indexOf(', {') < 0,
        'CSS 里没有 ",{" 这种非法形状（尾逗号会让浏览器把整条规则丢掉）');
    ok(navRule[navRule.length - 1] !== ',' && bulkRule[bulkRule.length - 1] !== ',',
        '两段规则的选择器列表都不以逗号结尾');
    ok(navRule.indexOf(':focus-within') >= 0 && bulkRule.indexOf(':focus-within') >= 0,
        '焦点落进图标内部时按钮也不许亮（:focus-within）');

    const descOf = (id) => {
        const m = quietCss.match(new RegExp('#' + id + ' \\*\\{([^}]*)\\}'));
        return m ? m[1] : '';
    };
    ok(/color:inherit/.test(descOf(bulkBtn.id)) && /background:none/.test(descOf(bulkBtn.id)),
        '删除按钮连内部图标的颜色/背景一起压（图标用 currentColor：只压描边、图标照样变蓝）');
    ok(!/color:inherit/.test(descOf(navBtn.id)),
        '导航按钮不压内部颜色（它要保留自己的高亮配色）');
    ok(HEADER_BUTTON_LABELS.indexOf('勾选消息并批量删除') >= 0,
        '标签兜底认「勾选消息并批量删除」这个说法（注册处就用的它，之前只有「批量删除消息」，兜底恒失效）');

    // 按图标标记的兜底：id 是每次注册随机生成的，插件重载后按 id 写的规则全部落空。
    global.CSS = {supports: (q) => q.indexOf(':has') >= 0};
    installHeaderButtonQuietStyle([
        {domId: navBtn.id, quiet: false},
        {domId: bulkBtn.id, quiet: true},
    ]);
    const withHas = document.getElementById(QUIET_ID).textContent;
    ok(withHas.indexOf(':has([data-cp-glyph="bulk-delete"])') >= 0 &&
        withHas.indexOf(':has([data-cp-glyph="product-nav"])') >= 0,
        '另写一套按图标标记的兜底规则（与 id 无关：重载后 id 全换也照样生效）');
    const mixedRule = withHas.split('}').filter((r) => r.indexOf(':has(') >= 0 && r.indexOf('#' + navBtn.id) >= 0);
    ok(mixedRule.length === 0,
        '兜底规则独立成条，不与 id 选择器混在一个列表里（不支持的选择器会废掉同列表的整条规则）');
    ok(withHas.indexOf('#' + bulkBtn.id) >= 0, 'id 规则照旧保留，两套并存互不依赖');

    // —— v0.6.31：应用栏（app-bar）渲染。Mattermost 的 AppBarPluginComponent 按
    // **插件 id** 算激活态（component.pluginId === activeRhsComponent?.pluginId），
    // 两个按钮同属一个插件 → 点开导航两个包装 div 同时被加 --active（蓝圈）；
    // 且两个包装共用同一个 id（app-bar-icon-<pluginId>），按 id 区分根本不可能。
    ok(withHas.indexOf('.app-bar .app-bar__icon:has([data-cp-glyph="bulk-delete"])') >= 0,
        '应用栏渲染有一套自己的压制规则（按钮不在频道头部，channel-header 规则够不着）');
    ok(/app-bar__icon--active [^,{]*app-bar__icon-inner[^{]*\{box-shadow:none!important/.test(withHas),
        '应用栏的 --active 蓝圈（inner 上的 box-shadow）被压掉');
    ok(/app-bar__icon--active::before\{content:none!important/.test(withHas),
        '应用栏的激活小竖条（包装 div 的 ::before）也压掉');
    ok(/app-bar__old-icon\{color:rgba\(var\(--sidebar-text-rgb\),0\.64\)!important/.test(withHas),
        '删除按钮在应用栏的颜色被钉回静息值（图标用 currentColor，不钉颜色照样变蓝）');

    // 应用栏场景演练：两个包装共用一个 id，可点的是无 id 的 div[role=button]。
    const appBar = document.createElement('div');
    appBar.className = 'app-bar';
    const sharedId = 'app-bar-icon-com.example.customers-plugin';
    const makeAppBarButton = (glyph) => {
        const wrapper = document.createElement('div');
        wrapper.id = sharedId;
        wrapper.className = 'app-bar__icon';
        const inner = document.createElement('div');
        inner.setAttribute('role', 'button');
        inner.className = 'app-bar__old-icon app-bar__icon-inner';
        const icon = document.createElement('img');
        icon.setAttribute('data-cp-glyph', glyph);
        inner.appendChild(icon);
        wrapper.appendChild(inner);
        return wrapper;
    };
    appBar.appendChild(makeAppBarButton('product-nav'));
    appBar.appendChild(makeAppBarButton('bulk-delete'));
    document.body.appendChild(appBar);
    global.CSS = {supports: (q) => q.indexOf(':has') >= 0};
    syncHeaderButtonQuietStyle();
    const appBarCss = document.getElementById(QUIET_ID).textContent;
    ok(appBarCss.indexOf(`#${sharedId}`) < 0 && appBarCss.indexOf(`[id="${sharedId}"]`) < 0,
        '不会按应用栏的共享 id 写规则（写了会把两个按钮一起压掉，导航的高亮也没了）');
    ok(appBarCss.indexOf('.app-bar .app-bar__icon:has([data-cp-glyph="bulk-delete"])') >= 0,
        '应用栏里的按钮仍由图标标记规则接管（发现不到 id 也有规则在）');
    appBar.remove();
    delete global.CSS;

    global.CSS = {supports: () => false};
    installHeaderButtonQuietStyle([{domId: bulkBtn.id, quiet: true}]);
    ok(document.getElementById(QUIET_ID).textContent.indexOf(':has') < 0,
        '浏览器不支持 :has 时就不产出（不拿一整张表去赌）');
    delete global.CSS;

    installHeaderButtonQuietStyle([
        {domId: navBtn.id, quiet: false},
        {domId: bulkBtn.id, quiet: true},
    ]);
    ok(headerQuietStyleText() === document.getElementById(QUIET_ID).textContent,
        '样式表的实际文本能取出来（钉上了还亮时，一眼看出圈是哪个属性画的）');

    // jsdom 的 CSS 解析器太宽容（非法规则照样计数），但它的选择器引擎会拒绝尾逗号，
    // 和真实浏览器一个态度 —— 拿它当验收人，比字符串断言硬。
    const plain = document.getElementById(QUIET_ID).textContent;
    const parses = (list) => {
        try {
            document.querySelector(list);
            return true;
        } catch {
            return false;
        }
    };
    const lists = plain
        .split('}')
        .filter((r) => r.indexOf('{') > 0)
        .map((r) => r.slice(0, r.indexOf('{')));
    ok(lists.length >= 2 && lists.every(parses),
        '每条规则的选择器列表都真的能被解析（这条断言就是为尾逗号准备的：当年它会整条作废）');

    // 面板 CN：数字开头的 id 不能写成 #1abc...，要降级成属性选择器。
    const numericBtn = document.createElement('button');
    numericBtn.id = '9numericChannelHeaderButton';
    numericBtn.className = 'channel-header__icon';
    numericBtn.setAttribute('aria-label', '批量删除消息');
    document.body.appendChild(numericBtn);
    bulkBtn.remove();
    syncHeaderButtonQuietStyle();
    const numericCss = document.getElementById(QUIET_ID).textContent;
    ok(numericCss.indexOf('[id="9numericChannelHeaderButton"]') >= 0,
        '数字开头的 id 用属性选择器（#9... 不是合法选择器）');
    ok(numericCss.indexOf('#9numericChannelHeaderButton,') < 0, '不会产出非法的 # 选择器');
    numericBtn.remove();
    bulkBtn.setAttribute('aria-label', '批量删除消息');
    document.body.appendChild(bulkBtn);

    const before = document.getElementById(QUIET_ID).textContent;
    syncHeaderButtonQuietStyle();
    syncHeaderButtonQuietStyle();
    ok(document.querySelectorAll('#' + QUIET_ID).length === 1, '反复同步只留一张样式表');
    ok(document.getElementById(QUIET_ID).textContent === before, '反复同步产出同一份规则（幂等）');

    const focusRing = navBtn;
    focusRing.focus();
    ok(document.activeElement === focusRing, '前置条件：焦点在插件头部按钮上');
    blurHeaderButtonFocus();
    ok(document.activeElement !== focusRing, '点导航时焦点被摘掉，焦点环不再留在按钮上');

    const otherButton = document.createElement('button');
    otherButton.id = 'settings_button';
    document.body.appendChild(otherButton);

    otherButton.focus();
    blurHeaderButtonFocus();
    ok(document.activeElement === otherButton, '焦点不在插件按钮上时不动它（Mattermost 自己的按钮照旧）');

    // 真实页面上插件按钮长在 .channel-header 里，而诊断按「这个容器在不在」决定列头部
    // 还是列全页——列全页会一口气刷出上百项（现场日志就这么淹过一次）。
    const headerHost = document.createElement('div');
    headerHost.className = 'channel-header';
    [navBtn, bulkBtn, foreignBtn, mutedBtn].forEach((el) => headerHost.appendChild(el));
    document.body.appendChild(headerHost);

    console.log('\n[10] 头部按钮的一次性诊断（打印真实计算样式，用来收口的临时手段）');
    global.window.getComputedStyle = (el) => ({
        outlineStyle: 'none',
        outlineWidth: '',
        outlineColor: '',
        boxShadow: 'none',
        backgroundColor: 'rgba(0,0,0,0)',
        backgroundImage: 'none',
    });
    const infos = [];
    const realConsoleInfo = console.info;
    const DIAG_FLAG = 'customers-plugin:diag';
    console.info = (...args) => infos.push(args);

    // 诊断要能按需取，不能每次点按钮都在后台跑四轮 computed style。
    logHeaderButtonPaint('切换后立刻（没开都没问）');
    const silent = infos.length;
    exposeHeaderDiagnostic();
    const handle = typeof dom.window.customersPluginDiag === 'function' ? dom.window.customersPluginDiag : null;
    if (handle) {
        handle('手动取样');
    }
    dom.window.localStorage.setItem(DIAG_FLAG, '1');
    logHeaderButtonPaint('切换后立刻');
    await new Promise((resolve) => setTimeout(resolve, 320));
    console.info = realConsoleInfo;
    const flagWasOn = shouldLogHeaderDiag();
    dom.window.localStorage.removeItem(DIAG_FLAG);

    ok(silent === 0, '没开也没问的时候一行都不打：点击路径上不留诊断');
    ok(typeof handle === 'function', '诊断挂在控制台的 customersPluginDiag 上——想取哪一眼就敲哪一眼');
    ok(flagWasOn === true, '开了 flag 之后 shouldLogHeaderDiag 认账');
    // 结构行也带着取样时刻的名字，只数「头部按钮」那一行。
    ok(infos.filter((args) => /头部按钮 手动取样/.test(String(args[0]))).length === 2,
        '手敲一次出两行读数（立刻一眼 + 布局稳定一眼），不用开关、不用刷新');

    const flagLines = infos.filter((args) => /头部按钮 切换后立刻/.test(String(args[0])));
    ok(flagLines.length === 2, '开了 flag，取样点照旧一条日志一条（切换后立刻，以及布局稳定后）');
    ok(flagLines.length > 0 && !/头部按钮 切换后立刻 \+1000ms/.test(String(flagLines[flagLines.length - 1][0])),
        '一屏之内只有前两轮（+1000ms/+2000ms 留给后面，免得刷屏）');
    ok(/头部按钮 切换后立刻/.test(String(flagLines[0][0])), '第一次是切换后立刻取样');
    ok(/头部按钮 切换后立刻 \+300ms/.test(String(flagLines[1][0])), '第二次等频道头部重排稳定后再取样');
    ok(shouldLogHeaderDiag() === false, 'flag 摘掉之后又是安静的');
    ok(typeof flagLines[0][1] === 'undefined',
        '打的是一行字符串而不是对象：对象在控制台会折叠，抄出来只剩「Object」，现场日志白跑');
    const line = String(flagLines[1][0]);
    if (process.env.DIAG_LINE) {
        console.log('DIAG>>' + line);
    }

    ok(/侧栏:/.test(line) && /我们的:2 个/.test(line) && /已发现/.test(line),
        '一次抄写就读全：侧栏在不在场、找到几个本插件按钮、已钉住了哪些真实 id');
    ok(line.indexOf(navBtn.id) >= 0 && line.indexOf(bulkBtn.id) >= 0,
        '两个按钮的真实 DOM id 都印在这一行里（不再靠推导拼）');
    ok(!new RegExp(foreignBtn.id).test(line), '别的插件的按钮不混进这一行');
    const rows = line.split(/(?=<)/).filter((part) => part.charAt(0) === '<');
    ok(rows.length === 2, '认得全本插件的两个按钮时就只列它们（发现式，不按 class 猜）');
    ok(rows.every((row) => row.indexOf('#' + bulkBtn.id) >= 0 || row.indexOf('#' + navBtn.id) >= 0),
        '列出的两段正是这两个按钮');
    ok(rows.every((row) => /已钉/.test(row)), '本插件的按钮都标成已钉住（规则确实写进了样式表）');
    ok(rows.every((row) => /hover[YNyn]/.test(row) && /焦点[YNyn]/.test(row)),
        '标出鼠标在不在它上面、此刻有没有焦点——能直接分辨是真高亮还是重排后的误悬停');
    ok(rows.every((row) => row.indexOf('hovernull') < 0),
        '悬停状态问不出来时写 ?，不让 null 混进读数');
    ok(rows.every((row) => /\|框/.test(row) && /\|影/.test(row) && /\|/.test(row)),
        '焦点环与阴影的真实值都在行里（一眼看出还有没有在画圈）');
    ok(rows.every((row) => /\d+,\d+ \d+x\d+/.test(row)),
        '每段带屏幕位置：按钮是被摘掉、还是被重排挪到了鼠标底下');

    navBtn.remove();
    bulkBtn.remove();
    foreignBtn.remove();
    mutedBtn.remove();
    otherButton.remove();
    headerHost.remove();
    document.getElementById(QUIET_ID).remove();

    console.log('\n[10.5] 启动基线：一条、等头部挂上、不刷屏');
    {
        noteHeaderRegistration('productNav', true, '3 条可用');
        noteHeaderRegistration('bulkDelete', true, '开关已开');

        const headerHost = document.createElement('div');
        headerHost.className = 'channel-header';
        [navBtn, bulkBtn, foreignBtn, mutedBtn].forEach((el) => headerHost.appendChild(el));
        document.body.appendChild(headerHost);

        const closed = [];
        console.info = (...args) => closed.push(args);
        logHeaderStartupBaseline();
        await new Promise((resolve) => setTimeout(resolve, 2200));
        console.info = realConsoleInfo;

        // 只数基线那一条：上一次取样的定时器还会在这段时间里落下来，混着算没意义。
        const baseline = closed.filter((args) => /头部按钮 启动时（面板未开）/.test(String(args[0])));
        const baselineLine = baseline.length > 0 ? String(baseline[0][0]) : '';

        if (process.env.DIAG_LINE) {
            console.log('DIAG>>baseline=' + baseline.length + '\n' + baseline.join('\n'));
        }

        ok(baseline.length === 1, '启动时只打一条：四轮全打的那版把控制台淹过一次');
        ok(/注册:导航Y\(3 条可用\)/.test(baselineLine) && /删除Y\(开关已开\)/.test(baselineLine),
            '这一行带上「按钮到底注册了没」——DOM 里找不到按钮时，一眼分清是没注册还是没渲染');
        ok(/头部可点共 2 个/.test(baselineLine), '头部挂上了就只列头部那几个（此刻是找到的两个本插件按钮）');

        headerHost.remove();

        // 注册决定还没出来时不许打：打早了那一格只会是「?」，正好是这条读数存在的理由。
        // 这一轮要等满，把它自己的定时器放干净，下一轮的数量才算得准。
        console.info = (...args) => closed.push(args);
        noteHeaderRegistration('productNav', null, '还没读完配置');
        noteHeaderRegistration('bulkDelete', null, '还没读完配置');
        const beforeUndecided = closed.length;
        logHeaderStartupBaseline();
        await new Promise((resolve) => setTimeout(resolve, 2200));
        console.info = realConsoleInfo;
        ok(closed.slice(beforeUndecided).filter((args) => /头部按钮 启动时/.test(String(args[0]))).length === 0,
            '注册决定还没出来时一条都不打（否则那一格只会印个 ?）');

        noteHeaderRegistration('productNav', false, '没有可用条目');
        noteHeaderRegistration('bulkDelete', false, '开关未开');

        console.info = (...args) => closed.push(args);
        const beforeUnmounted = closed.length;
        logHeaderStartupBaseline();
        await new Promise((resolve) => setTimeout(resolve, 2200));
        console.info = realConsoleInfo;

        const only = closed.slice(beforeUnmounted).filter((args) => /头部按钮 启动时（面板未开）/.test(String(args[0])));
        ok(only.length === 1, '决定出来了、头部仍没挂上，也只打一条');
        const lateLine = only.length > 0 ? String(only[0][0]) : '';
        ok(/头部未挂载/.test(lateLine), '没挂上就直说没挂上');
        ok(!/<[A-Z]+#/.test(lateLine), '没挂上时不列全页清单（那一版一刷就是 97 项）');
        ok(/注册:导航N\(没有可用条目\)/.test(lateLine), '没注册的原因也印出来');
    }

    console.log('\n[10.6] 补钉认不出按钮时，插件自己说一句（不用在控制台敲命令）');
    {
        // 现场反馈里， COND 那条命令敲出去只回了个函数定义——让用户在控制台打字本身
        // 就是会失败的一步。所以真出事的那一次由插件自己打：头部已经挂上、却一个
        // 都没认出来，这一条是唯一会记下它的读数。
        const stranger = document.createElement('button');
        stranger.className = 'channel-header__icon';
        stranger.setAttribute('aria-label', '频道文件');
        stranger.setAttribute('data-cp-glyph', 'somebody-elses');
        const headerHost = document.createElement('div');
        headerHost.className = 'channel-header';
        headerHost.appendChild(stranger);

        // 现场读数里最要紧的那一格：按钮已经渲染进头部了，可它是个空壳 —— 没有
        // id、没有标签、图标里也没有标记（读数里就是那个 `无 id 无标签 0,0 0x0`）。
        // 认法对这种按钮无能为力，所以只能靠「开过侧栏之后还没认上」这一句说破它。
        const rendered = document.createElement('button');
        rendered.className = 'channel-header__icon';
        headerHost.appendChild(rendered);
        document.body.appendChild(headerHost);

        const closed = [];

        // 侧栏还没开过：Mattermost 这一轮根本没把按钮放进头部，那是常态不是故障。
        // 现场那两条一模一样的「补钉没认出来」就属于这种 —— 启动时按钮不在 DOM。
        console.info = (...args) => closed.push(args);
        syncHeaderButtonQuietStyle();
        syncHeaderButtonQuietStyle();
        console.info = realConsoleInfo;
        ok(closed.length === 0, '侧栏还没开过时一句话都不说（按钮本来就没进场，说了就是噪音）');

        // 开过侧栏 = 点过导航 = 频道头部重渲染、按钮第一次进场的那一刻。这一轮还
        // 认不出，才是故障，才值得占一行。
        document.body.classList.add('customers-plugin-nav-rhs-open');
        console.info = (...args) => closed.push(args);
        syncHeaderButtonQuietStyle();
        syncHeaderButtonQuietStyle();
        console.info = realConsoleInfo;

        if (process.env.DIAG_LINE) {
            console.log('DIAG>>closed=' + JSON.stringify(closed.map((a) => String(a[0]).slice(0, 200))));
        }

        const missed = closed.filter((args) => /头部按钮 补钉没认出来/.test(String(args[0])));
        const missedLine = missed.length > 0 ? String(missed[0][0]) : '';

        ok(missed.length === 1, '同一轮里认不出来只说一句（backoff 五连不会刷五遍）');
        ok(/我们的:0 个/.test(missedLine), '这一句说清是「一个都没认出来」');
        ok(/头部可点共 2 个/.test(missedLine), '头部挂上了就列头部那几个（别人的标记不算本插件的）');
        ok(/BUTTON/.test(missedLine) && /未钉/.test(missedLine),
            '读数里列着那个在场的按钮、且标着「未钉」：一眼看出是认不上标记，还是按钮根本不在 DOM');
        const stranded = closed.filter((args) => /头部长这样/.test(String(args[0])));
        ok(stranded.length === 1 && /<button/.test(String(stranded[0][0])),
            '把头部本身的 HTML 印出来（现场那个 0x0 无名按钮，光看列表是查不出是谁的）');

        stranger.remove();
        // 头部得挂回文档里再认：`headerRoot()` 走的是 `document.querySelector`，
        // 摘出文档的容器连自己都找不到，范围会退回整个页面。
        document.body.appendChild(headerHost);

        // 认回来了就复位：下次真出事还得说。
        const glyph = document.createElement('span');
        glyph.setAttribute('data-cp-glyph', 'product-nav');
        glyph.setAttribute('aria-label', '产品导航');
        navBtn.appendChild(glyph);
        headerHost.appendChild(navBtn);
        console.info = (...args) => closed.push(args);
        syncHeaderButtonQuietStyle();
        console.info = realConsoleInfo;
        ok(discoverHeaderButtonDomIds().indexOf(navBtn.id) >= 0, '前置条件：带上标记之后认得回来');
        syncHeaderButtonQuietStyle();
        ok(closed.filter((args) => /头部按钮 补钉没认出来/.test(String(args[0]))).length === 1,
            '认回来之后不再补报（这条读数不是每步都打）');
        navBtn.remove();
        headerHost.remove();

        // 侧栏已经开过、头部里却一个本插件按钮都没有：按钮没进场，不是认不出来。
        // 这两种情况只有那一行读数分得开，所以头上的标记得跟着摘掉再比。
        document.body.classList.remove('customers-plugin-nav-rhs-open');
        const emptyHeader = document.createElement('div');
        emptyHeader.className = 'channel-header';
        document.body.appendChild(emptyHeader);
        console.info = (...args) => closed.push(args);
        syncHeaderButtonQuietStyle();
        console.info = realConsoleInfo;
        ok(closed.filter((args) => /头部按钮 补钉没认出来/.test(String(args[0]))).length === 1,
            '按钮压根没进场时保持安静（那不是认不出来）');
        emptyHeader.remove();
    }

    console.log('\n[10.7] 按钮晚一步进场时，盯着头部等它（backoff 已经跑完那会儿）');
    {
        // 现场读数显示：注册早就成了（注册:导航Y/删除Y），按钮却在启动时压根不在
        // DOM —— 只有等频道头部下一次重渲染（点开导航就是其中之一）它才出现。backoff
        // 那时已经跑完，固定时刻的补钉会整个错过按钮存在的那一段。
        const host = document.createElement('div');
        host.className = 'channel-header';
        document.body.appendChild(host);

        const late = [];
        console.info = (...args) => late.push(args);
        syncHeaderButtonQuietStyle();

        // 上一节那个观察器还挂着、等着它自己的容器消失；把待跑的回调放干净，
        // 免得它抢在本节之前把观察目标改到别处。
        await new Promise((resolve) => setTimeout(resolve, 250));

        const arriving = document.createElement('button');
        arriving.id = 'late-nav-btn';
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('data-cp-glyph', 'product-nav');
        arriving.appendChild(icon);
        host.appendChild(arriving);

        // 观察器是「等一拍再搜」的（一次重渲染是一串突变，不能每个都搜一遍），
        // 所以这里要等过那一拍。
        await new Promise((resolve) => setTimeout(resolve, 250));
        console.info = realConsoleInfo;

        if (process.env.DIAG_LATE) {
            console.log('DIAG>>alate=' + JSON.stringify(late.map((a) => String(a[0]).slice(0, 200))));
            console.log('DIAG>>sheets=' + document.querySelectorAll('.channel-header').length +
                ' html=' + document.body.innerHTML.slice(0, 300));
        }

        ok(discoverHeaderButtonDomIds().indexOf('late-nav-btn') >= 0,
            '按钮晚到一步也认得上（不用再猜它什么时候进 DOM）');
        const sheet = document.getElementById(QUIET_ID);
        ok(Boolean(sheet) && sheet.textContent.indexOf('#late-nav-btn') >= 0,
            '认上就钉进样式表，鼠标落在上面画的也是静音过的那套');
        ok(late.filter((args) => /头部按钮/.test(String(args[0]))).length === 0,
            '等待期间一句话都不说（还在等，不是没认出来）');

        host.remove();
    }

    console.log('\n[11] index.tsx 的注册写法（踩过坑的两处）');
    const indexSource = fs.readFileSync(path.join(WEBAPP, 'src', 'index.tsx'), 'utf8');

    const sidebarCall = indexSource.match(/registerRightHandSidebarComponent\(([^;]*?)\);/);
    ok(Boolean(sidebarCall), 'index.tsx 注册了右侧栏组件');
    const sidebarArg = sidebarCall ? sidebarCall[1].trim() : '';
    ok(sidebarArg.startsWith('withBoundary(ProductNavSidebar)'), '第一个参数是组件引用（withBoundary(ProductNavSidebar)）');
    ok(!/<ProductNavSidebar\s*\/>/.test(sidebarArg), '没有写成 <ProductNavSidebar/>：Mattermost 会再 createElement 一次，元素当类型用会报 React #130');

    // 插件里抛出的异常不能把宿主的整棵 React 树带下去——那正是「整页白屏」。
    const rootRegistrations = indexSource.match(/registerRootComponent\([^)]*\)/g) || [];
    ok(rootRegistrations.length >= 4 && rootRegistrations.every((call) => /withBoundary\(/.test(call)),
        '每个 registerRootComponent 都包了错误边界（我们抛错不会让整页白屏）');
    ok(/installCrashReporter\(\);/.test(indexSource) &&
        indexSource.indexOf('installCrashReporter();') < indexSource.indexOf('installPostStreamFilter({'),
        '崩溃上报装在启动最前面（手机没控制台可读，错误得落到页面上）');

    // 导航栏位按钮必须在批量删除按钮之前注册：`ChannelHeaderPlug` 按注册顺序渲染，
    // 超过 15 个插件按钮才会收成下拉。
    const navButtonAt = indexSource.indexOf('registerChannelHeaderButtonAction');
    const bulkButtonAt = indexSource.indexOf('registerChannelHeaderButtonAction', navButtonAt + 1);
    ok(navButtonAt >= 0 && bulkButtonAt > navButtonAt, '注册了两个频道头部按钮');
    ok(indexSource.indexOf('ProductNavIcon') >= 0 && indexSource.indexOf('ProductNavIcon') < navButtonAt + 400,
        '导航按钮用的是我们自己的图标组件');
    ok(indexSource.indexOf('toggleRHSPlugin') > 0, '按钮点了派发的是 toggleRHSPlugin（开合交给 Mattermost）');

    // 导航和「勾选消息」是插件的两种模式：开着勾选去开侧栏，侧栏开着、批量删除按钮
    // 却还亮着，消息行上还挂着勾。开侧栏时主动退出勾选。
    const navBlock = indexSource.slice(navButtonAt, bulkButtonAt);
    ok(/setBulkSelectActive\(false\)/.test(navBlock), '点导航时先退出批量删除选择模式，批量删除按钮不会留在点亮状态');
    ok(/blurHeaderButtonFocus\(\)/.test(navBlock), '点导航时把焦点从频道头部按钮上摘掉（否则焦点环会漂到批量删除按钮上）');
    ok(navBlock.indexOf('logHeaderButtonPaint') < 0,
        '点导航的回调里不留诊断打印：诊断按需取，点击路径只做这件事该做的事');
    ok(/\(\)\s*=>\s*setBulkSelectActive\(true\)/.test(indexSource),
        '批量删除按钮的回调是「一行、一件事」——导航按钮照这个形状写');
    ok(/logHeaderStartupBaseline\(\);/.test(indexSource),
        '启动时仍自动取一条「面板未开」的基线读数，这是插件自己会打的唯一一条（不再四连刷）');
    ok(/noteHeaderRegistration\('productNav'/.test(indexSource) &&
        /noteHeaderRegistration\('bulkDelete'/.test(indexSource),
        '两个头部按钮的注册决定都记下来了（DOM 里找不到时，这一格能分清是没注册还是没渲染）');
    ok(/exposeHeaderDiagnostic\(\);/.test(indexSource), '诊断句柄挂到控制台（customersPluginDiag）');
    const navSource = fs.readFileSync(path.join(WEBAPP, 'src', 'product_nav.ts'), 'utf8');

    // 外观锁定靠的是「在 DOM 里找到按钮」，而不是「拿注册返回的 id 推出来」——后者推出来的
    // id 在真实页面上根本不存在（现场日志全是 missing: true，等于规则全空转）。
    // lastIndexOf：文件顶部同样有这些名字（import），那里当然在注册之前。
    const quietInstallAt = indexSource.lastIndexOf('syncHeaderButtonQuietStyle()');
    ok(quietInstallAt > bulkButtonAt, '外观锁定装在两次注册之后');
    ok(!/installHeaderButtonQuietStyle\(headerButtonIds\)/.test(indexSource),
        '不再把注册返回值当真实 DOM id 用（那个推断已被现场日志否证）');
    ok(/discoverHeaderButtons/.test(navSource), '改成在 DOM 里回查按钮（先按图标标记，再按标签兜底）');
    ok(/data-cp-glyph/.test(fs.readFileSync(path.join(WEBAPP, 'src', 'components', 'icons.tsx'), 'utf8')) &&
        /data-cp-glyph/.test(fs.readFileSync(path.join(WEBAPP, 'src', 'components', 'product_nav_icon.tsx'), 'utf8')),
        '两个图标都带上 data-cp-glyph：裸按钮没有 aria-label 也能认出是哪个');
    ok(indexSource.indexOf('headerButtonIds') < 0, 'index.tsx 不再收集注册返回值');

    ok(navSource.indexOf('RightControlsContainer') < 0, '不再往全局头部注入按钮（已改到频道头部）');
    ok(navSource.indexOf('insertBefore') < 0, '不再往 React 渲染的头部里插节点（插进去会被下一次重渲染吃掉）');
    ok(navSource.indexOf('observe(root, {childList: true, subtree: true})') >= 0,
        '只观察头部节点的进出：按钮晚到时补钉一次，一个 DOM 节点都不改写');

    console.log('\n[12] 崩溃取证：手机浏览器没有控制台，错误得自己出现在页面上');
    {
        const crash = require(path.join(OUT, 'crash_report.js'));

        crash.uninstallCrashReporter();
        crash.resetCrashRecords();

        crash.installCrashReporter();
        crash.installCrashReporter(); // 装两遍也只记一条

        // v0.6.33：横幅默认关（它盖在每个页面顶部、对所有人都可见），这里打开它才谈得上取证。
        crash.recordCrash(new Error('quiet-boom'), 'test');
        ok(!document.getElementById('customers-plugin-crash-banner'),
            '默认不画横幅（关掉之后，页面上不再出现这条提示）');
        ok(crash.getCrashRecords().length === 1, '不画横幅也照样记录（存档还在，事后能查）');

        crash.setCrashBannerEnabled(true);
        ok(Boolean(document.getElementById('customers-plugin-crash-banner')),
            '管理员打开开关后，之前记录的那条也会补画出来（启动早期那几毫秒的错才是解释白屏的）');
        crash.resetCrashRecords();
        crash.uninstallCrashReporter();
        crash.installCrashReporter();
        crash.setCrashBannerEnabled(true);

        crash.recordCrash(new Error('boom'), 'test');

        const records = crash.getCrashRecords();
        ok(records.length === 1, '记下一条（重复安装不会重复记录）');
        ok(records.length > 0 && records[0].message === 'boom', 'message 留下来了');
        ok(records.length > 0 && /boom/.test(records[0].stack), 'stack 也留下来了');

        const banner = document.getElementById('customers-plugin-crash-banner');
        ok(Boolean(banner), '错误直接画到页面上（React 树崩了也还看得见）');
        ok(Boolean(banner) && /boom/.test(banner.textContent || ''), '横幅里带着错误正文，截图就能反馈');

        for (let i = 0; i < 10; i++) {
            crash.recordCrash(new Error('more-' + i), 'test');
        }
        ok(crash.getCrashRecords().length === 5, '最多留 5 条（第一屏那几条才是解释白屏的）');

        // —— v0.6.32：横幅只该为「我们自己的错」响。宿主（Mattermost）自己崩了，
        // 我们只是听见了（这个上报器监听整个 window），不能把锅扣在插件头上。
        crash.uninstallCrashReporter();
        crash.resetCrashRecords();
        crash.installCrashReporter();

        const hostError = new Error("Cannot read properties of undefined (reading 'collapsed')");
        hostError.stack = 'TypeError: ' + hostError.message + '\n' +
            '    at byId (https://host/static/6240.9e07f8088ac707cb90ef.js:1:121138)\n' +
            '    at Array.reduce (<anonymous>)';
        crash.recordCrash(hostError, 'rejection');

        const hostRecords = crash.getCrashRecords();
        ok(hostRecords.length === 1 && hostRecords[0].origin === 'host',
            '堆栈里没有我们自己的帧 → 记为宿主来源（我们只是听见了，不是我们抛的）');
        ok(!document.getElementById('customers-plugin-crash-banner'),
            '宿主自身的已知崩溃不画横幅（横幅为无关的事响过一次，就没人再信它）');

        const ownError = new Error('own-boom');
        ownError.stack = 'Error: own-boom\n' +
            '    at x (https://host/plugins/com.example.customers-plugin/public/main.js:2:99)';
        crash.recordCrash(ownError, 'test');
        ok(crash.getCrashRecords()[1].origin === 'plugin', '带插件路径的堆栈记为插件来源');

        const ownBanner = document.getElementById('customers-plugin-crash-banner');
        ok(Boolean(ownBanner) && /own-boom/.test(ownBanner.textContent || ''), '自己的错照旧画横幅');
        ok(Boolean(ownBanner) && /·宿主/.test(ownBanner.textContent || ''),
            '横幅里标出哪一条是宿主的（读的人一眼分清谁该负责）');

        // 只有宿主报错时，标题不许说成本插件的错。
        crash.uninstallCrashReporter();
        crash.resetCrashRecords();
        crash.installCrashReporter();
        const hostOther = new Error('The object can not be found here. removeChild');
        hostOther.stack = 'NotFoundError: ' + hostOther.message + '\n' +
            '    at removeChild (https://host/static/7954.2944798b99fd6a77c5c0.js:2:367975)';
        crash.recordCrash(hostOther, 'error');
        const titleEl = document.querySelector('#customers-plugin-crash-banner div');
        ok(Boolean(titleEl) && /Mattermost 自身报错/.test(titleEl.textContent || ''),
            '全是宿主报错时，标题写明是宿主自己的错（不扣给插件）');

        // 开关本身：管理员关 → 当场收走；localStorage 覆盖 → 不换配置、不重装，自己一台机器就能取证。
        crash.setCrashBannerEnabled(false);
        ok(!document.getElementById('customers-plugin-crash-banner'), '管理员关掉开关，横幅当场收走');
        crash.recordCrash(new Error('after-off'), 'test');
        ok(crash.getCrashRecords().length > 0, '关掉后仍然记录（只是不画）');

        window.localStorage.setItem('customers-plugin:crash-banner', 'on');
        ok(crash.isCrashBannerEnabled(), 'localStorage 覆盖成 on：临时取证不必惊动配置');
        crash.recordCrash(new Error('override-on'), 'test');
        ok(Boolean(document.getElementById('customers-plugin-crash-banner')), '覆盖打开后照旧画横幅');
        window.localStorage.removeItem('customers-plugin:crash-banner');
        ok(!crash.isCrashBannerEnabled(), '清掉覆盖后回到管理员设置（关）');

        crash.uninstallCrashReporter();
        crash.resetCrashRecords();
        ok(!document.getElementById('customers-plugin-crash-banner'), '卸载后横幅收走，不留残骸');
    }

    console.log('\n========================================');
    console.log('  PASS ' + pass + ' / FAIL ' + fail);
    console.log('========================================');
    process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
