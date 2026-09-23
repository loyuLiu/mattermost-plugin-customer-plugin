/*
 * 用 jsdom 实测「会话内勾选批量删除」引擎。
 *
 * 引擎只依赖 DOM（消息行 id、注入的复选框、选中高亮）和一个 onChange 回调，
 * 不依赖布局，jsdom 足够覆盖：注入/幂等/勾选与取消/全选/清空/停止后清理。
 *
 * 运行（需先在 webapp 目录 npm install 过）：
 *   NODE_PATH="C:/Users/cheny/.workbuddy/binaries/node/workspace/node_modules" \
 *     node scripts/test-bulk-select.js
 */
'use strict';

const {execFileSync} = require('child_process');
const fs = require('fs');
const path = require('path');
const {JSDOM} = require('jsdom');

const WEBAPP = path.resolve(__dirname, '..', 'webapp');
const OUT = path.join(WEBAPP, '.tmp-test-bulk');

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 1. 编译 TS ---------- */
fs.rmSync(OUT, {recursive: true, force: true});
const tsc = path.join(WEBAPP, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(process.execPath, [
    tsc,
    'src/bulk_select.ts',
    '--outDir', '.tmp-test-bulk',
    '--module', 'commonjs',
    '--target', 'es2019',
    '--lib', 'dom,es2019',
    '--moduleResolution', 'node',
    '--skipLibCheck',
    '--esModuleInterop',
], {cwd: WEBAPP, stdio: 'inherit'});

const {BulkSelectEngine, getBulkSelectState, setBulkSelectActive, setBulkSelection} = require(path.join(OUT, 'bulk_select.js'));

/* ---------- 2. 10.12 同构 DOM ---------- */
const dom = new JSDOM(`<!doctype html><html><body>
<div id="virtualizedPostListContent">
  <div id="post_a" class="post other--root"></div>
  <div id="post_b" class="post same--root"></div>
  <div id="post_c" class="post other--root"></div>
</div>
<div id="rhsContainer">
  <div id="rhsPost_d" class="post"></div>
</div>
<div id="searchContainer">
  <div id="searchResult_e" class="post"></div>
</div>
</body></html>`, {pretendToBeVisual: true, url: 'http://localhost/'});

global.window = dom.window;
global.document = dom.window.document;
global.MutationObserver = dom.window.MutationObserver.bind(dom.window);
global.Event = dom.window.Event;

const document = dom.window.document;

const BOX = '.customers-plugin-bulk-select-box';
function row(id) {
    return document.getElementById(id);
}
function box(id) {
    return row(id).querySelector(BOX);
}

let latest = [];
const engine = new BulkSelectEngine((selected) => {
    latest = selected;
});

// 勾选：jsdom 不会自动派发 change，手动构造一次真实事件
function tick(id, checked) {
    const input = box(id);
    input.checked = checked;
    input.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
}

(async () => {
    console.log('\n[1] 启动后给中心频道消息行注入复选框');
    engine.start();
    const rows = engine.sync();
    ok(rows === 3, '中心频道 3 行被处理（实际 ' + rows + '）');
    ok(!!box('post_a') && !!box('post_b') && !!box('post_c'), '三行都注入了复选框');
    ok(box('post_a').type === 'checkbox', '注入的是复选框');
    ok(box('post_a').dataset.postId === 'a', '复选框记住了消息 id');
    ok(!document.getElementById('rhsPost_d').querySelector(BOX), '右侧栏不注入（只处理会话内消息）');
    ok(!document.getElementById('searchResult_e').querySelector(BOX), '搜索结果不注入');
    ok(row('post_a').style.position === 'relative', '消息行被设为定位上下文');

    console.log('\n[2] 幂等：重复 sync 不重复注入');
    engine.sync();
    engine.sync();
    ok(row('post_a').querySelectorAll(BOX).length === 1, '同一行只有一个复选框');

    console.log('\n[3] 样式表');
    const style = document.getElementById('customers-plugin-bulk-select-style');
    ok(!!style, '注入了样式表');
    ok(!!style && style.textContent.indexOf('position:absolute') >= 0, '复选框绝对定位');
    ok(!!style && style.textContent.indexOf('cursor:pointer') >= 0, '可点击');

    console.log('\n[4] 勾选与取消');
    tick('post_a', true);
    ok(latest.length === 1 && latest[0] === 'a', '勾一条后回调收到 1 条（实际 ' + JSON.stringify(latest) + '）');
    ok(row('post_a').style.outline !== '', '选中的行被高亮描边');

    tick('post_b', true);
    ok(latest.length === 2, '再勾一条 -> 2 条');
    tick('post_a', false);
    ok(latest.length === 1 && latest[0] === 'b', '取消一条 -> 只剩 b');
    ok(row('post_a').style.outline === '', '取消后描边被移除');

    console.log('\n[5] 全选当前页与清空');
    engine.selectAll();
    ok(latest.length === 3, '全选 -> 3 条（实际 ' + latest.length + '）');
    ok(box('post_a').checked && box('post_c').checked, '全选后复选框都是勾上的');

    engine.clearSelection();
    ok(latest.length === 0, '清空 -> 0 条');
    ok(!box('post_a').checked, '清空后复选框取消勾选');
    ok(row('post_a').style.outline === '', '清空后描边被移除');

    console.log('\n[6] 新插入的消息行自动补上复选框');
    const fresh = document.createElement('div');
    fresh.id = 'post_new';
    fresh.className = 'post other--root';
    document.getElementById('virtualizedPostListContent').appendChild(fresh);
    await sleep(400);
    ok(!!box('post_new'), '新行自动注入复选框（无需手动 sync）');

    console.log('\n[7] 重新进入时恢复已选状态');
    tick('post_new', true);
    ok(latest.length === 1, '勾选新插入的行');
    engine.sync();
    ok(box('post_new').checked === true, '重扫不会丢失勾选状态');

    console.log('\n[8] 停止后彻底清理');
    engine.stop();
    ok(document.querySelectorAll(BOX).length === 0, '所有复选框已移除');
    ok(!document.getElementById('customers-plugin-bulk-select-style'), '样式表已移除');
    ok(row('post_a').style.outline === '', '描边已移除');
    ok(engine.sync() === 0, '停止后 sync 不再注入');

    console.log('\n[9] 共享状态（频道头按钮与工具条之间）');
    setBulkSelectActive(true);
    ok(getBulkSelectState().active === true, '开启选择模式');
    setBulkSelection(['x', 'y']);
    ok(getBulkSelectState().selected.length === 2, '记录已选 2 条');
    setBulkSelectActive(false);
    ok(getBulkSelectState().active === false && getBulkSelectState().selected.length === 0, '退出模式会清空选择');

    fs.rmSync(OUT, {recursive: true, force: true});

    console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
    process.exit(fail === 0 ? 0 : 1);
})();
