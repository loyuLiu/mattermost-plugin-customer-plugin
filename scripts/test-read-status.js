/*
 * 用 jsdom 实测「私信已讀/未讀标记」引擎。
 *
 * 引擎只依赖 DOM 结构（消息行 id、注入的徽标节点）和 provider 返回的
 * create_at / userId / last_viewed_at / peerLastViewedAt / channelType，不依赖布局，
 * jsdom 足够覆盖：
 *   收到的消息按「我」的已讀位置判定 / 发出的消息按「对方」的已讀位置判定 /
 *   未讀打黄标·已讀打绿标 / 频道消息不标记 / 状态切换时更新 /
 *   拿不到已讀位置不标记 / 停止后清理。
 *
 * 运行（需先在 webapp 目录 npm install 过）：
 *   NODE_PATH="C:/Users/cheny/.workbuddy/binaries/node/workspace/node_modules" \
 *     node scripts/test-read-status.js
 */
'use strict';

const {execFileSync} = require('child_process');
const fs = require('fs');
const path = require('path');
const {JSDOM} = require('jsdom');

const WEBAPP = path.resolve(__dirname, '..', 'webapp');
const OUT = path.join(WEBAPP, '.tmp-test-read');

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
    'src/read_status.ts',
    '--outDir', '.tmp-test-read',
    '--module', 'commonjs',
    '--target', 'es2019',
    '--lib', 'dom,es2019',
    '--moduleResolution', 'node',
    '--skipLibCheck',
    '--esModuleInterop',
], {cwd: WEBAPP, stdio: 'inherit'});

const {ReadStatusEngine} = require(path.join(OUT, 'read_status.js'));

/* ---------- 2. 10.12 同构 DOM ---------- */
const dom = new JSDOM(`<!doctype html><html><body>
<div id="virtualizedPostListContent">
  <div id="post_peer_read" class="post other--root"></div>
  <div id="post_peer_unread" class="post same--root"></div>
  <div id="post_gm_unread" class="post other--root"></div>
  <div id="post_own_read" class="post other--root"></div>
  <div id="post_own_unread" class="post same--root"></div>
  <div id="post_own_pending" class="post other--root"></div>
  <div id="post_chan_read" class="post other--root"></div>
  <div id="post_chan_unread" class="post other--root"></div>
  <div id="post_unknown" class="post other--root"></div>
  <div id="post_nomember" class="post other--root"></div>
</div>
<div id="rhsContainer">
  <div id="rhsPost_peer_unread" class="post post--thread"></div>
</div>
<div id="searchContainer">
  <div id="searchResult_peer_read" class="post"></div>
</div>
</body></html>`, {pretendToBeVisual: true, url: 'http://localhost/'});

global.window = dom.window;
global.document = dom.window.document;
global.MutationObserver = dom.window.MutationObserver.bind(dom.window);
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const document = dom.window.document;

const ME = 'me';
const PEER = 'peer';

const MY_VIEWED = Date.UTC(2026, 8, 22, 10, 0); // 我最后一次看这个会话
const PEER_VIEWED = Date.UTC(2026, 8, 22, 10, 2); // 对方最后一次看这个会话

const POSTS = {
    // 对方发来的消息：按「我」的已讀位置判定
    peer_read: {createAt: Date.UTC(2026, 8, 22, 9, 0), channelId: 'dm1', userId: PEER},
    peer_unread: {createAt: Date.UTC(2026, 8, 22, 10, 1), channelId: 'dm1', userId: PEER},
    gm_unread: {createAt: Date.UTC(2026, 8, 22, 11, 0), channelId: 'gm1', userId: PEER},

    // 我发出的消息：按「对方」的已讀位置判定
    own_read: {createAt: Date.UTC(2026, 8, 22, 9, 30), channelId: 'dm1', userId: ME},
    own_unread: {createAt: Date.UTC(2026, 8, 22, 10, 5), channelId: 'dm1', userId: ME},

    // 我发出的消息，但对方的已讀位置还没拿到
    own_pending: {createAt: Date.UTC(2026, 8, 22, 14, 0), channelId: 'dm2', userId: ME},

    // 公开/私有频道，即使未讀也不标记
    chan_read: {createAt: Date.UTC(2026, 8, 22, 9, 30), channelId: 'ch1', userId: PEER},
    chan_unread: {createAt: Date.UTC(2026, 8, 22, 11, 30), channelId: 'ch1', userId: PEER},

    // 我在该会话没有成员记录
    nomember: {createAt: Date.UTC(2026, 8, 22, 14, 0), channelId: 'dm2', userId: PEER},

    rhs_peer_unread: {createAt: Date.UTC(2026, 8, 22, 12, 0), channelId: 'dm1', userId: PEER},
    search_peer_read: {createAt: Date.UTC(2026, 8, 22, 8, 0), channelId: 'dm1', userId: PEER},
};

const CHANNEL_TYPES = {dm1: 'D', gm1: 'G', ch1: 'O', dm2: 'D'};

let myViewedAt = MY_VIEWED;
let peerViewedAt = PEER_VIEWED;
const requested = [];

const engine = new ReadStatusEngine({
    getPostMeta: (postId) => POSTS[postId],
    getCurrentUserId: () => ME,
    getLastViewedAt: (channelId) => (channelId === 'dm2' ? undefined : myViewedAt),
    getPeerLastViewedAt: (channelId) => (channelId === 'dm1' ? peerViewedAt : undefined),
    requestPeerLastViewedAt: (channelId) => requested.push(channelId),
    getChannelType: (channelId) => CHANNEL_TYPES[channelId],
});

const BADGE = '.customers-plugin-read-badge';
function badge(id) {
    return document.getElementById(id).querySelector(BADGE);
}
function row(id) {
    return document.getElementById(id);
}
function state(id) {
    return badge(id) ? badge(id).dataset.readState : null;
}

