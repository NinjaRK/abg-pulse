#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fetchGNewsQuery, validateGNewsQueryPlan } from '../lib/gnews.mjs';
import { assessArticleSignal, formatLiveArticle } from '../core.mjs';

const defaultPlan = validateGNewsQueryPlan(JSON.parse(
  readFileSync(new URL('../config/gnews-query-plan.json', import.meta.url), 'utf8')
));
const entities = JSON.parse(readFileSync(new URL('../data/entities.json', import.meta.url), 'utf8'));
const sources = JSON.parse(readFileSync(new URL('../data/source-registry.json', import.meta.url), 'utf8'));

function finitePositive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

function safeCandidate(article, signal) {
  return {
    title: article.title,
    url: article.url,
    sourceName: article.sourceName,
    domain: article.domain,
    publishedAt: article.publishedAt,
    queryGroup: article.queryGroup,
    queryId: article.queryId || null,
    relevant: Boolean(signal?.includeAsNews),
    reason: signal?.reason || 'not_assessed',
    entityIds: (signal?.entities || []).map((entity) => entity.id)
  };
}

export async function runGNewsPilot({
  apiKey = process.env.GNEWS_API_KEY,
  now = new Date(),
  hours = finitePositive(process.env.GNEWS_PILOT_HOURS, 24),
  queryPlan = defaultPlan,
  fetchImpl = globalThis.fetch,
  concurrency = 4
} = {}) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('GNEWS_API_KEY is required for the live pilot verification.');
  validateGNewsQueryPlan(queryPlan);
  const end = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(end.getTime())) throw new TypeError('Pilot end time is invalid.');
  const safeHours = Math.min(168, Math.max(1, Number(hours)));
  const start = new Date(end.getTime() - safeHours * 60 * 60 * 1000);
  const window = { start: start.toISOString(), end: end.toISOString() };

  const checks = await mapLimit(queryPlan.queries, Math.max(1, Math.min(6, Number(concurrency) || 4)), async (spec) => {
    try {
      const result = await fetchGNewsQuery(spec, { apiKey: key, window, fetchImpl });
      return {
        id: spec.id,
        group: spec.group,
        ok: true,
        itemCount: result.items.length,
        totalArticles: result.totalArticles,
        saturated: result.saturated,
        errorCode: null,
        error: null,
        items: result.items
      };
    } catch (error) {
      return {
        id: spec.id,
        group: spec.group,
        ok: false,
        itemCount: 0,
        totalArticles: null,
        saturated: false,
        errorCode: error?.code || 'gnews_unknown_error',
        error: String(error?.message || error),
        items: []
      };
    }
  });

  const byUrl = new Map();
  for (const check of checks) {
    for (const raw of check.items) {
      const formatted = formatLiveArticle(raw);
      if (!formatted.url || !formatted.title) continue;
      const signal = assessArticleSignal(formatted, entities, sources);
      const existing = byUrl.get(formatted.url);
      if (existing) {
        existing.queryIds = [...new Set([...existing.queryIds, check.id])];
        existing.queryGroups = [...new Set([...existing.queryGroups, check.group])];
        if (signal.includeAsNews) {
          existing.relevant = true;
          existing.reason = signal.reason;
          existing.entityIds = [...new Set([...existing.entityIds, ...signal.entities.map((entity) => entity.id)])];
        }
        continue;
      }
      const candidate = safeCandidate({ ...formatted, queryId: check.id }, signal);
      byUrl.set(formatted.url, {
        ...candidate,
        queryIds: [check.id],
        queryGroups: [check.group]
      });
    }
  }

  const candidates = [...byUrl.values()];
  const rejectionReasons = candidates.filter((item) => !item.relevant).reduce((counts, item) => {
    counts[item.reason] = (counts[item.reason] || 0) + 1;
    return counts;
  }, {});
  const successfulQueries = checks.filter((check) => check.ok).length;
  const saturatedQueries = checks.filter((check) => check.saturated).map((check) => check.id);
  const failures = checks.filter((check) => !check.ok).map(({ id, group, errorCode, error }) => ({
    id, group, errorCode, error
  }));

  const output = {
    schemaVersion: 1,
    provider: 'GNews',
    generatedAt: end.toISOString(),
    window,
    queryCount: checks.length,
    successfulQueries,
    failedQueries: failures.length,
    saturatedQueries,
    rawArticleCount: checks.reduce((sum, check) => sum + check.itemCount, 0),
    uniqueArticleCount: candidates.length,
    relevantArticleCount: candidates.filter((item) => item.relevant).length,
    rejectedArticleCount: candidates.filter((item) => !item.relevant).length,
    rejectionReasons,
    coverageStatus: failures.length
      ? 'provider_checks_failed'
      : saturatedQueries.length
        ? 'retrieval_worked_but_one_or_more_queries_are_saturated'
        : 'retrieval_worked_without_page_one_saturation',
    checks: checks.map(({ items, ...check }) => check),
    failures,
    candidates
  };

  const serialized = JSON.stringify(output);
  if (serialized.includes(key)) throw new Error('Credential leak detected in GNews pilot output.');
  return output;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outputPath = process.argv[2] || 'gnews-pilot-result.json';
  try {
    const output = await runGNewsPilot();
    writeFileSync(resolve(outputPath), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    process.stdout.write(JSON.stringify({
      provider: output.provider,
      generatedAt: output.generatedAt,
      queryCount: output.queryCount,
      successfulQueries: output.successfulQueries,
      failedQueries: output.failedQueries,
      saturatedQueries: output.saturatedQueries.length,
      uniqueArticleCount: output.uniqueArticleCount,
      relevantArticleCount: output.relevantArticleCount,
      coverageStatus: output.coverageStatus,
      output: resolve(outputPath)
    }, null, 2) + '\n');
    if (output.failedQueries > 0) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`GNews pilot verification failed: ${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}
