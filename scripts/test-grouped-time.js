/*
 * 用 jsdom 实测「合并消息（同一人连续发言）悬停浮框时间」引擎。
 *
 * 为什么是 jsdom 而不是真浏览器：这个引擎只依赖 DOM 结构（类名、id、事件），
 * 不依赖布局；jsdom 足够覆盖「识别合并消息 / 跟随鼠标 / 隐藏内联时间 /
 * 非合并消息不显示」这些判定分支。
 *
 * 运行（需先在 webapp 目录 npm install 过）：
 *   NODE_PATH="C:/Users/cheny/.workbuddy/binaries/node/workspace/node_modules" \
 *     node scripts/test-grouped-time.js
 */
'use strict';

const {execFileSync} = require('child_process');
const fs = require('fs');
const path = require('path');
const {JSDOM} = require('jsdom');

const WEBAPP = path.resolve(__dirname, '..', 'webapp');
const OUT = path.join(WEBAPP, '.tmp-test');

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

/* ---------- 1. 把 TS 编译成 CJS ---------- */
fs.rmSync(OUT, {recursive: true, force: true});
// 直接跑本机 node_modules 里的 tsc（npx.cmd 在 Git Bash 下 spawn 不起来）
const tsc = path.join(WEBAPP, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(process.execPath, [
    tsc,
    'src/grouped_time.ts',
    'src/format.ts',
    '--outDir', '.tmp-test',
    '--module', 'commonjs',
    '--target', 'es2019',
    '--lib', 'dom,es2019',
    '--moduleResolution', 'node',
    '--skipLibCheck',
    '--esModuleInterop',
], {cwd: WEBAPP, stdio: 'inherit'});

const {GroupedTimeOverlay} = require(path.join(OUT, 'grouped_time.js'));

/* ---------- 2. 搭一个和 Mattermost 10.12 同构的 DOM ---------- */
const dom = new JSDOM(`<!doctype html><html><body>
<div id="virtualizedPostListContent">
  <div id="post_root1" class="post other--root">
    <div class="post__content"><div>
      <div class="post__header"><time class="post__time" datetime="2026-09-22T01:00:00.000Z">01:00</time></div>
      <div class="post-message">第一条（组的头）</div>
    </div></div>
  </div>
  <div id="post_a" class="post same--root same--user">
    <div class="post__content"><div>
      <div class="post__header"><time class="post__time" datetime="2026-09-22T01:30:00.000Z">01:30</time></div>
      <div class="post-message" id="msg_a">第二条（合并）</div>
    </div></div>
  </div>
  <div id="post_r1" class="post other--root post--comment">
    <div class="post__content"><div>
      <div class="post__header"><time class="post__time" datetime="2026-09-22T01:30:30.000Z">01:30:30</time></div>
      <div class="post-message" id="msg_r1">线程的第一条回复（块首，不算合并）</div>
    </div></div>
  </div>
  <div id="post_b" class="post same--root same--user post--comment">
    <div class="post__content"><div>
      <div class="post__header"><time class="post__time" datetime="2026-09-22T01:31:00.000Z">01:31</time></div>
      <div class="post-message" id="msg_b">线程第二条回复（same--root + post--comment）</div>
    </div></div>
  </div>
</div>
<div id="rhsContainer">
  <div id="rhsPost_c" class="post same--root">
    <div class="post__content"><div><div class="post-message" id="msg_c">右侧栏</div></div></div>
  </div>
</div>
</body></html>`, {pretendToBeVisual: true, url: 'http://localhost/'});

global.window = dom.window;
global.document = dom.window.document;
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const document = dom.window.document;
const window = dom.window;

const CREATE_AT = Date.UTC(2026, 8, 22, 1, 30); // 2026-09-22T01:30:00Z
// 注意：provider 收到的是去掉 `post_` 前缀的消息 id（post_a -> a）
const TIMES = {
    root1: Date.UTC(2026, 8, 22, 1, 0),
    a: CREATE_AT,
    r1: Date.UTC(2026, 8, 22, 1, 30, 30),
    b: Date.UTC(2026, 8, 22, 1, 31),
};

const overlay = new GroupedTimeOverlay({
    getCreateAt: (postId) => TIMES[postId],
});

function move(id, x, y) {
    const el = document.getElementById(id);
    el.dispatchEvent(new dom.window.MouseEvent('mousemove', {bubbles: true, clientX: x, clientY: y}));
}

function box() {
    return document.getElementById('customers-plugin-grouped-time-overlay');
}

(async () => {
    console.log('\n[1] 悬停合并消息 -> 浮框显示自定义格式时间');
    overlay.update({
        format: 'YYYY-MM-DD HH:mm',
        locale: 'en-US',
        timeZone: 'UTC',
        position: 'cursor',
        hideInline: true,
    });
    move('msg_a', 300, 200);
    await sleep(80);
    const b = box();
    ok(!!b, '浮框元素已创建并挂到 body');
    ok(!!b && b.style.display === 'block', '浮框可见');
    ok(!!b && b.textContent === '2026-09-22 01:30', '内容是自定义格式的时间（实际：' + (b && b.textContent) + '）');
    ok(!!b && b.style.pointerEvents === 'none', '浮框不拦截鼠标事件');
    ok(!!b && b.style.position === 'fixed', '定位方式为 fixed');

    console.log('\n[2] 跟随鼠标（cursor）+ 视口内收边');
    ok(b.style.left === '314px' && b.style.top === '218px', '停在指针右下 14/18px（实际 ' + b.style.left + ',' + b.style.top + '）');
    move('msg_a', window.innerWidth - 2, window.innerHeight - 2);
    await sleep(80);
    const maxLeft = window.innerWidth - 8;
    const maxTop = window.innerHeight - 8;
    ok(parseInt(b.style.left, 10) <= maxLeft && parseInt(b.style.top, 10) <= maxTop,
        '贴边时收进视口（left=' + b.style.left + ' top=' + b.style.top + '）');

    console.log('\n[3] 隐藏 Mattermost 悬停时插进标题行的内联时间');
    const style = document.getElementById('customers-plugin-grouped-time-style');
    ok(!!style, '注入了样式表');
    ok(!!style && style.textContent.indexOf('display:none !important') >= 0, '含 display:none 规则');
    ok(!!style && style.textContent.indexOf('.post.same--root') >= 0 &&
        style.textContent.indexOf(':not(.post--comment)') < 0, '覆盖合并块（same--root，含内联回复）');
    ok(!!style && style.textContent.indexOf('.post.post--comment') < 0, '不单独覆盖 post--comment（首条回复保留内联时间）');
    ok(!!style && style.textContent.indexOf('#postListContent') >= 0 && style.textContent.indexOf('#virtualizedPostListContent') >= 0,
        '只作用于中心频道列表容器');

    console.log('\n[4] 引用消息回复：从第二条开始用浮框');
    move('msg_a', 300, 200);
    await sleep(80);
    ok(box().style.display === 'block', '先确认合并消息已显示');

    // 线程第一条回复：isFirstReply -> other--root（只有 post--comment），保留内联时间
    move('msg_r1', 300, 210);
    await sleep(80);
    ok(box().style.display === 'none', '线程第一条回复不显示浮框');

    move('msg_b', 300, 220);
    await sleep(80);
    ok(box().style.display === 'block', '线程第二条回复（same--root + post--comment）显示浮框');
    ok(box().textContent === '2026-09-22 01:31', '回复浮框内容是该回复自己的时间（实际：' + box().textContent + '）');

    console.log('\n[5] 不该显示的情况');
    move('msg_a', 300, 200);
    await sleep(80);
    ok(box().style.display === 'block', '先确认已显示');

    // 组的头一条（other--root）
    document.getElementById('post_root1').querySelector('.post-message');
    const firstMsg = document.getElementById('post_root1').querySelector('.post__content');
    firstMsg.dispatchEvent(new dom.window.MouseEvent('mousemove', {bubbles: true, clientX: 100, clientY: 100}));
    await sleep(80);
    ok(box().style.display === 'none', '组的第一条不显示浮框');

    move('msg_c', 300, 240);
    await sleep(80);
    ok(box().style.display === 'none', '右侧栏（不在中心列表容器）不显示浮框');

    move('msg_r1', 300, 250);
    await sleep(80);
    ok(box().style.display === 'none', '只回复一条时（线程首条回复）仍不显示浮框');

    console.log('\n[6] 取不到该条消息时间时不显示');
    const unknown = new GroupedTimeOverlay({getCreateAt: () => undefined});
    unknown.update({format: 'HH:mm', locale: 'en-US', position: 'cursor', hideInline: false});
    move('msg_a', 400, 300);
    await sleep(80);
    const boxes = document.querySelectorAll('[id="customers-plugin-grouped-time-overlay"]');
    ok(boxes.length === 1, '两个实例共用一个 id（旧的不会被重复创建）');
    ok(unknown.isVisible() === false, 'redux 里没有这条消息时不显示');
    unknown.stop();

    console.log('\n[7] 关闭功能后彻底清理');
    overlay.stop();
    ok(!document.getElementById('customers-plugin-grouped-time-overlay'), '浮框元素已移除');
    ok(!document.getElementById('customers-plugin-grouped-time-style'), '样式表已移除');
    move('msg_a', 300, 200);
    await sleep(80);
    ok(!document.getElementById('customers-plugin-grouped-time-overlay'), '停止后鼠标移动不再重建浮框');

    fs.rmSync(OUT, {recursive: true, force: true});

    console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
    process.exit(fail === 0 ? 0 : 1);
})();
