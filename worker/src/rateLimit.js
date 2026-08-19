/**
 * KV-backed abuse/cost guards. All best-effort — KV is eventually consistent,
 * which is fine here: this is a demo used by one testing team for a week,
 * not a production rate limiter defending against a real attacker.
 */

export async function checkIpRateLimit(env, ip) {
    const windowMinutes = Number(env.RATE_LIMIT_WINDOW_MINUTES || 60);
    const maxRequests = Number(env.RATE_LIMIT_MAX_REQUESTS || 100);
    const bucket = Math.floor(Date.now() / (windowMinutes * 60 * 1000));
    const key = `rl:${ip}:${bucket}`;

    const currentRaw = await env.SHAKA_KV.get(key);
    const current = currentRaw ? Number(currentRaw) : 0;
    if (current >= maxRequests) {
        return { allowed: false, reason: `Rate limit exceeded: ${maxRequests} requests per ${windowMinutes} minutes.` };
    }
    await env.SHAKA_KV.put(key, String(current + 1), { expirationTtl: windowMinutes * 60 + 60 });
    return { allowed: true };
}

/**
 * Circuit breaker on total tokens processed per day, not dollars — this
 * codebase doesn't assume any particular provider's pricing. Point whatever
 * external cost dashboard you're using (e.g. the OpenAI usage API) at the
 * `[usage]` log lines from index.js if you want $-denominated tracking.
 */
export async function checkDailyTokenCap(env) {
    const cap = Number(env.DAILY_TOKEN_CAP || 2_000_000);
    const day = new Date().toISOString().slice(0, 10);
    const key = `tokens:${day}`;
    const currentRaw = await env.SHAKA_KV.get(key);
    const current = currentRaw ? Number(currentRaw) : 0;
    if (current >= cap) {
        return { allowed: false, tokensToday: current, cap };
    }
    return { allowed: true, tokensToday: current, cap };
}

export async function recordUsage(env, tokens) {
    const day = new Date().toISOString().slice(0, 10);
    const key = `tokens:${day}`;
    const currentRaw = await env.SHAKA_KV.get(key);
    const current = currentRaw ? Number(currentRaw) : 0;
    const next = current + tokens;
    await env.SHAKA_KV.put(key, String(next), { expirationTtl: 60 * 60 * 24 * 3 });
    return next;
}
