/*
 * 用 jsdom 实测「新成员历史消息隔离」的门（HistoryGate）。
 *
 * DOM 刻意照抄 10.12 的虚拟化列表结构（`.innerList` 里一排 `.item_measurer`，
 * post 行在 wrapper 内部），因为**隐藏到底打在哪个元素上决定了功能的成败**：
 * 虚拟列表测量的是 wrapper 的高度，只藏里面的 post 会留下一堆空 gap ——
 * 那就是用户看到的「频道一片空白、要滚一滚才正常」。
 *
 *   行 -> .item_measurer -> <div id="post_xxx">
 *
 * 另外两件以前出过事的事也在这里守着：
 *   1. 隐藏必须在**绘制之前**落地，否则会先看到加入前的消息再被抹掉；
 *   2. 边界没取回来时行要「留白」（保留高度），既不泄露也不让滚动条跳。
 *
 * 运行（需先在 webapp 目录 npm install 过）：
 *   NODE_PATH="C:/Users/cheny/.workbuddy/binaries/node/workspace/node_modules" \
 *     node scripts/test-history-gate.js
 */
'use strict';

const {execFileSync} = require('child_process');
const fs = require('fs');
const path = require('path');
const {JSDOM} = require('jsdom');

const WEBAPP = path.resolve(__dirname, '..', 'webapp');
const OUT = path.join(WEBAPP, '.tmp-test-history');

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
    'src/history_gate.ts',
    '--outDir', '.tmp-test-history',
    '--module', 'commonjs',
    '--target', 'es2019',
    '--lib', 'dom,es2019',
    '--moduleResolution', 'node',
    '--skipLibCheck',
    '--esModuleInterop',
], {cwd: WEBAPP, stdio: 'inherit'});

const {HistoryGate, planViewportRecovery} = require(path.join(OUT, 'history_gate.js'));

/* ---------- 2. 10.12 同构 DOM ---------- */
const dom = new JSDOM(`<!doctype html><html><head></head><body>
<div id="channel-header"></div>
<div id="virtualizedPostListContent">
  <div class="innerList">
    <div class="item_measurer"><div id="channelIntro"></div></div>
    <div class="item_measurer"><div class="Separator BasicSeparator"></div></div>
    <div class="item_measurer"><div id="post_old" class="post"></div></div>
    <div class="item_measurer"><div id="post_new" class="post"></div></div>
    <div class="item_measurer"><div id="post_marker" class="post"></div></div>
    <div class="item_measurer"><div class="Separator BasicSeparator"></div></div>
    <div class="item_measurer"><div id="post_pending_old" class="post"></div></div>
    <div class="item_measurer"><div id="post_pending_new" class="post"></div></div>
    <div class="item_measurer"><div id="post_open_old" class="post"></div></div>
    <div class="item_measurer"><div id="post_unknown_meta" class="post"></div></div>
    <div class="item_measurer"><div id="post_user-activity-sysold" class="post"></div></div>
    <div class="item_measurer"><div id="post_user-activity-sysnew" class="post"></div></div>
    <div class="item_measurer"><div id="post_user-activity-sysold2_sysold3" class="post"></div></div>
    <div class="item_measurer"><div id="post_user-activity-sysold4_sysnew2" class="post"></div></div>
    <div class="item_measurer"><div id="post_user-activity-sysnew3_sysnew4" class="post"></div></div>
    <div class="item_measurer"><div id="post_user-activity-sysunknown1_sysunknown2" class="post"></div></div>
  </div>
</div>
<div id="rhsContainer">
  <div id="rhsPost_old" class="post"></div>
</div>
<div id="searchContainer">
  <div id="searchResult_old" class="post"></div>
</div>
</body></html>`, {pretendToBeVisual: true, url: 'http://localhost/'});

global.window = dom.window;
global.document = dom.window.document;
global.MutationObserver = dom.window.MutationObserver.bind(dom.window);

const document = dom.window.document;
const STYLE_ID = 'customers-plugin-history-gate-style';
const NOTICE_ID = 'customers-plugin-history-notice';
const ROW_SELECTOR = '[id^="post_"],[id^="rhsPost_"],[id^="searchResult_"]';