(async () => {
    console.log('\n[1] 私信按已讀状态打标，频道不打标');
    engine.start();
    const marked = engine.sync();
    ok(marked === 7, '私信 7 条被标记（实际 ' + marked + '）');
    ok(state('post_peer_unread') === 'unread', '对方发来、我还没读 -> unread');
    ok(state('post_peer_read') === 'read', '对方发来、我已讀 -> read');
    ok(state('post_gm_unread') === 'unread', '群私信未讀 -> unread');
    ok(!badge('post_chan_read'), '频道已讀消息不打标');
    ok(!badge('post_chan_unread'), '频道未讀消息也不打标');
    ok(!badge('post_unknown'), 'redux 里查不到的消息不打标');
    ok(!badge('post_nomember'), '我在该会话没有成员记录时不打标');
    ok(state('rhsPost_peer_unread') === 'unread', '右侧栏里的私信也会打标');
    ok(state('searchResult_peer_read') === 'read', '搜索结果里的私信也会打标');

    console.log('\n[2] 我发出的消息按「对方」的已讀位置判定');
    ok(state('post_own_unread') === 'unread', '我发的、对方还没读到 -> unread');
    ok(state('post_own_read') === 'read', '我发的、对方已讀到 -> read');

    console.log('\n[3] 推进我的已讀位置，只影响对方发来的消息');
    myViewedAt = Date.UTC(2026, 8, 22, 10, 30);
    engine.sync();
    ok(state('post_peer_unread') === 'read', '对方发来的消息翻成已讀');
    ok(state('post_own_unread') === 'unread', '我发出的消息不受我自己的已讀位置影响');

    console.log('\n[4] 推进对方的已讀位置，我发出的消息翻绿');
    peerViewedAt = Date.UTC(2026, 8, 22, 10, 30);
    engine.sync();
    ok(state('post_own_unread') === 'read', '对方读过之后翻成已讀');
    ok(badge('post_own_unread').textContent === '已讀', '文字同步变成「已讀」');
    ok(badge('post_own_unread').classList.contains('is-read'), '修饰类同步变成 is-read');

    console.log('\n[5] 对方的已讀位置回退后翻黄（状态可双向切换）');
    peerViewedAt = PEER_VIEWED;
    myViewedAt = MY_VIEWED;
    engine.sync();
    ok(state('post_own_unread') === 'unread', '回到未讀');
    ok(state('post_peer_unread') === 'unread', '对方发来的消息同样回到未讀');

    console.log('\n[6] 拿不到对方已讀位置时：先不打标，并去要一次');
    ok(!badge('post_own_pending'), '对方已讀位置未知时不打标');
    ok(requested.indexOf('dm2') >= 0, '向 provider 请求了 dm2 的对方已讀位置');
    ok(requested.indexOf('dm1') < 0, '已有缓存的会话不重复请求');

    console.log('\n[7] 未讀=黄圈+未讀，已讀=绿圈+已讀');
    const unread = badge('post_peer_unread');
    const read = badge('post_peer_read');
    ok(unread.classList.contains('is-unread') && read.classList.contains('is-read'), '两类徽标带不同修饰类');
    ok(unread.textContent === '未讀', '未讀徽标文字是「未讀」（实际 ' + unread.textContent + '）');
    ok(read.textContent === '已讀', '已讀徽标文字是「已讀」（实际 ' + read.textContent + '）');
    ok(!!unread.querySelector('.customers-plugin-read-dot'), '未讀徽标内含小圆点');
    ok(!!read.querySelector('.customers-plugin-read-dot'), '已讀徽标内含小圆点');

    const style = document.getElementById('customers-plugin-read-status-style');
    ok(!!style, '注入了样式表');
    ok(!!style && style.textContent.indexOf('position:absolute') >= 0, '徽标绝对定位');
    ok(!!style && style.textContent.indexOf('top:4px;right:8px') >= 0, '定位在右上角');
    ok(!!style && style.textContent.indexOf('pointer-events:none') >= 0, '徽标不拦截鼠标事件');
    ok(!!style && style.textContent.indexOf('--away-indicator') >= 0, '未讀用 away 主题色（黄）');
    ok(!!style && style.textContent.indexOf('--online-indicator') >= 0, '已讀用 online 主题色（绿）');
    ok(row('post_peer_unread').style.position === 'relative', '消息行被设为定位上下文');
    ok(unread.getAttribute('aria-hidden') === 'true', '对读屏软件隐藏');

    console.log('\n[8] 幂等：重复 sync 不会重复插入');
    engine.sync();
    engine.sync();
    ok(row('post_peer_unread').querySelectorAll(BADGE).length === 1, '同一行只有一个徽标');

    console.log('\n[9] MutationObserver 自动重扫');
    const fresh = document.createElement('div');
    fresh.id = 'post_own_new';
    fresh.className = 'post other--root';
    document.getElementById('virtualizedPostListContent').appendChild(fresh);
    POSTS.own_new = {createAt: Date.UTC(2026, 8, 22, 15, 0), channelId: 'dm1', userId: ME};
    await sleep(400);
    ok(state('post_own_new') === 'unread', '新插入的私信行自动打标（无需手动 sync）');

    console.log('\n[10] 停止后彻底清理');
    engine.stop();
    ok(document.querySelectorAll(BADGE).length === 0, '所有徽标已移除');
    ok(!document.getElementById('customers-plugin-read-status-style'), '样式表已移除');
    ok(engine.sync() === 0 && document.querySelectorAll(BADGE).length === 0, '停止后 sync 不再打标');

    fs.rmSync(OUT, {recursive: true, force: true});

    console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
    process.exit(fail === 0 ? 0 : 1);
})();
