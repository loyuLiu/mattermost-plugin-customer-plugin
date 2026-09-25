/*
 * 测边界缓存层：内存缓存 + localStorage 镜像。
 *
 * 这一层的存在理由只有一条 —— **第一次渲染时边界必须已经是已知的**。
 * 边界还在路上时，门会把行"留白但保留高度"，而虚拟列表正是在那一刻测量行高的；
 * 先按全高测量、再被塌陷，行高就永远留在 itemSizeMap 里，之后滚出窗口由占位 div
 * 按旧高度撑开 —— 就是"频道顶部一片空白"。把边界镜像到 localStorage，
 * 刷新和切回频道都能在第一帧之前拿到答案，整类问题就不存在了。
 *
 * 运行：
 *   NODE_PATH="C:/Users/cheny/.workbuddy/binaries/node/workspace/node_modules" \
 *     node scripts/test-history-api.js
 */
'use strict';

const {execFileSync} = require('child_process');
const fs = require('fs');
const path = require('path');

const WEBAPP = path.resolve(__dirname, '..', 'webapp');
const OUT = path.join(WEBAPP, '.tmp-test-history-api');

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
    'src/history_api.ts',
    '--outDir', '.tmp-test-history-api',
    '--module', 'commonjs',
    '--target', 'es2019',
    '--lib', 'dom,es2019',
    '--moduleResolution', 'node',
    '--skipLibCheck',
    '--esModuleInterop',
], {cwd: WEBAPP, stdio: 'inherit'});

/* ---------- 2. 一个够用的 localStorage ---------- */
const store = new Map();
global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};

const api = require(path.join(OUT, 'history_api.js'));

const USER = 'u1';
const boundary = (channelId, cutoffAt) => ({
    enabled: cutoffAt > 0,
    channelId,
    mode: 'since_join',
    joinedAt: cutoffAt,
    cutoffAt,
    serverTime: 1,
});

(async () => {
    console.log('[1] 冷启动：没有任何持久化数据时');
    ok(Object.keys(api.hydrateBoundaries(USER)).length === 0, '首次进入不编造边界（缺失=未知，不是不限制）');
    ok(Object.keys(api.hydrateBoundaries('')).length === 0, '没有 userId 时直接返回空');

    console.log('\n[2] 写进去再读回来');
    api.putBoundary(USER, 'ch-a', boundary('ch-a', 500));
    api.putBoundary(USER, 'ch-b', boundary('ch-b', 900));
    api.putBoundary(USER, 'ch-open', boundary('ch-open', 0));

    // 持久化是 debounce 的（批量请求会一次写很多条），等一下再断言。
    await new Promise((r) => setTimeout(r, 400));

    ok(api.peekBoundary(USER, 'ch-a').cutoffAt === 500, '内存缓存里有 ch-a');
    ok(!api.isBoundaryStale(USER, 'ch-a'), '刚取回来的不算陈旧');

    // 模拟"刷新页面"：内存缓存丢掉，只留 localStorage。
    api.clearBoundaryCache();
    ok(api.peekBoundary(USER, 'ch-a') === undefined, '刷新后内存缓存确实是空的');

    const seeds = api.hydrateBoundaries(USER);
    ok(seeds['ch-a'] === 500, '刷新后第一帧就能拿到 ch-a 的边界');
    ok(seeds['ch-b'] === 900, 'ch-b 也一样');
    ok(seeds['ch-open'] === undefined, '不限制的频道（cutoff=0）不落盘，避免把"未知"固化成"不限制"');

    console.log('\n[3] 落盘的条目必须标成陈旧，逼调用方后台重新校验');
    ok(api.isBoundaryStale(USER, 'ch-a'), '恢复出来的边界一律视为陈旧 -> 仍会走一次 SWR');

    console.log('\n[4] 用户之间是隔离的');
    const other = api.hydrateBoundaries('u2');
    ok(Object.keys(other).length === 0, '另一个用户看不到 u1 的边界');

    console.log('\n[5] 坏数据不能把功能带崩');
    store.set('customers-plugin:history-boundaries:u3', '{not json');
    ok(Object.keys(api.hydrateBoundaries('u3')).length === 0, 'JSON 解析失败时当作没有数据');
    store.set('customers-plugin:history-boundaries:u4', JSON.stringify({at: Date.now(), cutoffs: null}));
    ok(Object.keys(api.hydrateBoundaries('u4')).length === 0, '结构不对时当作没有数据');
    store.set('customers-plugin:history-boundaries:u5', JSON.stringify({at: Date.now() - 30 * 24 * 3600 * 1000, cutoffs: {x: 1}}));
    ok(Object.keys(api.hydrateBoundaries('u5')).length === 0, '超过 7 天的旧数据不再信任');
    store.set('customers-plugin:history-boundaries:u6', JSON.stringify({at: Date.now(), cutoffs: {'': 5, y: -1, z: 'x'}}));
    ok(Object.keys(api.hydrateBoundaries('u6')).length === 0, '脏条目（空 id / 非正数 / 非数字）全部丢弃');

    console.log('\n========================================');
    console.log(`  PASS ${pass} / FAIL ${fail}`);
    console.log('========================================');

    fs.rmSync(OUT, {recursive: true, force: true});
    process.exit(fail === 0 ? 0 : 1);
})();
