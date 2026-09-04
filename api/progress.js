import { readFile } from 'node:fs/promises';

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.end(JSON.stringify(payload));
}

function bounded(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number));
}

function calculateProgress(milestones = [], field = 'completion') {
  const weightTotal = milestones.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  const weighted = milestones.reduce((sum, item) => {
    const value = field === 'implementationCompletion'
      ? (item.implementationCompletion ?? item.completion ?? 0)
      : (item.completion ?? 0);
    return sum + Number(item.weight || 0) * bounded(value) / 100;
  }, 0);
  return weightTotal ? Math.round(weighted / weightTotal * 100) : 0;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  try {
    const url = new URL('../data/build-milestones.json', import.meta.url);
    const plan = JSON.parse(await readFile(url, 'utf8'));
    const milestones = Array.isArray(plan.milestones) ? plan.milestones : [];
    const weightTotal = milestones.reduce((sum, item) => sum + Number(item.weight || 0), 0);
    const verifiedCompletion = calculateProgress(milestones, 'completion');
    const implementationCompletion = Math.max(
      verifiedCompletion,
      calculateProgress(milestones, 'implementationCompletion')
    );
    const counts = milestones.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {});
    const activeMilestones = milestones.filter((item) => item.active === true);
    const blockedMilestones = milestones.filter((item) => item.status === 'blocked');
    const nextGates = activeMilestones.map((item) => ({
      id: item.id,
      title: item.title,
      nextAction: item.nextAction,
      acceptanceGate: item.acceptanceGate,
      dependency: item.dependency
    }));
    const activeDependencies = (plan.resources?.externalDependencies || [])
      .filter((item) => !['available', 'connected', 'complete', 'resolved'].includes(String(item.currentState || '').toLowerCase()));

    return send(res, 200, {
      objective: plan.objective,
      version: plan.version,
      updatedAt: plan.updatedAt || null,
      completion: verifiedCompletion,
      verifiedCompletion,
      implementationCompletion,
      builtAwaitingProof: Math.max(0, implementationCompletion - verifiedCompletion),
      remainingToVerify: Math.max(0, 100 - verifiedCompletion),
      notYetBuilt: Math.max(0, 100 - implementationCompletion),
      weightTotal,
      counts,
      programme: plan.programme || {},
      activeMilestones,
      blockedMilestones,
      nextGates,
      activeDependencies,
      milestones,
      resources: plan.resources,
      calculatedAt: new Date().toISOString()
    });
  } catch (error) {
    return send(res, 500, { error: 'progress_unavailable', message: String(error?.message || error) });
  }
}
