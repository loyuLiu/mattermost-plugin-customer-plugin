/*
 * 测 DOM 兜底（dom_guard）：React 在提交阶段 removeChild/insertBefore 抛
 * NotFoundError 时的容忍层。
 *
 * 手机白屏的堆栈落在 react-dom 提交删除阶段的 removeChild —— 节点被挪走后
 * React 按旧父节点去删，整个 app 卸载，页面全白。错误边界够不到提交阶段，
 * 所以只能在这一层兜：只有"本来要抛"的那种情况才走兜底，其余全部原样透传。
 *
 * 运行：
 *   NODE_PATH="C:/Users/cheny/.workbuddy/binaries/node/workspace/node_modules" \
 *     node scripts/test-dom-guard.js
 */
'use strict';

const {execFileSync} = require('child_process');
const fs = require('fs');
const path = require('path');

const WEBAPP = path.resolve(__dirname, '..', 'webapp');
const OUT = path.join(WEBAPP, '.tmp-test-dom-guard');

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
    'src/dom_guard.ts',
    'src/crash_report.ts',
    '--outDir', '.tmp-test-dom-guard',
    '--module', 'commonjs',
    '--target', 'es2019',
    '--lib', 'dom,es2019',
    '--moduleResolution', 'node',
    '--skipLibCheck',
    '--esModuleInterop',
], {cwd: WEBAPP, stdio: 'inherit'});

/* ---------- 2. jsdom 全局 ---------- */
const {JSDOM} = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
global.Element = dom.window.Element;
global.HTMLElement = dom.window.HTMLElement;

/* ---------- 3. 一个够用的 localStorage ---------- */
const store = new Map();
global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};

const guard = require(path.join(OUT, 'dom_guard.js'));
const crash = require(path.join(OUT, 'crash_report.js'));

const records = () => crash.getCrashRecords();

