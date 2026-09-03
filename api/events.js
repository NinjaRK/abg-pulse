import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const entityUniverse = JSON.parse(readFileSync(fileURLToPath(new URL('../data/entity-universe-summary.json', import.meta.url)), 'utf8'));

function send(res, status, body, cache = false) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', cache ? 'public, s-maxage=120, stale-while-revalidate=300' : 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return send(res, 200, { events: [], entityUniverse, meta: { mode: 'live-on-demand', persistentHistory: false, generatedAt: new Date().toISOString() } }, true);

  try {
    const url = `${base.replace(/\/$/, '')}/rest/v1/events?select=payload&is_published=eq.true&order=updated_at.desc&limit=250`;
    const response = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Supabase ${response.status}`);
    const rows = await response.json();
    const events = rows.map((row) => row.payload).filter(Boolean);
    return send(res, 200, { events, entityUniverse, meta: { mode: 'database', persistentHistory: true, generatedAt: new Date().toISOString() } }, true);
  } catch (error) {
    return send(res, 200, { events: [], entityUniverse, meta: { mode: 'live-on-demand', persistentHistory: false, warning: String(error?.message || error), generatedAt: new Date().toISOString() } }, true);
  }
}
