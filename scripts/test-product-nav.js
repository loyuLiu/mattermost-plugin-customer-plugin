/*
 * 用 jsdom 实测「产品导航」引擎。
 *
 * 引擎只依赖 DOM（#RightControlsContainer、注入的按钮、下拉面板）和传入的数据，
 * 不依赖布局，jsdom 足够覆盖：注入/幂等/图标/面板内容/危险链接过滤/开关与关闭/
 * 头部重建后复活/停止后清理。
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
    ProductNavEngine,
    normalizeLinksPerRow,
    panelWidthPx,
    collectNavProblems,
    countUsableNavLinks,
    isBlankNavLink,
    normalizeNavDocument,
    safeNavUrl,
} = require(path.join(OUT, 'product_nav.js'));

/* ---------- 2. 10.12 同构 DOM ---------- */
const dom = new JSDOM(`<!doctype html><html><body>
<div id="global-header">
  <div id="RightControlsContainer">
    <button id="at_mentions_button"></button>
    <button id="saved_posts_button"></button>
    <button id="settings_button"></button>
  </div>
</div>
</body></html>`, {pretendToBeVisual: true, url: 'http://localhost/'});

global.window = dom.window;
global.document = dom.window.document;
global.MutationObserver = dom.window.MutationObserver.bind(dom.window);

const document = dom.window.document;

const BUTTON_ID = 'customers-plugin-product-nav-button';
const PANEL_ID = 'customers-plugin-product-nav-panel';
const LINK = '.customers-plugin-nav-link';
const CATEGORY = '.customers-plugin-nav-category';

