// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/** Shape returned by the plugin's own `GET /api/v1/config` endpoint. */
export type Preset = {
    value: string;
    text: string;
};

/** Channel history visibility settings, served alongside the time settings. */
export type HistorySettings = {
    enabled: boolean;
    mode: 'off' | 'since_join' | 'recent_days';
    noticeEnabled: boolean;
    noticeText: string;
    hideInSearch: boolean;
};

/** Floating timestamp shown while hovering a merged (consecutive) post. */
export type GroupedTimeSettings = {
    enabled: boolean;
    position: 'cursor' | 'left' | 'right';
    hideInline: boolean;
};

/** Dot shown on posts the current user has not read yet. */
export type ReadStatusSettings = {
    enabled: boolean;
};

/** Bulk deletion of messages, from the admin console and from a conversation. */
export type BulkDeleteSettings = {
    enabled: boolean;

    /** Largest batch a single request may delete. */
    maxPosts: number;
};

/** One conversation offered by the admin panel's channel picker. */
export type ChannelOption = {
    id: string;
    name: string;
    displayName: string;
    type: string;
    teamName: string;
};

/** A single post echoed back by a preview or a purge. */
export type BulkPostInfo = {
    id: string;
    createAt: number;
    userId: string;
    message: string;
};

/** Result of a preview (`/posts/query`) or of a deletion. */
export type BulkDeleteResult = {
    channelId: string;
    matched: number;
    deleted: number;
    denied: number;
    failed: number;
    truncated: boolean;
    sample: BulkPostInfo[];
};

export type ServerConfig = {
    enabled: boolean;
    timeFormat: string;
    timeZone: string;
    applyTo: 'post' | 'all';
    allowUserOverride: boolean;
    presets: Preset[];

    /** Absent when talking to an older build of the plugin server. */
    history?: HistorySettings;

    /** Absent when talking to an older build of the plugin server. */
    groupedTime?: GroupedTimeSettings;

    /**
     * Absent when talking to an older build of the plugin server, in which case the
     * marker stays off.
     */
    readStatus?: ReadStatusSettings;

    /** Absent when talking to an older build of the plugin server. */
    bulkDelete?: BulkDeleteSettings;
};

/** Resolved configuration actually used to rewrite the DOM. */
export type EffectiveConfig = {
    enabled: boolean;
    format: string;
    timeZone: string;
    applyTo: 'post' | 'all';
};