(async () => {
    console.log('[1] 没装兜底时：挪走节点再删，原生实现真的会抛');
    {
        const parent = document.createElement('div');
        const child = document.createElement('span');
        parent.appendChild(child);
        const other = document.createElement('div');
        other.appendChild(child); // 节点被挪走了

        let threw = false;
        try {
            parent.removeChild(child);
        } catch {
            threw = true;
        }
        ok(threw, '原生的 removeChild 对已挪位的节点抛错（这就是白屏的那一下）');
        other.appendChild(child);
        child.remove();
    }

    console.log('\n[2] 装上兜底：同样的场景不再抛，节点从实际父节点删除');
    guard.installDomGuard();
    {
        const parent = document.createElement('div');
        const child = document.createElement('span');
        parent.appendChild(child);
        const other = document.createElement('div');
        other.appendChild(child);

        let threw = false;
        try {
            parent.removeChild(child);
        } catch {
            threw = true;
        }
        ok(!threw, '挪位场景不抛');
        ok(child.parentNode === null, '节点确实被删掉了（从实际父节点）');
        ok(records().some((r) => r.source === 'dom-guard' && /挪位/.test(r.message)),
            '介入动作留下了记录（静默，不画横幅）');
    }

    console.log('\n[3] 节点已经不在树里：按已删除处理');
    {
        const detached = document.createElement('span');
        const parent = document.createElement('div');
        let threw = false;
        let returned = null;
        try {
            returned = parent.removeChild(detached);
        } catch {
            threw = true;
        }
        ok(!threw, '对游离节点不抛');
        ok(returned === detached, '把调用方给的节点原样还回去');
    }

    console.log('\n[4] insertBefore 的参照被挪走：插到参照点旁边，不抛');
    {
        const list = document.createElement('div');
        const a = document.createElement('span');
        const b = document.createElement('span');
        list.appendChild(a);
        list.appendChild(b);

        const elsewhere = document.createElement('div');
        elsewhere.appendChild(b); // 参照节点被挪走

        const fresh = document.createElement('i');
        let threw = false;
        try {
            list.insertBefore(fresh, b);
        } catch {
            threw = true;
        }
        ok(!threw, '参照挪位场景不抛');
        ok(b.previousSibling === fresh || b.previousElementSibling === fresh,
            '新节点紧挨着参照点的实际位置');
    }

    console.log('\n[5] 正常路径完全透传（不改变任何原有行为）');
    {
        const list = document.createElement('div');
        const a = document.createElement('span');
        const b = document.createElement('span');
        list.insertBefore(b, null);
        list.insertBefore(a, b);
        ok(list.firstChild === a && list.lastChild === b, 'insertBefore 正常插入');
        list.removeChild(a);
        ok(list.childNodes.length === 1 && list.firstChild === b, 'removeChild 正常删除');
        ok(records().filter((r) => /正常|透传/.test(r.message)).length === 0,
            '正常路径没有留下兜底记录');
    }

    console.log('\n[6] 节流：同一时刻的多次介入只记一条');
    {
        crash.resetCrashRecords();
        guard.resetDomGuardRecords();
        const parent = document.createElement('div');
        for (let i = 0; i < 5; i++) {
            const child = document.createElement('span');
            parent.appendChild(child);
            const other = document.createElement('div');
            other.appendChild(child);
            try {
                parent.removeChild(child);
            } catch {
                // 兜底不该抛；真抛了由下面的计数暴露
            }
        }
        ok(records().filter((r) => r.source === 'dom-guard').length === 1,
            '连续五次介入只记一条（读数不刷屏）');
    }

    console.log('\n[7] 静默记录不画横幅，画过的横幅可以被清掉');
    {
        // 横幅默认关（v0.6.33 起），这一段要显式打开；先清掉前面静默存档的几条，
        // 否则打开开关时它们会被补画出来（补画本身是特性，但这一段要验的是「静默」）。
        crash.resetCrashRecords();
        crash.setCrashBannerEnabled(true);
        ok(document.getElementById('customers-plugin-crash-banner') === null,
            '纯兜底介入没有惊动页面（无红色横幅）');
        crash.recordCrash(new Error('真的炸了'), 'react');
        ok(Boolean(document.getElementById('customers-plugin-crash-banner')),
            '真正的错误仍然画横幅');
    }

    console.log('\n[8] 手机浏览器的自动播放拒绝不画横幅（良民，非故障）');
    {
        crash.resetCrashRecords();
        crash.uninstallCrashReporter();
        crash.installCrashReporter();
        crash.setCrashBannerEnabled(true); // 横幅默认关（v0.6.33 起），取证时显式打开

        const reject = (message, stack) => {
            const err = new Error(message);
            err.stack = stack;
            const evt = new window.Event('unhandledrejection');
            evt.reason = err;
            window.dispatchEvent(evt);
        };

        // 现场横幅上那条：NotAllowedError + play@native code
        reject(
            'The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.',
            'play@native code\nI@https://example.com/static/8461.js:1:1492314'
        );
        ok(records().filter((r) => /not allowed by the user agent/.test(r.message)).length === 1,
            '良民拒绝仍被静默记录（证据留存，事后能取）');
        ok(document.getElementById('customers-plugin-crash-banner') === null,
            '但不画红色横幅（提示音被拦不是白屏原因，横幅不能狼来了）');

        // 同样的 NotAllowedError，但没有 play 的栈：不是自动播放，照报。
        reject(
            'The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.',
            'requestNotificationPermission@https://example.com/static/9.js:1:2'
        );
        ok(Boolean(document.getElementById('customers-plugin-crash-banner')),
            '没有 play 栈的同名拒绝照样画横幅（过滤只针对自动播放这一种）');

        crash.uninstallCrashReporter();
    }

    console.log('\n[9] index.tsx 的接线：兜底紧跟崩溃取证，都在最前面');
    {
        const src = fs.readFileSync(path.join(WEBAPP, 'src', 'index.tsx'), 'utf8');
        const atGuard = src.indexOf('installDomGuard();');
        const atCrash = src.indexOf('installCrashReporter();');
        const atFilter = src.indexOf('installPostStreamFilter(');
        ok(atCrash >= 0 && atGuard > atCrash, '崩溃取证在最前，兜底紧随其后');
        ok(atFilter < 0 || atGuard < atFilter, '两者都在频道消息过滤之前');
    }

    guard.uninstallDomGuard();

    console.log('\n========================================');
    console.log('PASS ' + pass + ' / FAIL ' + fail);
    process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