const DATA = {
    categories: [
        {
            id: 'cat-1',
            name: '内部系统',
            links: [
                {id: 'l1', name: '工单系统', url: 'https://example.com/ticket', iconUrl: 'https://example.com/t.png'},
                {id: 'l2', name: '知识库', url: 'https://example.com/wiki', iconUrl: ''},
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

function button() {
    return document.getElementById(BUTTON_ID);
}
function panel() {
    return document.getElementById(PANEL_ID);
}
function container() {
    return document.getElementById('RightControlsContainer');
}
function click(el) {
    el.dispatchEvent(new dom.window.MouseEvent('click', {bubbles: true, cancelable: true}));
}
function pressEscape() {
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
}
function css() {
    const style = document.getElementById('customers-plugin-product-nav-style');
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
        categories: [{id: 'c', name: '内部', links: [{id: 'l', name: '工单', url: 'https://e.com'}]}],
    });
    ok(filled[0].links[0].iconUrl === '', '缺 iconUrl 补空串（不会读到 undefined）');
    ok(filled[0].links[0].url === 'https://e.com', '正常数据原样保留');

    console.log('\n[2] 无数据时不注入按钮');
    const engine = new ProductNavEngine();
    engine.start();
    ok(engine.sync() === false, '没有条目时 sync 返回 false');
    ok(!button(), '没有条目时页面上没有按钮');

    console.log('\n[3] 有数据后注入按钮');
    engine.setData(DATA);
    ok(engine.sync() === true, '有条目时 sync 返回 true');
    ok(!!button(), '按钮已注入');
    ok(button().parentElement === container(), '按钮挂在 #RightControlsContainer 下');
    ok(container().firstChild === button(), '按钮插在最前面（右上角）');
    ok(button().getAttribute('aria-haspopup') === 'true', '声明了 aria-haspopup');
    ok(button().getAttribute('aria-expanded') === 'false', '初始 aria-expanded=false');
    ok(button().title === '产品导航', '按钮提示为「产品导航」');

    console.log('\n[4] 幂等');
    engine.sync();
    engine.sync();
    ok(document.querySelectorAll('#' + BUTTON_ID).length === 1, '页面上只有一个按钮');

    console.log('\n[5] 默认图标与自定义图标');
    ok(!!button().querySelector('svg'), '默认使用内联 SVG 图标');
    engine.setIconUrl('https://example.com/nav.png');
    const withIcon = button();
    ok(!!withIcon && !!withIcon.querySelector('img'), '自定义图标渲染为 img');
    ok(withIcon.querySelector('img').getAttribute('src') === 'https://example.com/nav.png', 'img 的 src 正确');
    engine.setIconUrl('javascript:alert(1)');
    ok(!!button().querySelector('svg'), '非法图标地址回退为内置图标');
    engine.setIconUrl('');

    console.log('\n[6] 样式表');
    const style = document.getElementById('customers-plugin-product-nav-style');
    ok(!!style, '注入了样式表');
    ok(!!style && style.textContent.indexOf('cursor:pointer') >= 0, '按钮可点击');
    ok(!!style && style.textContent.indexOf('position:fixed') >= 0, '面板固定定位');

    console.log('\n[7] 打开面板');
    engine.open();
    ok(engine.isOpen(), '面板已打开');
    ok(!!panel(), '面板在页面上');
    ok(button().getAttribute('aria-expanded') === 'true', 'aria-expanded=true');
    ok(panel().querySelectorAll(CATEGORY).length === 2, '渲染了 2 个分类');
    ok(panel().textContent.indexOf('内部系统') >= 0, '分类名渲染出来了');
    ok(panel().querySelectorAll(LINK).length === 3, '渲染了 3 个链接（恶意链接被过滤）');

    const links = panel().querySelectorAll(LINK);
    ok(links[0].getAttribute('href') === 'https://example.com/ticket', '链接地址正确');
    ok(links[0].getAttribute('target') === '_blank', '新窗口打开');
    ok(links[0].getAttribute('rel') === 'noopener noreferrer', '带 noopener noreferrer');
    ok(!!links[0].querySelector('img'), '有 logo 的链接渲染 img');
    ok(!links[1].querySelector('img'), '没有 logo 的链接不渲染 img');
    ok(links[1].querySelector('.customers-plugin-nav-logo').textContent === '知', '无 logo 时显示名称首字');

    console.log('\n[8] 点击按钮关闭 / 再点击打开');
    click(button());
    ok(!engine.isOpen() && !panel(), '再次点击关闭面板');
    click(button());
    ok(engine.isOpen() && !!panel(), '第三次点击重新打开');

    console.log('\n[9] Esc 关闭');
    pressEscape();
    ok(!engine.isOpen() && !panel(), 'Esc 关闭面板');

    console.log('\n[10] 点击面板外关闭');
    engine.open();
    click(document.getElementById('global-header'));
    ok(!engine.isOpen() && !panel(), '点击页面其他地方关闭面板');

    console.log('\n[11] 点击面板内部不关闭');
    engine.open();
    click(panel());
    ok(engine.isOpen(), '点击面板本身不关闭');

    console.log('\n[12] 点击链接后关闭');
    click(panel().querySelector(LINK));
    ok(!engine.isOpen() && !panel(), '点击链接后关闭面板');

    console.log('\n[13] 打开状态下更新数据会重建面板');
    engine.open();
    engine.setData({
        categories: [{id: 'cat-9', name: '新分类', links: [{id: 'x', name: '只有一条', url: 'https://example.com/one'}]}],
    });
    ok(engine.isOpen(), '更新后仍保持打开');
    ok(panel().querySelectorAll(CATEGORY).length === 1, '分类数已更新');
    ok(panel().querySelectorAll(LINK).length === 1, '链接数已更新');
    ok(panel().textContent.indexOf('新分类') >= 0, '内容已更新');

    console.log('\n[14] 清空数据后按钮消失');
    engine.setData({categories: []});
    ok(!button(), '没有条目时按钮被移除');
    ok(!panel(), '面板也被移除');

    console.log('\n[15] 头部重建后按钮复活');
    engine.setData(DATA);
    ok(!!button(), '重新注入按钮');
    const oldButton = button();
    oldButton.remove();
    ok(!button(), '头部被 React 重建后按钮消失');
    engine.sync();
    ok(!!button() && button() !== oldButton, 'sync 后重新注入新按钮');
    ok(container().firstChild === button(), '仍然插在最前面');

    console.log('\n[16] 停止后彻底清理');
    engine.setData(DATA);
    engine.open();
    engine.stop();
    ok(!button(), '按钮已移除');
    ok(!panel(), '面板已移除');
    ok(!document.getElementById('customers-plugin-product-nav-style'), '样式表已移除');
    ok(!document.getElementById(BUTTON_ID), '页面上不再有旧按钮');
    ok(engine.sync() === false, '停止后 sync 不再注入');
    click(document.getElementById('global-header'));
    ok(!panel(), '停止后点击不再打开面板');

    console.log('\n[17] 每行 5 个链接');

    // [16] 把引擎停掉了（样式表随之移除），这里重新起一个。
    const rowEngine = new ProductNavEngine();
    rowEngine.start();

    ok(DEFAULT_PRODUCT_NAV_LINKS_PER_ROW === 5, '默认每行 5 个链接');
    ok(new RegExp('repeat\\(' + DEFAULT_PRODUCT_NAV_LINKS_PER_ROW + ',minmax\\(0,1fr\\)\\)').test(css()),
        '链接容器是 ' + DEFAULT_PRODUCT_NAV_LINKS_PER_ROW + ' 列网格（不是靠 flex-wrap 碰运气）');
    ok(css().indexOf('display:grid') >= 0, '链接容器用 grid 布局');

    // 面板宽度必须装得下 5 个瓦片 + 4 个间距 + 左右内边距，否则第 5 个会换行。
    const panelRule = (new RegExp('#' + PANEL_ID + '\\{([^}]*)\\}').exec(css()) || [])[1] || '';
    const widthPx = Number((/width:(\d+)px/.exec(panelRule) || [])[1]);
    const needed = 5 * 56 + 4 * 6 + 2 * 14;
    ok(widthPx >= needed, '面板宽度 ' + widthPx + 'px 装得下 5 个瓦片（至少 ' + needed + 'px）');

    // 瓦片自己不能再有固定宽度，否则列宽由它决定、网格失效。
    const linkRule = (/\.customers-plugin-nav-link\{([^}]*)\}/.exec(css()) || [])[1] || '';
    ok(linkRule.indexOf('width:100%') >= 0 && linkRule.indexOf('width:88px') < 0,
        '瓦片宽度交给网格（width:100%，不再是写死的 88px）');

    // 5 列时名字会窄到一行显示不下，所以必须限高两行。
    ok(css().indexOf('-webkit-line-clamp:2') >= 0, '名称最多两行（5 列瓦片太窄，单行会被截没）');

    rowEngine.setData({
        categories: [{id: 'cat-row', name: '一排', links: [1, 2, 3, 4, 5, 6].map((n) => ({
            id: 'l' + n,
            name: '系统' + n,
            url: 'https://example.com/' + n,
        }))}],
    });
    rowEngine.open();
    ok(panel().querySelectorAll(LINK).length === 6, '6 条链接全部渲染（第 6 条换到第二行）');
    ok(panel().querySelectorAll('.customers-plugin-nav-links').length === 1, '一个分类只有一个链接容器');
    rowEngine.close();
    rowEngine.stop();

    console.log('\n[18] 每行个数可配置（插件设置）');
    ok(normalizeLinksPerRow(4) === 4, '填 4 就是 4');
    ok(normalizeLinksPerRow(1) === MIN_PRODUCT_NAV_LINKS_PER_ROW, '最少 1');
    ok(normalizeLinksPerRow(12) === MAX_PRODUCT_NAV_LINKS_PER_ROW, '最多 12');
    ok(normalizeLinksPerRow(0) === DEFAULT_PRODUCT_NAV_LINKS_PER_ROW, '填 0 / 留空 -> 回默认 5');
    ok(normalizeLinksPerRow(undefined) === DEFAULT_PRODUCT_NAV_LINKS_PER_ROW, '服务端没下发 -> 回默认 5');
    ok(normalizeLinksPerRow('6') === 6, '字符串数字也能用（控制台里可能存成字符串）');
    ok(normalizeLinksPerRow('abc') === DEFAULT_PRODUCT_NAV_LINKS_PER_ROW, '非数字 -> 回默认');
    ok(normalizeLinksPerRow(99) === DEFAULT_PRODUCT_NAV_LINKS_PER_ROW, '超上限不夹到 12，直接回默认（填错要看得出来）');
    ok(normalizeLinksPerRow(-3) === DEFAULT_PRODUCT_NAV_LINKS_PER_ROW, '负数同样回默认');

    ok(panelWidthPx(1) === 2 * 14 + 56, '1 列：宽度 = 内边距 + 一个瓦片');
    ok(panelWidthPx(6) === 2 * 14 + 6 * 56 + 5 * 6, '6 列：宽度随列数增长');
    ok(panelWidthPx(6) > panelWidthPx(5), '列数越多面板越宽（不会让第 6 个换行）');
    ok(panelWidthPx(0) === panelWidthPx(DEFAULT_PRODUCT_NAV_LINKS_PER_ROW), '非法列数用默认宽度');

    // 运行时改列数：样式表就地重写，面板不用重启、打开着也能立刻变宽。
    rowEngine.start();
    rowEngine.setData(DATA);
    rowEngine.setLinksPerRow(6);
    ok(rowEngine.getLinksPerRow() === 6, 'setLinksPerRow 生效');
    ok(new RegExp('repeat\\(6,minmax\\(0,1fr\\)\\)').test(css()), '样式表立刻改成 6 列');
    ok(Number((/width:(\d+)px/.exec((new RegExp('#' + PANEL_ID + '\\{([^}]*)\\}').exec(css()) || [])[1] || '') || [])[1]) === panelWidthPx(6),
        '面板宽度同步变成 ' + panelWidthPx(6) + 'px');

    rowEngine.open();
    const widthBefore = panel().querySelectorAll(LINK).length;
    rowEngine.setLinksPerRow(3);
    ok(panel().querySelectorAll(LINK).length === widthBefore, '打开状态下改列数，链接不会丢（面板被重建）');
    ok(rowEngine.isOpen(), '改列数后面板仍然开着');
    rowEngine.close();

    // 换个引擎单独验证构造参数。
    rowEngine.stop();
    const rowEngine2 = new ProductNavEngine({linksPerRow: 8});
    rowEngine2.start();
    ok(rowEngine2.getLinksPerRow() === 8, '构造参数直接生效');
    ok(new RegExp('repeat\\(8,minmax\\(0,1fr\\)\\)').test(css()), '8 列的样式已写入');
    rowEngine2.stop();

    console.log('\n[19] 容器缺失时不报错');
    const engine2 = new ProductNavEngine();
    container().remove();
    engine2.start();
    engine2.setData(DATA);
    ok(engine2.sync() === false, '容器不存在时 sync 返回 false');
    ok(!button(), '容器不存在时不注入按钮');
    engine2.stop();

    console.log('\n========================================');
    console.log('  PASS ' + pass + ' / FAIL ' + fail);
    console.log('========================================');
    process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
