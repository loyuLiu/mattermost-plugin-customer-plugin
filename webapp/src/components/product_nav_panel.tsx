// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {useSelector} from 'react-redux';

import type {GlobalState} from '@mattermost/types/store';

import {getPluginUrl} from '../base_url';
import {DEFAULT_PRODUCT_NAV_LINKS_PER_ROW} from '../constants';
import {useServerConfig} from '../hooks';
import {collectNavProblems, countUsableNavLinks, normalizeNavDocument} from '../product_nav';
import {fetchNavigation, saveNavigation} from '../product_nav_api';
import {resolveProductNav} from '../resolve';
import type {NavCategory, NavLink} from '../types/config';

/** Local ids only need to be unique within one editing session. */
let idSeq = 0;
function newId(prefix: string): string {
    idSeq += 1;
    return `${prefix}-${Date.now().toString(36)}-${idSeq}`;
}

function emptyLink(): NavLink {
    return {id: newId('link'), name: '', url: '', iconUrl: ''};
}

function emptyCategory(): NavCategory {
    return {id: newId('cat'), name: '', links: [emptyLink()]};
}

const blockStyle: React.CSSProperties = {
    marginBottom: '12px',
    padding: '10px 12px',
    border: '1px solid rgba(var(--center-channel-color-rgb,63,67,80),0.16)',
    borderRadius: '6px',
};

const inputStyle: React.CSSProperties = {
    padding: '6px 8px',
    maxWidth: '420px',
    width: '100%',
    marginBottom: '6px',
};

const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
};

const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '12px',
    minWidth: '72px',
};

/**
 * System console panel: the entries of the product navigation.
 *
 * Categories and links are edited in place and saved as one document — the server
 * replaces what it has with what is sent, so a removed row really is removed. Because
 * the server sanitises on the way in (dropping `javascript:` targets, unbounded names
 * and anything past the limits), the saved response is adopted instead of the draft,
 * so what the administrator sees afterwards is exactly what the users get.
 */
