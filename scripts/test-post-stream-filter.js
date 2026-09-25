/*
 * 实测「数据层历史过滤器」（post_stream_filter）。
 *
 * 它是 0.6.8 的根治手段：在 /api/v4/channels/<id>/posts 的响应进入 redux 之前
 * 把加入前的消息拿掉。DOM 门再快也是在和虚拟列表的测高赛跑，数据层过滤则让
 * 那些行根本不被渲染 —— 占位空盒子、itemSizeMap 污染、切频道退化，整类消失。
 *
 * 测两块：
 *   1. filterPostList 纯函数（过滤规则、prev_post_id 改写、坏输入）；
 *   2. fetch 补丁（开关、方法、豁免 /plugins/、未知边界等待与超时、透传）。
 *
 * 运行（需先在 webapp 目录 npm install 过）：
 *   NODE_PATH="C:/Users/cheny/.workbuddy/binaries/node/workspace/node_modules" \
 *     node scripts/test-post-stream-filter.js
 */
'use strict';

const {execFileSync} = require('child_process');
const fs = require('fs');
const path = require('path');

const WEBAPP = path.resolve(__dirname, '..', 'webapp');
const OUT = path.join(WEBAPP, '.tmp-test-filter');

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

/* ---------- 1. 编译 TS（含依赖 history_api.ts） ---------- */
fs.rmSync(OUT, {recursive: true, force: true});
const tsc = path.join(WEBAPP, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(process.execPath, [
    tsc,
    'src/post_stream_filter.ts',
    '--outDir', '.tmp-test-filter',
    '--module', 'commonjs',
    '--target', 'es2019',
    '--lib', 'dom,es2019,dom.iterable',
    '--moduleResolution', 'node',
    '--skipLibCheck',
    '--esModuleInterop',
], {cwd: WEBAPP, stdio: 'inherit'});

const {
    filterPostList,
    installPostStreamFilter,
    uninstallPostStreamFilter,
} = require(path.join(OUT, 'post_stream_filter.js'));
const {putBoundary, clearBoundaryCache} = require(path.join(OUT, 'history_api.js'));

const USER = 'user-1';
const CUTOFF = 500;

/* ---------- 2. filterPostList ---------- */
function post(id, createAt, extra) {
    return Object.assign({id, create_at: createAt, type: ''}, extra);
}

function listResponse(entries, extra) {
    const posts = {};
    entries.forEach(([id, p]) => {
        posts[id] = p;
    });
    return Object.assign({
        order: entries.map(([id]) => id),
        posts,
        prev_post_id: 'older-page',
        next_post_id: '',
    }, extra || {});
}

console.log('\n[1] 过滤规则');
(() => {
    const payload = listResponse([
        ['new2', post('new2', 900)],
        ['new1', post('new1', 700)],
        ['old2', post('old2', 300)],
        ['old1', post('old1', 100)],
    ]);

    const result = filterPostList(payload, CUTOFF, USER);
    ok(result !== null, '有历史时返回改写结果');
    ok(result.removed === 2, '移除了 2 条历史');
    ok(JSON.stringify(result.payload.order) === JSON.stringify(['new2', 'new1']), 'order 只剩加入后的消息');
    ok(result.payload.posts.new2 && result.payload.posts.new1, 'posts 保留加入后的消息');
    ok(!result.payload.posts.old1 && !result.payload.posts.old2, 'posts 清掉历史消息');
    ok(result.markedOldest === true, '降序页面标记了到达最旧');
    ok(result.payload.prev_post_id === '', 'prev_post_id 置空（让 webapp 认为 atOldestPost）');
    ok(result.payload.next_post_id === '', 'next_post_id 不动');

    const untouched = filterPostList(listResponse([
        ['new2', post('new2', 900)],
        ['new1', post('new1', 700)],
    ]), CUTOFF, USER);
    ok(untouched === null, '没有历史时返回 null（响应原样透传）');

    const cutoffZero = filterPostList(listResponse([
        ['old1', post('old1', 100)],
    ]), 0, USER);
    ok(cutoffZero === null, 'cutoff=0（不受限）时不过滤');
})();

console.log('\n[2] 「你被加入频道」系统消息保留');
(() => {
    const marker = post('marker', 499, {
        type: 'system_add_to_channel',
        props: {addedUserId: USER, userId: 'someone-else'},
    });
    const othersMarker = post('others', 100, {
        type: 'system_add_to_channel',
        props: {addedUserId: 'someone-else'},
    });

    const result = filterPostList(listResponse([
        ['new1', post('new1', 700)],
        ['marker', marker],
        ['others', othersMarker],
    ]), CUTOFF, USER);

    ok(result !== null, '有历史时正常返回');
    ok(result.payload.order.includes('marker'), '自己的加入标记保留（哪怕 create_at 略早于 cutoff）');
    ok(!result.payload.order.includes('others'), '别人的加入标记仍被过滤');

    // create_at 恰好等于 cutoff 也要保留（边界是排他下界）。
    const atBoundary = filterPostList(listResponse([
        ['edge', post('edge', CUTOFF)],
    ]), CUTOFF, USER);
    ok(atBoundary === null, 'create_at === cutoff 的消息不算历史');
})();

console.log('\n[3] prev_post_id 只在降序时改写');
(() => {
    const descending = listResponse([
        ['new1', post('new1', 700)],
        ['old1', post('old1', 100)],
    ]);
    ok(filterPostList(descending, CUTOFF, USER).markedOldest === true, '降序（新→旧）：标记最旧');

    const ascending = listResponse([
        ['old1', post('old1', 100)],
        ['new1', post('new1', 700)],
    ]);
    const result = filterPostList(ascending, CUTOFF, USER);
    ok(result !== null && result.markedOldest === false, '升序页：不改写 prev_post_id（无法断言更旧页都是历史）');
    ok(result.payload.prev_post_id === 'older-page', '升序页 prev_post_id 保持原值');
})();

console.log('\n[4] 坏输入防御');
(() => {
    ok(filterPostList(null, CUTOFF, USER) === null, 'null 载荷');
    ok(filterPostList('nope', CUTOFF, USER) === null, '非对象载荷');
    ok(filterPostList({order: 'x'}, CUTOFF, USER) === null, '缺 posts 字段');
    ok(filterPostList({posts: {}}, CUTOFF, USER) === null, '缺 order 字段');

    const dangling = filterPostList({
        order: ['gone', 'new1'],
        posts: {new1: post('new1', 700)},
        prev_post_id: 'older-page',
    }, CUTOFF, USER);
    ok(dangling !== null, '悬空 id 能处理');
    ok(JSON.stringify(dangling.payload.order) === JSON.stringify(['new1']), '悬空 id 被丢弃');
})();

/* ---------- 5. fetch 补丁 ---------- */
const realFetch = globalThis.fetch;

function jsonResponse(body, status) {
    return Promise.resolve(new Response(JSON.stringify(body), {
        status: status || 200,
        headers: {'Content-Type': 'application/json'},
    }));
}

const calls = [];
let fakeHandler = null;

function makeFakeFetch() {
    return (url, init) => {
        calls.push({url: String(url), method: (init && init.method) || 'GET'});
        return fakeHandler(String(url), init);
    };
}

async function withFilter(options, fn) {
    globalThis.fetch = makeFakeFetch();
    installPostStreamFilter(options);
    try {
        await fn();
    } finally {
        uninstallPostStreamFilter();
        globalThis.fetch = realFetch;
    }
}

const enabledOptions = {
    isEnabled: () => true,
    getPluginUrl: () => '/plugins/com.example.customers-plugin',
    getUserId: () => USER,
};

(async () => {
    console.log('\n[5] fetch 补丁：命中与放行');
    await withFilter(enabledOptions, async () => {
        clearBoundaryCache();
        putBoundary(USER, 'ch1', {
            enabled: true, channelId: 'ch1', mode: '', joinedAt: 0, cutoffAt: CUTOFF, serverTime: 1,
        });

        fakeHandler = (url) => jsonResponse(listResponse([
            ['new1', post('new1', 700)],
            ['old1', post('old1', 100)],
        ]));

        const res = await fetch('http://localhost:8065/api/v4/channels/ch1/posts?per_page=60');
        const body = await res.json();
        ok(JSON.stringify(body.order) === JSON.stringify(['new1']), '命中：响应里的历史已被过滤');
        ok(calls.length === 1, '已知边界：没有额外请求');

        calls.length = 0;
        await fetch('http://localhost:8065/api/v4/channels/ch1/posts?since=123');
        ok(JSON.stringify(calls) !== '[]' && calls.length === 1, 'since 同步请求同样命中同一端点');

        calls.length = 0;
        fakeHandler = () => jsonResponse({order: ['x'], posts: {}});
        const open = await fetch('http://localhost:8065/api/v4/channels/ch-open/posts');
        const openBody = await open.json();
        clearBoundaryCache();
        putBoundary(USER, 'ch-open', {
            enabled: false, channelId: 'ch-open', mode: '', joinedAt: 0, cutoffAt: 0, serverTime: 1,
        });
        // 重新取一次（cutoff=0 的频道）
        calls.length = 0;
        const open2 = await fetch('http://localhost:8065/api/v4/channels/ch-open/posts');
        await open2.json();
        ok(openBody && calls.length === 1, 'cutoff=0 的频道直接放行');

        calls.length = 0;
        // ch-open 分支换过桩数据，这里换回含历史的标准响应。
        fakeHandler = () => jsonResponse(listResponse([
            ['new1', post('new1', 700)],
            ['old1', post('old1', 100)],
        ]));
        // ch-open 分支 clear 过缓存，ch1 的边界要先补回来。
        putBoundary(USER, 'ch1', {
            enabled: true, channelId: 'ch1', mode: '', joinedAt: 0, cutoffAt: CUTOFF, serverTime: 1,
        });
        const unread = await (await fetch('http://localhost:8065/api/v4/users/' + USER + '/channels/ch1/posts/unread?limit_before=30')).json();
        ok(JSON.stringify(unread.order) === JSON.stringify(['new1']), 'unread 端点也被过滤');

        calls.length = 0;
        await fetch('http://localhost:8065/api/v4/posts/search', {method: 'POST', body: '{}'});
        ok(calls.length === 1, 'POST 请求放行');
        ok(calls[0].url.includes('/posts/search'), '放行的请求原样到达网络层');

        calls.length = 0;
        await fetch('http://localhost:8065/api/v4/channels/ch1/posts/9999');
        ok(calls.length === 1, '单帖上下文端点不放行过滤（/posts/<id> 不匹配）');

        calls.length = 0;
        await fetch('http://localhost:8065/plugins/com.example.customers-plugin/api/v1/config');
        ok(calls.length === 1, '插件自身接口放行（避免边界请求自递归）');
    });

    console.log('\n[6] 开关与用户');
    await withFilter({
        isEnabled: () => false,
        getPluginUrl: () => '/plugins/com.example.customers-plugin',
        getUserId: () => USER,
    }, async () => {
        clearBoundaryCache();
        putBoundary(USER, 'ch1', {
            enabled: true, channelId: 'ch1', mode: '', joinedAt: 0, cutoffAt: CUTOFF, serverTime: 1,
        });
        fakeHandler = () => jsonResponse(listResponse([
            ['old1', post('old1', 100)],
        ]));
        const res = await fetch('http://localhost:8065/api/v4/channels/ch1/posts');
        const body = await res.json();
        ok(JSON.stringify(body.order) === JSON.stringify(['old1']), '功能关闭时不过滤');
    });

    await withFilter({
        isEnabled: () => true,
        getPluginUrl: () => '/plugins/com.example.customers-plugin',
        getUserId: () => '',
    }, async () => {
        clearBoundaryCache();
        fakeHandler = () => jsonResponse(listResponse([
            ['old1', post('old1', 100)],
        ]));
        const res = await fetch('http://localhost:8065/api/v4/channels/ch1/posts');
        const body = await res.json();
        ok(JSON.stringify(body.order) === JSON.stringify(['old1']), '用户 id 未知时不过滤（宁可交给 DOM 门）');
    });

    console.log('\n[7] 未知边界：等待边界请求后再过滤');
    await withFilter(enabledOptions, async () => {
        clearBoundaryCache();
        let boundaryAsked = 0;
        fakeHandler = (url) => {
            if (url.includes('/plugins/com.example.customers-plugin/api/v1/history/boundary')) {
                boundaryAsked++;
                return jsonResponse({
                    enabled: true, channelId: 'ch-pending', mode: '', joinedAt: 0, cutoffAt: CUTOFF, serverTime: 1,
                });
            }

            return jsonResponse(listResponse([
                ['new1', post('new1', 700)],
                ['old1', post('old1', 100)],
            ]));
        };

        const res = await fetch('http://localhost:8065/api/v4/channels/ch-pending/posts');
        const body = await res.json();
        ok(boundaryAsked === 1, '先取了一次边界');
        ok(JSON.stringify(body.order) === JSON.stringify(['new1']), '拿到边界后响应被过滤');

        // 边界失败：原样透传，交给 DOM 门。
        clearBoundaryCache();
        fakeHandler = () => jsonResponse({error: 'nope'}, 500);
        const res2 = await fetch('http://localhost:8065/api/v4/channels/ch-pending/posts');
        const body2 = await res2.json();
        ok(body2.error === 'nope', '边界请求失败时透传原始响应');
    });

    console.log('\n========================================');
    console.log('  PASS ' + pass + ' / FAIL ' + fail);
    process.exit(fail > 0 ? 1 : 0);
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
