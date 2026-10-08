// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import {safeNavUrl} from '../product_nav';

/**
 * Icon of the product navigation button in the channel header.
 *
 * The button itself is Mattermost's — it is registered through
 * `registerChannelHeaderButtonAction`, so the wrapper, the tooltip and the placement
 * all come from the webapp and only the glyph is ours. The size follows the trash icon
 * of the bulk-delete button (18px, `currentColor`) so the two look like a pair.
 *
 * A custom logo is only used when its address survives `safeNavUrl`: an icon is just
 * another `src`, and this is the same gate the links go through.
 */
const ProductNavIcon = ({iconUrl}: {iconUrl?: string}) => {
    const url = safeNavUrl(iconUrl);

    if (url) {
        return (
            <img
                src={url}
                alt=''
                width={18}
                height={18}
                // How the quieting rules recognise this button; the header button
                // around it is Mattermost's and carries nothing to key off.
                data-cp-glyph='product-nav'
            />
        );
    }

    return (
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
            data-cp-glyph='product-nav'
        >
            <rect x='3' y='3' width='7' height='7' rx='1'/>
            <rect x='14' y='3' width='7' height='7' rx='1'/>
            <rect x='3' y='14' width='7' height='7' rx='1'/>
            <rect x='14' y='14' width='7' height='7' rx='1'/>
        </svg>
    );
};

export default ProductNavIcon;
