// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {BulkDeleteResult, ChannelOption} from './types/config';

/**
 * Conditions selecting the messages to remove. Every field is optional; an empty
 * filter matches every message of the conversation.
 */
export type BulkFilter = {
    channelId: string;

    /** Author of the messages. */
    userId?: string;

    /** Substring of the message text, matched case-insensitively. */
    keyword?: string;

    /** Creation time bounds, in milliseconds. Zero or omitted means open. */
    timeFrom?: number;
    timeTo?: number;
};

type BulkRequestBody = BulkFilter & {
    /** Explicit selection made in the channel UI; overrides the filter. */
    postIds?: string[];

    limit?: number;
};

async function post(url: string, body: BulkRequestBody | {postIds: string[]}): Promise<BulkDeleteResult> {
    const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw new Error(`bulk delete failed: ${response.status}`);
    }

    return response.json();
}

/** Counts what a purge would delete, without touching anything. */
export function previewPurge(pluginUrl: string, filter: BulkFilter): Promise<BulkDeleteResult> {
    return post(`${pluginUrl}/api/v1/posts/query`, filter);
}

/** Deletes the messages matching the filter. */
export function purgePosts(pluginUrl: string, filter: BulkFilter): Promise<BulkDeleteResult> {
    return post(`${pluginUrl}/api/v1/posts/purge`, filter);
}

/** Deletes exactly the messages the user ticked in the channel. */
export function deletePosts(pluginUrl: string, postIds: string[]): Promise<BulkDeleteResult> {
    return post(`${pluginUrl}/api/v1/posts/delete`, {postIds});
}

/** Conversations the current user can see, for the admin panel's picker. */
export async function listChannels(pluginUrl: string): Promise<ChannelOption[]> {
    const response = await fetch(`${pluginUrl}/api/v1/channels`, {
        method: 'GET',
        credentials: 'include',
        headers: {'X-Requested-With': 'XMLHttpRequest'},
    });

    if (!response.ok) {
        throw new Error(`failed to load channels: ${response.status}`);
    }

    return response.json();
}
