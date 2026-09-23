// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {useSelector} from 'react-redux';

import type {GlobalState} from '@mattermost/types/store';

import {getPluginUrl} from '../base_url';
import {useServerConfig} from '../hooks';
import {listChannels, previewPurge, purgePosts} from '../bulk_delete_api';
import {resolveBulkDelete} from '../resolve';
import type {BulkDeleteResult, ChannelOption} from '../types/config';

/** Converts the value of a `datetime-local` input to milliseconds, 0 when empty. */
function toMillis(value: string): number {
    if (!value) {
        return 0;
    }

    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
}

const inputStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: '8px',
    padding: '6px 8px',
    maxWidth: '420px',
    width: '100%',
};

/**
 * Admin console panel: deletes messages of one conversation by filter.
 *
 * Because deletion cannot be undone, the panel always previews first and only then
 * offers to remove exactly what was counted. The server re-checks the permission for
 * every post, so posts the administrator may not delete are reported as denied instead
 * of silently dropped.
 */
const BulkDeletePanel = () => {
    const pluginUrl = useSelector((state: GlobalState) => getPluginUrl(state));
    const serverConfig = useServerConfig();
    const settings = useMemo(() => resolveBulkDelete(serverConfig), [serverConfig]);

    const [channels, setChannels] = useState<ChannelOption[]>([]);
    const [channelId, setChannelId] = useState('');
    const [userId, setUserId] = useState('');
    const [keyword, setKeyword] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState<BulkDeleteResult | null>(null);
    const [confirming, setConfirming] = useState(false);

    useEffect(() => {
        listChannels(pluginUrl).then(setChannels).catch(() => {
            setError('会话列表加载失败，请刷新页面重试。');
        });
    }, [pluginUrl]);

    const filter = useCallback(() => ({
        channelId,
        userId,
        keyword,
        timeFrom: toMillis(from),
        timeTo: toMillis(to),
    }), [channelId, userId, keyword, from, to]);

    const runPreview = () => {
        setBusy(true);
        setError('');
        setResult(null);
        setConfirming(false);

        previewPurge(pluginUrl, filter()).then(setResult).catch((err: Error) => {
            setError(err.message || '预览失败');
        }).finally(() => setBusy(false));
    };

    const runPurge = () => {
        setBusy(true);
        setError('');

        purgePosts(pluginUrl, filter()).then(setResult).catch((err: Error) => {
            setError(err.message || '删除失败');
        }).finally(() => {
            setBusy(false);
            setConfirming(false);
        });
    };

    if (!settings.enabled) {
        return (
            <div>
                <p>{'批量删除当前处于关闭状态。请先在上方开启「启用批量删除消息」并保存设置。'}</p>
            </div>
        );
    }

    return (
        <div>
            <p>{'按条件删除某个会话中的消息。删除不可恢复，请先用「预览」确认数量。单次上限 ' + settings.maxPosts + ' 条。'}</p>

            <div style={inputStyle}>
                <label>{'会话'}</label>
                <select
                    value={channelId}
                    onChange={(event) => setChannelId(event.target.value)}
                    style={{padding: '6px 8px', maxWidth: '420px', width: '100%'}}
                >
                    <option value=''>{'— 请选择 —'}</option>
                    {channels.map((channel) => (
                        <option
                            key={channel.id}
                            value={channel.id}
                        >
                            {channel.displayName || channel.name}
                        </option>
                    ))}
                </select>
            </div>

            <label>{'发送者（用户 ID，可留空表示所有人）'}</label>
            <input
                style={inputStyle}
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                placeholder='例如 ktx9gp3xzpg3qd4x8z5jmbwr4y'
            />

            <label>{'关键词（可留空）'}</label>
            <input
                style={inputStyle}
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
            />

            <label>{'起始时间（可留空）'}</label>
            <input
                style={inputStyle}
                type='datetime-local'
                value={from}
                onChange={(event) => setFrom(event.target.value)}
            />

            <label>{'结束时间（可留空）'}</label>
            <input
                style={inputStyle}
                type='datetime-local'
                value={to}
                onChange={(event) => setTo(event.target.value)}
            />

            <button
                className='btn btn-primary'
                style={{marginRight: '8px'}}
                disabled={busy || !channelId}
                onClick={runPreview}
            >
                {'预览'}
            </button>

            {result && result.matched > 0 && !confirming && (
                <button
                    className='btn btn-danger'
                    disabled={busy}
                    onClick={() => setConfirming(true)}
                >
                    {'删除 ' + result.matched + ' 条'}
                </button>
            )}

            {confirming && (
                <div style={{marginTop: '8px'}}>
                    <span style={{marginRight: '8px', color: 'var(--error-text, #d24b4e)'}}>
                        {'确认删除 ' + result?.matched + ' 条消息？此操作不可恢复。'}
                    </span>
                    <button
                        className='btn btn-danger'
                        style={{marginRight: '8px'}}
                        disabled={busy}
                        onClick={runPurge}
                    >
                        {'确认删除'}
                    </button>
                    <button
                        className='btn btn-tertiary'
                        onClick={() => setConfirming(false)}
                    >
                        {'取消'}
                    </button>
                </div>
            )}

            {error && <p style={{color: 'var(--error-text, #d24b4e)'}}>{error}</p>}

            {result && (
                <div style={{marginTop: '12px'}}>
                    <p>
                        {'匹配 ' + result.matched + ' 条'}
                        {result.deleted > 0 && '，已删除 ' + result.deleted + ' 条'}
                        {result.denied > 0 && '，无权限 ' + result.denied + ' 条'}
                        {result.failed > 0 && '，失败 ' + result.failed + ' 条'}
                        {result.truncated && '（已达单次上限，可能还有更多）'}
                    </p>

                    {result.sample.length > 0 && (
                        <ul style={{maxHeight: '240px', overflowY: 'auto'}}>
                            {result.sample.map((post) => (
                                <li key={post.id}>
                                    {new Date(post.createAt).toLocaleString() + ' · ' + post.message}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

        </div>
    );
};

export default BulkDeletePanel;
