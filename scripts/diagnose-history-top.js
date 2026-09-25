// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
//
// 诊断脚本：新成员滚到频道最顶部时可见消息"消失"的原因定位。
//
// 用法：登录成被隔离的新成员 -> 打开目标频道 -> 把滚动条拉到最顶部 ->
//       F12 控制台粘贴本文件全部内容 -> 回车 -> 把输出整段复制回来。
//
// 它是纯只读的，不改动任何 DOM / 数据。

(function diagnoseHistoryTop() {
    const HIDDEN = 'data-customers-history-hidden';
    const PENDING = 'data-customers-history-pending';
    const POST_SEL = '[id^="post_"],[id^="rhsPost_"],[id^="searchResult_"]';

    const scroller = document.getElementById('postListScrollContainer');
    const inner = document.querySelector('.innerList[role="list"]');

    if (!scroller || !inner) {
        console.warn('[diag] 找不到 #postListScrollContainer / .innerList，当前页面不在中心频道消息列表。');
        return;
    }

    const children = Array.from(inner.children);
    const items = children.map((child, i) => {
        const post = child.querySelector(POST_SEL);
        const rect = child.getBoundingClientRect();

        return {
            i,
            measurer: child.classList.contains('item_measurer'),
            h: Math.round(rect.height),
            top: Math.round(rect.top - inner.getBoundingClientRect().top),
            postId: post ? post.id : '',
            hidden: child.hasAttribute(HIDDEN),
            pending: child.hasAttribute(PENDING),
            inlineH: child.style.height || '',
        };
    });

    const rendered = items.filter((it) => it.measurer);
    const placeholders = items.filter((it) => !it.measurer);
    const withPost = items.filter((it) => it.postId);
    const hiddenRows = withPost.filter((it) => it.hidden);
    const visibleRows = withPost.filter((it) => !it.hidden);

    // 关键指标 1：第一条"未被隐藏"的消息行之前，堆了多少像素的空白。
    const firstVisible = visibleRows[0];
    const blankAbove = firstVisible ?
        items.filter((it) => it.i < firstVisible.i).reduce((sum, it) => sum + it.h, 0) :
        -1;

    // 关键指标 2：占位 div（虚拟化行滚出窗口后留下的空盒子）一共占了多少高度。
    const phantom = placeholders.reduce((sum, it) => sum + it.h, 0);

    // 关键指标 3：DOM 里到底有几行真实消息、其中几行被判为历史。
    const summary = {
        scrollTop: Math.round(scroller.scrollTop),
        scrollHeight: Math.round(scroller.scrollHeight),
        clientHeight: Math.round(scroller.clientHeight),
        innerListHeight: Math.round(inner.getBoundingClientRect().height),
        children: children.length,
        renderedRows: rendered.length,
        placeholderRows: placeholders.length,
        rowsWithPost: withPost.length,
        rowsHidden: hiddenRows.length,
        rowsVisible: visibleRows.length,
        rowsPending: withPost.filter((it) => it.pending).length,
        blankAboveFirstVisiblePx: blankAbove,
        phantomPlaceholderPx: phantom,
    };

    console.log('[diag] 汇总', summary);

    if (firstVisible) {
        console.log('[diag] 第一条可见消息行:', {
            domIndex: firstVisible.i,
            id: firstVisible.postId,
            距innerList顶部: firstVisible.top,
            高度: firstVisible.h,
        });
    } else {
        console.warn('[diag] DOM 里没有任何"未被隐藏"的消息行 —— 可见消息根本没被渲染出来。');
    }

    // 最顶部 25 个子节点的构成（能看到"频道起点"那一行排在哪、后面跟的是不是一串空盒子）
    console.log('[diag] 顶部 25 个子节点:');
    console.table(items.slice(0, 25));

    // 带消息的行全部列出来，看可见的到底落在哪一段
    console.log('[diag] 所有带消息的行:');
    console.table(withPost);

    // 疑似陈旧高度：占位 div 高度 > 0 且数量明显超过已渲染行 → 说明 itemSizeMap 里残留了非零高度
    const fatPlaceholders = placeholders.filter((it) => it.h > 0);
    if (fatPlaceholders.length > 0) {
        console.warn('[diag] 存在 %d 个高度 > 0 的占位盒子，合计 %dpx（这些就是"看不见但占位置"的空白）。',
            fatPlaceholders.length, phantom);
    }

    return summary;
})();