/* ---------- 3. provider ---------- */
// ch-restricted: cutoff 500（早于 500 的消息要藏）
// ch-open:       cutoff 0（不受限）
// ch-pending:    没取回来（undefined）
const POSTS = {
    old: {createAt: 100, channelId: 'ch-restricted'},
    new: {createAt: 900, channelId: 'ch-restricted'},
    pending_old: {createAt: 100, channelId: 'ch-pending'},
    pending_new: {createAt: 900, channelId: 'ch-pending'},
    open_old: {createAt: 100, channelId: 'ch-open'},

    // 系统消息（"X 加入了频道"）。Mattermost 会把连续的系统消息合并成一行，
    // 行 id 变成 user-activity-<id>[_<id>...]，这个 id 在 redux 里并不存在。
    sysold: {createAt: 100, channelId: 'ch-restricted'},
    sysnew: {createAt: 900, channelId: 'ch-restricted'},
    sysold2: {createAt: 100, channelId: 'ch-restricted'},
    sysold3: {createAt: 200, channelId: 'ch-restricted'},
    sysold4: {createAt: 100, channelId: 'ch-restricted'},
    sysnew2: {createAt: 900, channelId: 'ch-restricted'},
    sysnew3: {createAt: 800, channelId: 'ch-restricted'},
    sysnew4: {createAt: 900, channelId: 'ch-restricted'},

    // 「你被加入频道」系统消息：create_at 在加入瞬间，可能比记录的 cutoff
    // 还早 1ms，但它是成员被允许看到的加入后第一行。
    marker: {createAt: 100, channelId: 'ch-restricted', forceVisible: true},
};

let metaCalls = 0;
const requested = [];

/**
 * cutoffs 是活的对象：测试可以在 gate 运行期间把它改掉，模拟"边界回来了"。
 */
function makeProvider(cutoffs, currentChannelId) {
    return {
        getPostMeta(postId) {
            metaCalls++;
            return POSTS[postId];
        },
        getCutoff(channelId) {
            return cutoffs[channelId];
        },
        requestCutoff(channelId) {
            requested.push(channelId);
        },
        getCurrentChannelId: currentChannelId === undefined ? undefined : () => currentChannelId,
    };
}

function defaultCutoffs() {
    return {
        'ch-restricted': 500,
        'ch-open': 0,
    };
}

/** 当前活跃 gate 写的样式（总是取最后一个，避免读到已停止实例的残留）。 */
function rules() {
    const all = document.querySelectorAll('#' + STYLE_ID);
    const el = all[all.length - 1];
    return el ? el.textContent : '';
}

/** 某条 post 所在的「被测量的行容器」。没有 wrapper 时就是自身。 */
function hostOf(postId) {
    const row = document.getElementById(postId);
    return row.closest('.item_measurer') || row;
}

const HIDDEN = 'data-customers-history-hidden';
const PENDING = 'data-customers-history-pending';

const hiddenHosts = () => Array.from(document.querySelectorAll('[' + HIDDEN + ']'));
const blankHosts = () => Array.from(document.querySelectorAll('[' + PENDING + ']'));

const isHidden = (postId) => hostOf(postId).hasAttribute(HIDDEN);
const isBlanked = (postId) => hostOf(postId).hasAttribute(PENDING);

/** 隐藏标记是不是打在「整行」上，而不是内部的 post div 上。 */
const collapsedWholeRow = (postId) => hostOf(postId) !== document.getElementById(postId);

/** 起一个 gate，跑完断言后一定 stop，保证实例之间互不干扰。 */
async function withGate(options, fn) {
    const cutoffs = options.cutoffs || defaultCutoffs();
    const gate = new HistoryGate({
        provider: makeProvider(cutoffs, options.currentChannelId),
        noticeEnabled: Boolean(options.noticeEnabled),
        noticeText: options.noticeText || '更早的消息已隐藏',
        hideInSearch: options.hideInSearch !== false,
        pendingPolicy: options.pendingPolicy,
    });

    gate.start();
    try {
        await fn(gate, cutoffs);
    } finally {
        gate.stop();
    }
}

/** 让 MutationObserver 的回调跑完（它在 microtask 里）。 */
async function mutationsFlushed() {
    await sleep(0);
}

