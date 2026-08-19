/**
 * Per-business opening hours — edit this before deploying for a given customer.
 * Every business gets its own Worker deployment, so this file (not an env var)
 * is the natural place for a schedule that can be genuinely asymmetric —
 * different open/close times on different days, or closed entirely on some.
 *
 * Key: 0=Sunday, 1=Monday, ... 6=Saturday.
 * Value: either `null` (closed all day) or `[openHour, closeHour]` in 24h
 * time, where closeHour is exclusive — e.g. `[8, 18]` means the last
 * one-hour appointment slot starts at 17:00 and the day closes at 18:00.
 */
export const BUSINESS_HOURS = {
    0: null,
    1: [8, 18],
    2: [8, 18],
    3: [8, 18],
    4: [8, 18],
    5: [8, 18],
    6: [9, 13],
};

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday-first, matches how people read a weekly schedule
const DAY_NAMES = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };

function formatHour12(hour) {
    const period = hour >= 12 ? 'pm' : 'am';
    const h12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${h12}${period}`;
}

function rangeLabel(hours) {
    return hours ? `${formatHour12(hours[0])}-${formatHour12(hours[1])}` : 'Closed';
}

function sameHours(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    return a[0] === b[0] && a[1] === b[1];
}

/**
 * Human-readable summary for the system prompt, e.g.
 * "Mon-Fri 8am-6pm, Sat 9am-1pm, Sun Closed" — groups consecutive days that
 * share identical hours so an asymmetric schedule still reads naturally.
 */
export function formatBusinessHoursSummary() {
    const groups = [];
    for (const day of DAY_ORDER) {
        const hours = BUSINESS_HOURS[day];
        const last = groups[groups.length - 1];
        if (last && sameHours(last.hours, hours)) {
            last.days.push(day);
        } else {
            groups.push({ hours, days: [day] });
        }
    }
    return groups
        .map((g) => {
            const label = g.days.length > 1
                ? `${DAY_NAMES[g.days[0]]}-${DAY_NAMES[g.days[g.days.length - 1]]}`
                : DAY_NAMES[g.days[0]];
            return `${label} ${rangeLabel(g.hours)}`;
        })
        .join(', ');
}
