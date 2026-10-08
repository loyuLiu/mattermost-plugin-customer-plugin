// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import {recordCrash} from '../crash_report';

/**
 * Keeps a throw inside this plugin's components from taking the host page down.
 *
 * Every root component this plugin registers renders `null` — they are controllers,
 * not screens — and Mattermost renders them inside its own tree. A throw in one of
 * them therefore unmounts the whole tree, which is what a blank page is: not a
 * plugin that failed to appear, but a page that never finished rendering.
 *
 * The boundary records the error and renders nothing, so the conversation stays up
 * and the error is on screen instead of in a console nobody can open on a phone.
 */
export default class ErrorBoundary extends React.Component<
    {children?: React.ReactNode},
    {failed: boolean}
> {
    constructor(props: {children?: React.ReactNode}) {
        super(props);
        this.state = {failed: false};
    }

    public static getDerivedStateFromError(): {failed: boolean} {
        return {failed: true};
    }

    public componentDidCatch(error: Error, info: React.ErrorInfo): void {
        const where = info && info.componentStack ? info.componentStack.slice(0, 600) : '';
        const withStack: Error = error instanceof Error ? error : new Error(String(error));

        recordCrash(where ? `${withStack.message}\n${where}` : withStack, 'react');
    }

    public render(): React.ReactNode {
        if (this.state.failed) {
            // Invisible on purpose: a controller that failed has nothing to show, and
            // leaving half of one mounted is worse than none of it.
            return null;
        }

        return this.props.children ?? null;
    }
}
