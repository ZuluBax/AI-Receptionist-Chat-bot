/**
 * Raw token-usage aggregation only — deliberately no $/token pricing table
 * here. Cost tracking for this project is handled externally; this Worker
 * just logs the token counts each conversation actually used so they can be
 * cross-referenced against whatever cost dashboard/report is authoritative.
 */

export function sumUsage(totals, usage) {
    totals.input_tokens += usage.input_tokens || 0;
    totals.output_tokens += usage.output_tokens || 0;
    totals.cache_creation_input_tokens += usage.cache_creation_input_tokens || 0;
    totals.cache_read_input_tokens += usage.cache_read_input_tokens || 0;
    return totals;
}

export function newUsageTotals() {
    return { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
}

export function totalTokens(usage) {
    return (usage.input_tokens || 0) + (usage.output_tokens || 0)
        + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
}