(async () => {
    console.log('\n[1] 已知边界：早于 cutoff 的「整行」被移除');
    await withGate({}, (gate) => {
        ok(gate.sync() === 6, 'sync 返回被隐藏的行数（3 条普通旧消息 + 3 行旧系统消息）');
        ok(isHidden('post_old'), 'post_old 被标记隐藏');
        ok(collapsedWholeRow('post_old'), '标记打在被测量的行容器上，不是内部的 post div（否则会留下空 gap）');
        ok(!document.getElementById('post_old').hasAttribute(HIDDEN), 'post div 自身不重复标记');
        ok(isHidden('rhsPost_old'), '右侧栏的同一条也被隐藏');
        ok(!collapsedWholeRow('rhsPost_old'), '没有 wrapper 时退化到行本身');
        ok(isHidden('searchResult_old'), '搜索结果的同一条也被隐藏');
        // 刻意不是 display:none —— 没有盒子的元素 ResizeObserver 不会上报，
        // 塌陷后的 0 就永远进不了 itemSizeMap，占位 div 会一直按旧高度撑着。
        ok(rules().includes('[' + HIDDEN + ']{') && /height:0 !important/.test(rules()),
            '隐藏规则强制 0 高（保留盒子，让共享 ResizeObserver 能上报 0）');
        ok(/visibility:hidden !important/.test(rules()), '隐藏行同时不可见、不可聚焦');
        ok(!/display:none/.test(rules()), '隐藏不用 display:none（会让 ResizeObserver 失效）');
        ok(!isHidden('post_new'), '晚于 cutoff 的行不受影响');
        ok(!isHidden('post_open_old'), 'cutoff 为 0 的频道完全不限制');
        ok(!isHidden('post_unknown_meta'), 'redux 里查不到的消息不动（不猜）');
        ok(hiddenHosts().length === 6, '一共只有 6 行被标记');
    });

    console.log('\n[1.1] 系统消息：合并后的「用户活动」行');
    // Mattermost 把连续的系统消息合并成一行，行 id 变成
    //   post_user-activity-<id1>_<id2>...
    // 这个 id 在 redux 里并不存在（行是选择器临时合成的），
    // 所以必须拆回真实 id 才能判定——否则「X 加入了频道」整条漏网。
    await withGate({}, () => {
        ok(isHidden('post_user-activity-sysold'), '单条系统消息也带 user-activity- 前缀，仍要隐藏');
        ok(!isHidden('post_user-activity-sysnew'), '加入之后的系统消息照常显示');
        ok(isHidden('post_user-activity-sysold2_sysold3'), '两条合并的系统消息都在加入前 -> 隐藏');
        ok(isHidden('post_user-activity-sysold4_sysnew2'), '跨边界的合并行 -> 隐藏（宁可少显示，不能泄露历史）');
        ok(!isHidden('post_user-activity-sysnew3_sysnew4'), '合并行全在加入后 -> 显示');
        ok(!isHidden('post_user-activity-sysunknown1_sysunknown2'), '底层消息查不到时不动（不猜）');
        ok(collapsedWholeRow('post_user-activity-sysold'), '系统消息的隐藏标记同样打在被测量的整行上');
    });

    console.log('\n[2] 边界未取回：留白而不是照常显示');
    requested.length = 0;
    await withGate({}, () => {
        ok(isBlanked('post_pending_old'), 'pending 行用 visibility:hidden（看不见内容，高度还在）');
        ok(isBlanked('post_pending_new'), 'pending 频道的新消息也先留白（还没判过，不能赌）');
        ok(collapsedWholeRow('post_pending_old'), '留白也打在整行上');
        ok(!isHidden('post_pending_old'), '留白不用 display:none，否则列表高度会先塌再弹');
        ok(rules().includes('[' + PENDING + ']{visibility:hidden !important;}'), '样式表给出的是 visibility:hidden');
        ok(requested.includes('ch-pending'), '顺手去取缺失的边界');
    });

    console.log('\n[3] 边界到达后从留白切换到真正的判定');
    await withGate({}, (gate, cutoffs) => {
        ok(isBlanked('post_pending_old'), '先留白');

        cutoffs['ch-pending'] = 500; // 服务端回来了
        gate.sync();

        ok(isHidden('post_pending_old'), '该藏的改 display:none');
        ok(!isBlanked('post_pending_old'), '不再是留白态');
        ok(!isBlanked('post_pending_new'), '不该藏的恢复显示');
        ok(blankHosts().length === 0, '没有 pending 时不再留任何待定标记');
        ok(!rules().includes(PENDING), '没有 pending 时不再写 visibility 规则');
    });

    console.log('\n[4] pendingPolicy=show 时不留白');
    await withGate({pendingPolicy: 'show'}, () => {
        ok(blankHosts().length === 0, 'show 策略不写 visibility 规则');
        ok(isHidden('post_old'), 'show 策略下已知边界照常生效');
    });

    console.log('\n[5] 同步：DOM 一变就落地，不等下一帧');
    await withGate({}, async () => {
        const inner = document.querySelector('.innerList');
        const added = [];
        for (let i = 0; i < 5; i++) {
            const wrapper = document.createElement('div');
            wrapper.className = 'item_measurer';
            const row = document.createElement('div');
            row.id = 'post_burst_' + i;
            row.className = 'post';
            wrapper.appendChild(row);
            inner.appendChild(wrapper);
            POSTS['burst_' + i] = {createAt: 100, channelId: 'ch-restricted'};
            added.push(wrapper);
        }

        metaCalls = 0;
        await mutationsFlushed();

        ok(metaCalls > 0, 'MO 回调里就同步处理了（早于 React 测量行高、也早于绘制）');
        ok(isHidden('post_burst_0'), '新插入的行立刻被处理');
        ok(isHidden('post_burst_4'), '整批都被处理');

        // 一次 commit 的多次插入合并成一个 MO 回调，不应该一行一扫描。
        const rows = document.querySelectorAll(ROW_SELECTOR).length;
        ok(metaCalls <= rows * 2, `没有退化成每行一次全量扫描（${metaCalls} 次 / ${rows} 行）`);

        added.forEach((wrapper) => wrapper.remove());
    });

    console.log('\n[6] 日期分隔线');
    await withGate({}, () => {
        const units = document.querySelectorAll('.innerList > .item_measurer');
        // 模板顺序：intro(0)、分隔线(1)、post_old(2)、post_new(3)、marker(4)、分隔线(5)
        const [, first, , , , second] = Array.from(units);
        ok(first.querySelector('.BasicSeparator') !== null, '第一行是分隔线');
        ok(first.style.display === 'none', '第一条（其上是全隐藏的历史）连同整行一起被隐藏');
        ok(second.style.display === '', '可见消息之后的分隔线保留');
    });

    const units = document.querySelectorAll('.innerList > .item_measurer');
    ok(units[0].style.display === '', 'stop 后分隔线恢复');

    console.log('\n[7] 提示条');
    ok(!document.getElementById(NOTICE_ID), '没有 gate 在跑时不存在提示条');
    await withGate({noticeEnabled: true}, () => {
        const notice = document.getElementById(NOTICE_ID);
        ok(Boolean(notice), '确实隐藏了消息时出现提示条');
        ok(notice.textContent === '更早的消息已隐藏', '提示条文案来自配置');
    });
    await withGate({cutoffs: {'ch-restricted': 0, 'ch-pending': 0}}, () => {
        ok(!document.getElementById(NOTICE_ID), '没有消息被隐藏时不显示提示条');
    });

    console.log('\n[8] hideInSearch=false 只管中心频道');
    await withGate({hideInSearch: false, noticeEnabled: false}, () => {
        ok(isHidden('post_old'), '中心频道的行仍被隐藏');
        ok(!isHidden('rhsPost_old'), '右侧栏不处理');
        ok(!isHidden('searchResult_old'), '搜索结果不处理');
    });

    console.log('\n[9] stop 之后彻底清理');
    await withGate({}, (gate) => {
        ok(rules().length > 0, 'start 后写了规则');
        gate.stop();
        ok(!document.getElementById(STYLE_ID), 'stop 后样式表被移除');
        ok(!document.getElementById(NOTICE_ID), 'stop 后提示条被移除');
        ok(hiddenHosts().length === 0 && blankHosts().length === 0, 'stop 后行上的标记全部清掉');
        ok(gate.sync() === 0, 'stop 后 sync 不再生效（返回 0）');
    });

    console.log('\n[10] 视口归位（纯函数，jsdom 没有布局只能这样测）');
    // 视口 0..800。visibleTop/Bottom 是"可见消息那一整块"的外接矩形。
    // 0.6.8 起历史消息根本不进 redux，这里只是兜底：只有"视口里一条可见消息
    // 都没有"这一种情况才动，而且只往底部去（可见消息永远是最新的）。
    ok(planViewportRecovery(0, 800, 400, 460, true).mode === 'none',
        '可见块在视口里 -> 不动');
    ok(planViewportRecovery(0, 800, 300, 900, true).mode === 'none',
        '可见块和视口有重叠 -> 绝不动（不能打断正在读的人）');
    ok(planViewportRecovery(0, 800, 790, 900, true).mode === 'none',
        '只露 10px 也算可见 -> 不动');
    ok(planViewportRecovery(0, 800, 799, 1200, true).mode === 'none',
        '只露 1px 也算可见 -> 不动');
    ok(planViewportRecovery(0, 800, 1200, 1260, true).mode === 'bottom',
        '可见块整个在视口下方 -> 去底部');
    ok(planViewportRecovery(0, 800, -600, -200, true).mode === 'bottom',
        '可见块整个在视口上方 -> 也去底部（可见消息在列表末尾）');
    ok(planViewportRecovery(0, 800, 0, 0, false).mode === 'bottom',
        '视口里一条可见消息都没有（全是空盒子）-> 去底部');
    ok(planViewportRecovery(0, 800, 800, 900, true).mode === 'bottom',
        '刚好贴着视口下沿（不算重叠）-> 去底部');

    console.log('\n[12] 频道起点信息（channelIntro）');
    // 数据层过滤后，列表走到第一条保留消息就到底了，起点信息会紧贴在
    // 「你被加入频道」上面——受限成员不该看到它。行没有 post id，单独收集。
    await withGate({currentChannelId: 'ch-restricted'}, (gate) => {
        gate.sync();
        ok(isHidden('channelIntro'), '受限频道：起点信息整行隐藏');
        ok(collapsedWholeRow('channelIntro'), '隐藏同样打在被测量的行容器上');
        ok(gate.sync() >= 1, 'sync 返回值只统计真实的消息行（起点信息不计入）');
    });
    await withGate({currentChannelId: 'ch-open'}, (gate) => {
        gate.sync();
        ok(!isHidden('channelIntro'), '不受限频道：起点信息照常显示');
    });
    await withGate({}, (gate) => {
        gate.sync();
        ok(!isHidden('channelIntro'), 'provider 没给当前频道时不动（向后兼容）');
    });

    console.log('\n[13] forceVisible：「你被加入频道」的加入标记');
    await withGate({noticeEnabled: true}, (gate) => {
        gate.sync();
        ok(!isHidden('post_marker'), 'create_at 早于 cutoff 的加入标记不隐藏');
        ok(!isBlanked('post_marker'), '也不留白');
    });
    // 只有起点信息可藏、没有任何真实历史行时，提示条不该出现。
    // 用自定义 provider：redux 里什么都查不到（数据层过滤后的常态），但频道受限。
    const introOnlyGate = new HistoryGate({
        provider: {
            getPostMeta: () => undefined,
            getCutoff: (channelId) => (channelId === 'ch-restricted' ? 500 : undefined),
            requestCutoff: () => {},
            getCurrentChannelId: () => 'ch-restricted',
        },
        noticeEnabled: true,
        noticeText: '更早的消息已隐藏',
        hideInSearch: true,
    });
    introOnlyGate.start();
    introOnlyGate.sync();
    ok(isHidden('channelIntro'), '受限频道的起点信息仍被隐藏（cutoff>0）');
    ok(!document.getElementById(NOTICE_ID), '仅隐藏起点信息不触发「历史已隐藏」提示条');
    introOnlyGate.stop();

    console.log('\n========================================');
    console.log(`  PASS ${pass} / FAIL ${fail}`);
    console.log('========================================');

    process.exit(fail === 0 ? 0 : 1);
})();
