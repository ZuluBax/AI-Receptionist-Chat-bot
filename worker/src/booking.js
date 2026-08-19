/**
 * Rule-based availability & booking for the Shaka Plumbing demo.
 *
 * Deliberately NOT delegated to the model: "book an impossible appointment"
 * is one of the named adversarial test cases, so every constraint here is
 * enforced in code and the LLM only ever relays what these functions return.
 *
 * How far ahead customers can book (30/60/90 days) is a per-deployment
 * business choice, not a code change — set BOOKING_HORIZON_DAYS in
 * worker/wrangler.toml.
 */

import { BUSINESS_HOURS } from './businessConfig.js';

const ALLOWED_BOOKING_HORIZONS_DAYS = [30, 60, 90];
const DEFAULT_BOOKING_HORIZON_DAYS = 30;

/** How far ahead this business currently accepts bookings — set per-deployment via wrangler.toml. */
function getBookingHorizonDays(env) {
    const configured = Number(env.BOOKING_HORIZON_DAYS);
    return ALLOWED_BOOKING_HORIZONS_DAYS.includes(configured) ? configured : DEFAULT_BOOKING_HORIZON_DAYS;
}

/** One-hour slot start times for a weekday, derived from businessConfig.js — e.g. [8,18] -> [8,9,...,17]. */
function slotHoursForDay(day) {
    const hours = BUSINESS_HOURS[day];
    if (!hours) return null;
    const [open, close] = hours;
    return Array.from({ length: close - open }, (_, i) => open + i);
}

function parseDate(dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return null;
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    // Reject invalid calendar dates (e.g. 2026-02-30 rolling over to March)
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
    return date;
}

function todayUtc() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Deterministic pseudo-random fake bookings so the calendar feels realistically partial. */
function fakeTakenHours(dateStr, hours) {
    let hash = 0;
    for (let i = 0; i < dateStr.length; i++) hash = (hash * 31 + dateStr.charCodeAt(i)) >>> 0;
    const takenCount = hash % 3; // 0, 1 or 2 slots pre-taken
    const taken = new Set();
    for (let i = 0; i < takenCount; i++) {
        taken.add(hours[(hash + i * 7) % hours.length]);
    }
    return taken;
}

function formatSlot(hour) {
    return `${String(hour).padStart(2, '0')}:00`;
}

/**
 * Returns { open: bool, date, slots: string[], reason?: string }
 * `slots` is the list of still-bookable HH:00 times for that date.
 */
export async function getDayAvailability(dateStr, env) {
    const date = parseDate(dateStr);
    if (!date) return { open: false, date: dateStr, slots: [], reason: 'invalid_date' };

    const horizonDays = getBookingHorizonDays(env);
    const today = todayUtc();
    const diffDays = Math.round((date - today) / 86400000);
    if (diffDays < 0) return { open: false, date: dateStr, slots: [], reason: 'in_the_past' };
    if (diffDays > horizonDays) {
        return { open: false, date: dateStr, slots: [], reason: `too_far_ahead_max_${horizonDays}_days` };
    }

    const hours = slotHoursForDay(date.getUTCDay());
    if (!hours) return { open: false, date: dateStr, slots: [], reason: 'closed_on_this_day' };

    const taken = fakeTakenHours(dateStr, hours);

    const realBookedRaw = await env.SHAKA_KV.get(`bookings:${dateStr}`);
    const realBooked = new Set(realBookedRaw ? JSON.parse(realBookedRaw) : []);

    let candidateHours = hours;
    if (diffDays === 0) {
        const nowHourLondonish = new Date().getUTCHours(); // approximation; good enough for a demo
        candidateHours = hours.filter((h) => h > nowHourLondonish);
    }

    const slots = candidateHours
        .filter((h) => !taken.has(h) && !realBooked.has(formatSlot(h)))
        .map(formatSlot);

    return { open: true, date: dateStr, slots };
}

/**
 * Validates and (if valid) persists a booking. Returns:
 *   { booked: true, date, time, reference }
 *   { booked: false, reason: string }
 */
export async function bookSlot({ date: dateStr, time, name, phone, email, postcode, problem }, env) {
    if (!name || !phone || !email || !postcode || !problem) {
        return { booked: false, reason: 'missing_customer_details' };
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) return { booked: false, reason: 'invalid_email' };
    if (phone.replace(/[^0-9]/g, '').length < 7) return { booked: false, reason: 'invalid_phone' };
    if (!/^([01]\d|2[0-3]):00$/.test(time || '')) return { booked: false, reason: 'invalid_time_format' };

    const availability = await getDayAvailability(dateStr, env);
    if (!availability.open) return { booked: false, reason: availability.reason };
    if (!availability.slots.includes(time)) return { booked: false, reason: 'slot_not_available' };

    const key = `bookings:${dateStr}`;
    const existingRaw = await env.SHAKA_KV.get(key);
    const existing = existingRaw ? JSON.parse(existingRaw) : [];
    existing.push(time);
    const horizonDays = getBookingHorizonDays(env);
    await env.SHAKA_KV.put(key, JSON.stringify(existing), { expirationTtl: 60 * 60 * 24 * (horizonDays + 2) });

    const reference = `SP-${dateStr.replace(/-/g, '')}-${time.replace(':', '')}`;
    return { booked: true, date: dateStr, time, reference };
}
