import { readFile } from 'node:fs/promises';

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  try {
    const url = new URL('../data/build-milestones.json', import.meta.url);
    const plan = JSON.parse(await readFile(url, 'utf8'));
    const milestones = Array.isArray(plan.milestones) ? plan.milestones : [];
    const weightTotal = milestones.reduce((sum, item) => sum + Number(item.weight || 0), 0);
    const weighted = milestones.reduce((sum, item) => sum + Number(item.weight || 0) * Number(item.completion || 0) / 100, 0);
    const completion = weightTotal ? Math.round(weighted / weightTotal * 100) : 0;
    const counts = milestones.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {});
    return send(res, 200, {
      objective: plan.objective,
      version: plan.version,
      completion,
      weightTotal,
      counts,
      milestones,
      resources: plan.resources,
      calculatedAt: new Date().toISOString()
    });
  } catch (error) {
    return send(res, 500, { error: 'progress_unavailable', message: String(error?.message || error) });
  }
}
