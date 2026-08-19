import { SYSTEM_PROMPT, TOOLS, flagSuspicious } from './systemPrompt.js';
import { getDayAvailability, bookSlot } from './booking.js';
import { checkIpRateLimit, checkDailyTokenCap, recordUsage } from './rateLimit.js';
import { sumUsage, newUsageTotals, totalTokens } from './usage.js';

const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOOL_ROUNDS = 3;
const MAX_MESSAGES = 40; // ~20 exchanges per conversation
const MAX_MESSAGE_CHARS = 2000;
const FALLBACK_REPLY = "Sorry, I'm having trouble finishing that — let me get a member of the team to call you back instead. Could you leave your name and phone number?";

function corsHeaders(env) {
    return {
        'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}

function jsonResponse(body, status, env) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
    });
}

async function callClaude(env, messages) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
            model: env.MODEL || 'claude-haiku-4-5',
            max_tokens: 1024,
            system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
            tools: TOOLS,
            messages,
        }),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Anthropic API error ${res.status}: ${errText}`);
    }
    return res.json();
}

async function executeTool(name, input, env) {
    if (name === 'check_availability') return getDayAvailability(input.date, env);
    if (name === 'book_appointment') return bookSlot(input, env);
    return { error: `unknown_tool:${name}` };
}

async function runConversation(env, messages) {
    const usageTotals = newUsageTotals();
    let working = messages;

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const response = await callClaude(env, working);
        sumUsage(usageTotals, response.usage || {});

        if (response.stop_reason !== 'tool_use') {
            const text = (response.content || [])
                .filter((b) => b.type === 'text')
                .map((b) => b.text)
                .join('\n\n');
            const finalMessages = [...working, { role: 'assistant', content: response.content }];
            return { reply: text || FALLBACK_REPLY, usageTotals, messages: finalMessages };
        }

        if (round === MAX_TOOL_ROUNDS) {
            const finalMessages = [...working, { role: 'assistant', content: FALLBACK_REPLY }];
            return { reply: FALLBACK_REPLY, usageTotals, messages: finalMessages };
        }

        const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
        const toolResults = [];
        for (const block of toolUseBlocks) {
            const result = await executeTool(block.name, block.input, env);
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
        }

        working = [...working, { role: 'assistant', content: response.content }, { role: 'user', content: toolResults }];
    }
}

async function handleChat(request, env) {
    let body;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: 'invalid_json' }, 400, env);
    }

    const messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
        return jsonResponse({ error: 'messages_required' }, 400, env);
    }
    if (messages.length > MAX_MESSAGES) {
        return jsonResponse({
            reply: "We've covered a lot here — let's continue this over the phone so I can get you sorted properly. Could you leave a number for the team to call you back on?",
            usage: null,
            capped: true,
        }, 200, env);
    }
    for (const m of messages) {
        if (typeof m.content === 'string' && m.content.length > MAX_MESSAGE_CHARS) {
            return jsonResponse({ error: 'message_too_long', maxChars: MAX_MESSAGE_CHARS }, 400, env);
        }
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rate = await checkIpRateLimit(env, ip);
    if (!rate.allowed) {
        return jsonResponse({ error: 'rate_limited', message: rate.reason }, 429, env);
    }

    const tokenCap = await checkDailyTokenCap(env);
    if (!tokenCap.allowed) {
        console.log(`[token-cap] blocked request — used ${tokenCap.tokensToday} of ${tokenCap.cap} tokens today`);
        return jsonResponse({
            reply: "This demo has hit its daily testing budget — please try again tomorrow, or contact the team directly.",
            usage: null,
            tokenCapped: true,
        }, 200, env);
    }

    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
    const lastUserText = typeof lastUserMessage?.content === 'string' ? lastUserMessage.content : '';
    if (flagSuspicious(lastUserText)) {
        console.log(`[suspicious-input] ip=${ip} text="${lastUserText.slice(0, 200)}"`);
    }

    let result;
    try {
        result = await runConversation(env, messages);
    } catch (err) {
        console.error('[claude-error]', err.message);
        return jsonResponse({ error: 'upstream_error' }, 502, env);
    }

    const requestTokens = totalTokens(result.usageTotals);
    const tokensToday = await recordUsage(env, requestTokens);
    console.log(`[usage] ip=${ip} in=${result.usageTotals.input_tokens} out=${result.usageTotals.output_tokens} cacheRead=${result.usageTotals.cache_read_input_tokens} cacheWrite=${result.usageTotals.cache_creation_input_tokens} tokensToday=${tokensToday}`);

    return jsonResponse({
        reply: result.reply,
        messages: result.messages,
        usage: result.usageTotals,
    }, 200, env);
}

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders(env) });
        }
        const url = new URL(request.url);

        if (url.pathname === '/health') {
            return jsonResponse({ ok: true }, 200, env);
        }
        if (url.pathname === '/chat' && request.method === 'POST') {
            return handleChat(request, env);
        }
        return jsonResponse({ error: 'not_found' }, 404, env);
    },
};
