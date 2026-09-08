import { readFile } from 'node:fs/promises';

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? 'public, max-age=300, stale-while-revalidate=900' : 'no-store');
  res.end(JSON.stringify(payload));
}

function query(req, key) {
  const direct = req?.query?.[key];
  if (Array.isArray(direct)) return direct[0];
  if (direct !== undefined) return direct;
  try { return new URL(req.url, 'https://abg-pulse.local').searchParams.get(key); } catch { return null; }
}

export function filterCoverageRows(rows, { status = null, type = null, priority = null, gap = null, search = null } = {}) {
  const needle = String(search || '').trim().toLowerCase();
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (status && row.status !== status) return false;
    if (type && row.type !== type) return false;
    if (priority !== null && Boolean(row.priority) !== Boolean(priority)) return false;
    if (gap && !(row.gaps || []).includes(gap)) return false;
    if (needle && !`${row.name || ''} ${row.entityId || ''}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  try {
    const payload = JSON.parse(await readFile(new URL('../data/entity-source-coverage.json', import.meta.url), 'utf8'));
    if (!payload?.summary || !Array.isArray(payload?.rows)) throw new Error('Coverage graph is structurally invalid.');
    const priorityValue = query(req, 'priority');
    const priority = priorityValue === null ? null : ['1', 'true', 'yes'].includes(String(priorityValue).toLowerCase());
    const rows = filterCoverageRows(payload.rows, {
      status: query(req, 'status'),
      type: query(req, 'type'),
      priority,
      gap: query(req, 'gap'),
      search: query(req, 'q')
    });
    return send(res, 200, {
      generatedAt: payload.generatedAt,
      methodology: payload.methodology,
      summary: payload.summary,
      filteredCount: rows.length,
      unresolvedReferences: payload.unresolvedReferences || [],
      rows
    });
  } catch (error) {
    return send(res, 503, {
      error: 'entity_source_coverage_unavailable',
      message: String(error?.message || error),
      rows: [],
      failedClosed: true
    });
  }
}
