// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useSelector} from 'react-redux';

import type {GlobalState} from '@mattermost/types/store';

import {deletePosts} from '../bulk_delete_api';
import {getPluginUrl} from '../base_url';
import {
    BulkSelectEngine,
    getBulkSelectState,
    setBulkSelectActive,
    setBulkSelection,
    subscribeBulkSelect,
} from '../bulk_select';
import type {BulkSelectState} from '../bulk_select';
import {useServerConfig} from '../hooks';
import {resolveBulkDelete} from '../resolve';

const BAR_STYLE: React.CSSProperties = {
    position: 'fixed',
    bottom: '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 16px',
    borderRadius: '8px',
    background: 'var(--center-channel-bg,#ffffff)',
    color: 'var(--center-channel-color,#3f4350)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.24)',
    fontSize: '14px',
};

/**
 * Floating toolbar of the selection mode.
 *
 * It owns the engine: the engine is started while the mode is on and torn down when it
 * ends, which also removes every tick box and outline it added.
 */
const BulkDeleteBar = () => {
    const pluginUrl = useSelector((state: GlobalState) => getPluginUrl(state));
    const serverConfig = useServerConfig();
    const enabled = resolveBulkDelete(serverConfig).enabled;

    const [state, setState] = useState<BulkSelectState>(getBulkSelectState());
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');

    const engine = useRef<BulkSelectEngine | null>(null);

    useEffect(() => subscribeBulkSelect(setState), []);

    useEffect(() => {
        if (!enabled || !state.active) {
            engine.current?.stop();
            engine.current = null;
            return undefined;
        }

        const instance = new BulkSelectEngine((selected) => setBulkSelection(selected));
        engine.current = instance;
        instance.start();

        return () => {
            instance.stop();
            engine.current = null;
        };
    }, [enabled, state.active]);

    const removeSelected = useCallback(() => {
        const ids = getBulkSelectState().selected;
        if (ids.length === 0) {
            return;
        }

        if (!window.confirm(`确认删除选中的 ${ids.length} 条消息？此操作不可恢复。`)) {
            return;
        }

        setBusy(true);
        setNotice('');

        deletePosts(pluginUrl, ids).then((result) => {
            const parts = [`已删除 ${result.deleted} 条`];
            if (result.denied > 0) {
                parts.push(`${result.denied} 条无权限`);
            }
            if (result.failed > 0) {
                parts.push(`${result.failed} 条失败`);
            }

            setNotice(parts.join('，'));

            engine.current?.clearSelection();
            setBulkSelection([]);
        }).catch((error: Error) => {
            setNotice(error.message || '删除失败');
        }).finally(() => setBusy(false));
    }, [pluginUrl]);

    if (!enabled || !state.active) {
        return null;
    }

    return (
        <div style={BAR_STYLE}>
            <span>{`已选择 ${state.selected.length} 条消息`}</span>

            <button
                className='btn btn-xs btn-tertiary'
                onClick={() => engine.current?.selectAll()}
            >
                {'全选当前页'}
            </button>

            <button
                className='btn btn-xs btn-tertiary'
                onClick={() => {
                    engine.current?.clearSelection();
                    setBulkSelection([]);
                }}
            >
                {'清空'}
            </button>

            <button
                className='btn btn-xs btn-danger'
                disabled={busy || state.selected.length === 0}
                onClick={removeSelected}
            >
                {'删除选中'}
            </button>

            <button
                className='btn btn-xs btn-tertiary'
                onClick={() => setBulkSelectActive(false)}
            >
                {'退出'}
            </button>

            {notice && <span>{notice}</span>}
        </div>
    );
};

export default BulkDeleteBar;
