// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {ProductNavDocument} from './types/config';

const JSON_HEADERS = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
};

const READ_HEADERS = {
    'X-Requested-With': 'XMLHttpRequest',
};

/**
 * Turns an HTTP status into something an administrator can act on.
 *
 * The panel is used by people who will not open the browser console, so a bare
 * "failed to save navigation: 403" is useless — the status has to be translated into
 * the one thing that is actually wrong.
 */
function describeStatus(status: number, detail: string): string {
    switch (status) {
    case 401:
        return '登录状态失效（401）：请刷新页面重新登录后重试。';
    case 403:
        return '没有权限（403）：只有系统管理员可以修改产品导航。';
    case 404:
        return '接口不存在（404）：服务端没有 /api/v1/navigation，请确认插件已升级并重新启用。';
    case 405:
        return '请求方法不被允许（405）：通常是站点前面的反向代理只允许 GET/POST，请检查代理配置。';
    case 400:
        return '服务端拒绝了这份数据（400）' + (detail ? '：' + detail : '，请检查每行的名称与地址是否都填写完整。');
    default:
        return `请求失败（${status}）` + (detail ? '：' + detail : '');
    }
}

/** Reads the server's own wording so it can be shown instead of just the status. */
async function fail(response: Response): Promise<never> {
    let detail = '';
    try {
        detail = (await response.text()).trim().slice(0, 300);
    } catch {
        detail = '';
    }

    throw new Error(describeStatus(response.status, detail));
}

/**
 * Reads the entries of the product navigation. Every logged-in user may call this:
 * the panel is meant to be a directory of internal systems, not a secret.
 */
export async function fetchNavigation(pluginUrl: string): Promise<ProductNavDocument> {
    const response = await fetch(`${pluginUrl}/api/v1/navigation`, {
        method: 'GET',
        credentials: 'include',
        headers: READ_HEADERS,
    });

    if (!response.ok) {
        return fail(response);
    }

    return response.json();
}

/**
 * Replaces the whole navigation with `document`. Restricted to system administrators
 * by the server; the response is the stored (sanitised) version, so the caller can
 * adopt it instead of keeping its own draft.
 *
 * Sent as POST rather than PUT: every other write endpoint of this plugin is a POST,
 * and some reverse proxies sitting in front of Mattermost only let GET and POST
 * through. The server accepts both.
 */
export async function saveNavigation(pluginUrl: string, document: ProductNavDocument): Promise<ProductNavDocument> {
    const response = await fetch(`${pluginUrl}/api/v1/navigation`, {
        method: 'POST',
        credentials: 'include',
        headers: JSON_HEADERS,
        body: JSON.stringify(document),
    });

    if (!response.ok) {
        return fail(response);
    }

    return response.json();
}
