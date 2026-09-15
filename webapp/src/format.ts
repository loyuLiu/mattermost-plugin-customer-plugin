// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * A tiny, dependency-free date formatter using dayjs/moment-style tokens, built on
 * top of `Intl.DateTimeFormat` so that localized month / weekday names are handled by
 * the platform instead of by a translation table embedded in the bundle.
 *
 * Supported tokens:
 *   YYYY  2026                    YY  26
 *   MMMM  September               MMM Sep         MM 09       M 9
 *   DD    15                      D  15
 *   dddd  Tuesday                 ddd Tue
 *   HH    09 (24h, zero padded)   H  9
 *   hh    09 (12h, zero padded)   h  9
 *   mm / m minutes                ss / s seconds  SSS milliseconds
 *   A     AM/PM                   a  am/pm
 *   Z     +0800                   ZZ  +08:00
 *   X     unix seconds            x  unix milliseconds
 *   [text] literal text, e.g. [ 年 ]
 */

export type Formatter = (date: Date) => string;

type Parts = {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    millisecond: number;
};

const TOKEN_RE = /\[([^\]]*)\]|(Y{2,4}|M{1,4}|D{1,2}|d{1,4}|H{1,2}|h{1,2}|m{1,2}|s{1,2}|S{1,3}|Z{1,2}|A|a|X|x)/g;

function pad(value: number, length = 2): string {
    return String(Math.abs(value)).padStart(length, '0');
}

function normalizeOptions(timeZone?: string): Intl.DateTimeFormatOptions {
    const options: Intl.DateTimeFormatOptions = {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    };

    if (timeZone) {
        options.timeZone = timeZone;
    }

    return options;
}

/** Returns true when the browser accepts the given IANA timezone. */
export function isValidTimeZone(timeZone: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', {timeZone});
        return true;
    } catch {
        return false;
    }
}

/**
 * Creates a formatter for the given format string.
 *
 * If `timeZone` is invalid it is ignored (the browser timezone is used instead).
 */
export function createFormatter(format: string, locale: string, timeZone?: string): Formatter {
    const zone = timeZone && isValidTimeZone(timeZone) ? timeZone : undefined;

    const numericFormat = new Intl.DateTimeFormat(locale, normalizeOptions(zone));
    const monthLongFormat = new Intl.DateTimeFormat(locale, {month: 'long', timeZone: zone});
    const monthShortFormat = new Intl.DateTimeFormat(locale, {month: 'short', timeZone: zone});
    const weekdayLongFormat = new Intl.DateTimeFormat(locale, {weekday: 'long', timeZone: zone});
    const weekdayShortFormat = new Intl.DateTimeFormat(locale, {weekday: 'short', timeZone: zone});

    const partsCache = new Map<number, Parts>();

    const getParts = (date: Date): Parts => {
        const key = date.getTime();
        const cached = partsCache.get(key);
        if (cached) {
            return cached;
        }

        const raw = numericFormat.formatToParts(date);
        const values: Record<string, number> = {};
        for (const part of raw) {
            if (part.type !== 'literal') {
                values[part.type] = parseInt(part.value, 10);
            }
        }

        // Some engines return 24 instead of 00 at midnight; Intl already handles it in
        // modern browsers, this keeps older ones honest.
        const hour = values.hour === 24 ? 0 : (values.hour ?? date.getHours());

        const parts: Parts = {
            year: values.year ?? date.getFullYear(),
            month: values.month ?? date.getMonth() + 1,
            day: values.day ?? date.getDate(),
            hour,
            minute: values.minute ?? date.getMinutes(),
            second: values.second ?? date.getSeconds(),
            millisecond: date.getMilliseconds(),
        };

        if (partsCache.size > 512) {
            partsCache.clear();
        }
        partsCache.set(key, parts);

        return parts;
    };

    const offsetMinutes = (date: Date): number => {
        if (!zone) {
            return -date.getTimezoneOffset();
        }

        const p = getParts(date);
        const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);

        return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000);
    };

    return (date: Date): string => {
        const p = getParts(date);
        const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
        const meridiems = p.hour < 12 ? ['AM', 'am'] : ['PM', 'pm'];

        return format.replace(TOKEN_RE, (match: string, literal?: string): string => {
            if (literal !== undefined) {
                return literal;
            }

            switch (match) {
            case 'YYYY':
                return String(p.year);
            case 'YY':
                return pad(p.year % 100);
            case 'MMMM':
                return monthLongFormat.format(date);
            case 'MMM':
                return monthShortFormat.format(date);
            case 'MM':
                return pad(p.month);
            case 'M':
                return String(p.month);
            case 'DD':
                return pad(p.day);
            case 'D':
                return String(p.day);
            case 'dddd':
                return weekdayLongFormat.format(date);
            case 'ddd':
            case 'dd':
                return weekdayShortFormat.format(date);
            case 'HH':
                return pad(p.hour);
            case 'H':
                return String(p.hour);
            case 'hh':
                return pad(hour12);
            case 'h':
                return String(hour12);
            case 'mm':
                return pad(p.minute);
            case 'm':
                return String(p.minute);
            case 'ss':
                return pad(p.second);
            case 's':
                return String(p.second);
            case 'SSS':
                return pad(p.millisecond, 3);
            case 'A':
                return meridiems[0];
            case 'a':
                return meridiems[1];
            case 'Z':
            case 'ZZ': {
                const total = offsetMinutes(date);
                const sign = total >= 0 ? '+' : '-';
                const abs = Math.abs(total);
                const hh = pad(Math.floor(abs / 60));
                const mi = pad(abs % 60);
                return match === 'ZZ' ? `${sign}${hh}:${mi}` : `${sign}${hh}${mi}`;
            }
            case 'X':
                return String(Math.floor(date.getTime() / 1000));
            case 'x':
                return String(date.getTime());
            default:
                return match;
            }
        });
    };
}
