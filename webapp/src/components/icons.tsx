// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

/**
 * Trash can used by the channel header button that opens the bulk delete mode.
 *
 * The path is inlined rather than taken from the webapp's icon font: a plugin cannot
 * rely on which icon package the server happens to ship, and an inline SVG also follows
 * the button's own colour through `currentColor`.
 */
const TrashIcon = () => (
    <svg
        width='18'
        height='18'
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
        aria-hidden='true'
        focusable='false'
    >
        <path d='M3 6h18'/>
        <path d='M8 6V4h8v2'/>
        <path d='M19 6l-1 14H6L5 6'/>
        <path d='M10 11v6'/>
        <path d='M14 11v6'/>
    </svg>
);

export default TrashIcon;