const ProductNavPanel = () => {
    const pluginUrl = useSelector((state: GlobalState) => getPluginUrl(state));
    const serverConfig = useServerConfig();
    const settings = useMemo(() => resolveProductNav(serverConfig), [serverConfig]);

    const [categories, setCategories] = useState<NavCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    useEffect(() => {
        fetchNavigation(pluginUrl).then((doc) => {
            setCategories(normalizeNavDocument(doc));
            setLoadFailed(false);
            setError('');
        }).catch((err: Error) => {
            setLoadFailed(true);
            setError(err.message || '导航数据加载失败，请刷新页面重试。');
        }).finally(() => setLoading(false));
    }, [pluginUrl]);

    const patchCategory = useCallback((id: string, patch: Partial<NavCategory>) => {
        setCategories((current) => current.map((category) => (
            category.id === id ? {...category, ...patch} : category
        )));
    }, []);

    const patchLink = useCallback((categoryId: string, linkId: string, patch: Partial<NavLink>) => {
        setCategories((current) => current.map((category) => {
            if (category.id !== categoryId) {
                return category;
            }

            return {
                ...category,
                links: (category.links || []).map((link) => (link.id === linkId ? {...link, ...patch} : link)),
            };
        }));
    }, []);

    const moveCategory = useCallback((index: number, delta: number) => {
        setCategories((current) => {
            const target = index + delta;
            if (target < 0 || target >= current.length) {
                return current;
            }

            const next = [...current];
            const [moved] = next.splice(index, 1);
            next.splice(target, 0, moved);

            return next;
        });
    }, []);

    const runSave = useCallback(() => {
        setError('');
        setNotice('');

        // Refuse before sending when something would be dropped on arrival: saving and
        // silently losing a row is worse than saying which row is wrong.
        const problems = collectNavProblems(categories);
        if (problems.length > 0) {
            setError('以下内容保存后会被丢弃，请修正后再保存：' + problems.join('；'));
            return;
        }

        // A navigation without a single usable link is never shown, so it is worth
        // saying so instead of saving something invisible.
        if (countUsableNavLinks(categories) === 0) {
            setNotice('');
            setError('还没有任何可用的链接：每个分类至少要有一条「名称 + 以 https:// 开头的地址」都填好的链接，否则用户端不会显示导航按钮。');
            return;
        }

        setSaving(true);

        const submitted = countUsableNavLinks(categories);

        saveNavigation(pluginUrl, {categories}).then((saved) => {
            setCategories(normalizeNavDocument(saved));

            const kept = countUsableNavLinks(saved.categories || []);
            setNotice('已保存，用户端刷新页面后生效。' + (
                kept < submitted ? `（有 ${submitted - kept} 条链接因名称或地址不可用被服务端丢弃）` : ''
            ));
        }).catch((err: Error) => {
            setError(err.message || '保存失败');
        }).finally(() => setSaving(false));
    }, [pluginUrl, categories]);

    if (loading) {
        return <div><p>{'正在加载导航数据…'}</p></div>;
    }

    return (
        <div>
            <p>
                {'在此维护右上角「产品导航」按钮里的分类与网站链接。每个分类可添加多个链接，链接的 logo 填图片 URL（留空则显示名称首字）。保存后用户端刷新页面即可看到。'}
            </p>

            <p style={{color: 'rgba(var(--center-channel-color-rgb,63,67,80),0.75)'}}>
                {`当前每个分类一行显示 ${settings.linksPerRow ?? DEFAULT_PRODUCT_NAV_LINKS_PER_ROW} 个链接，可在上方「每行显示的链接数」中修改（1–12，面板宽度会自动跟着调整）。`}
            </p>

            {!settings.enabled && (
                <p style={{color: 'var(--error-text, #d24b4e)'}}>
                    {'产品导航当前处于关闭状态。请先开启「启用产品导航」并保存设置，否则用户端不会显示按钮。'}
                </p>
            )}

            {categories.length === 0 && (
                <p style={{color: 'rgba(var(--center-channel-color-rgb,63,67,80),0.75)'}}>
                    {'还没有任何分类，点击下方「添加分类」开始。'}
                </p>
            )}

            {categories.map((category, index) => (
                <div
                    key={category.id}
                    style={blockStyle}
                >
                    <div style={rowStyle}>
                        <span style={labelStyle}>{'分类名称'}</span>
                        <input
                            style={{...inputStyle, marginBottom: 0, flex: '1 1 240px'}}
                            value={category.name}
                            placeholder='例如 内部系统'
                            onChange={(event) => patchCategory(category.id, {name: event.target.value})}
                        />
                        <button
                            className='btn btn-xs btn-tertiary'
                            disabled={index === 0}
                            onClick={() => moveCategory(index, -1)}
                        >
                            {'上移'}
                        </button>
                        <button
                            className='btn btn-xs btn-tertiary'
                            disabled={index === categories.length - 1}
                            onClick={() => moveCategory(index, 1)}
                        >
                            {'下移'}
                        </button>
                        <button
                            className='btn btn-xs btn-danger'
                            onClick={() => setCategories((current) => current.filter((item) => item.id !== category.id))}
                        >
                            {'删除分类'}
                        </button>
                    </div>

                    {(category.links || []).map((link) => (
                        <div
                            key={link.id}
                            style={{...rowStyle, marginTop: '8px'}}
                        >
                            <input
                                style={{...inputStyle, marginBottom: 0, flex: '1 1 160px', maxWidth: '200px'}}
                                value={link.name}
                                placeholder='名称，如 工单系统'
                                onChange={(event) => patchLink(category.id, link.id, {name: event.target.value})}
                            />
                            <input
                                style={{...inputStyle, marginBottom: 0, flex: '2 1 260px', maxWidth: '420px'}}
                                value={link.url}
                                placeholder='https://example.com'
                                onChange={(event) => patchLink(category.id, link.id, {url: event.target.value})}
                            />
                            <input
                                style={{...inputStyle, marginBottom: 0, flex: '2 1 220px', maxWidth: '360px'}}
                                value={link.iconUrl || ''}
                                placeholder='logo 图片 URL（可留空）'
                                onChange={(event) => patchLink(category.id, link.id, {iconUrl: event.target.value})}
                            />
                            <button
                                className='btn btn-xs btn-tertiary'
                                onClick={() => patchCategory(category.id, {
                                    links: (category.links || []).filter((item) => item.id !== link.id),
                                })}
                            >
                                {'删除'}
                            </button>
                        </div>
                    ))}

                    <button
                        className='btn btn-xs btn-tertiary'
                        style={{marginTop: '8px'}}
                        onClick={() => patchCategory(category.id, {links: [...(category.links || []), emptyLink()]})}
                    >
                        {'+ 添加链接'}
                    </button>
                </div>
            ))}

            <div style={{marginTop: '12px'}}>
                <button
                    className='btn btn-tertiary'
                    style={{marginRight: '8px'}}
                    onClick={() => setCategories((current) => [...current, emptyCategory()])}
                >
                    {'+ 添加分类'}
                </button>

                <button
                    className='btn btn-primary'
                    disabled={saving || loadFailed}
                    title={loadFailed ? '导航数据加载失败，无法保存' : ''}
                    onClick={runSave}
                >
                    {'保存'}
                </button>

                <button
                    className='btn btn-tertiary'
                    style={{marginLeft: '8px'}}
                    disabled={saving || loading}
                    onClick={() => {
                        setLoading(true);
                        setLoadFailed(false);
                        setError('');
                        setNotice('');
                        fetchNavigation(pluginUrl).then((doc) => {
                            setCategories(normalizeNavDocument(doc));
                        }).catch((err: Error) => {
                            setLoadFailed(true);
                            setError(err.message || '导航数据加载失败。');
                        }).finally(() => setLoading(false));
                    }}
                >
                    {'重新加载'}
                </button>
            </div>

            {notice && <p style={{marginTop: '8px'}}>{notice}</p>}
            {error && <p style={{marginTop: '8px', color: 'var(--error-text, #d24b4e)'}}>{error}</p>}
        </div>
    );
};

export default ProductNavPanel;
