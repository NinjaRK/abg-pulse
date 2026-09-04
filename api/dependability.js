import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ledger = JSON.parse(readFileSync(fileURLToPath(new URL('../data/dependability-ledger.json', import.meta.url)), 'utf8'));

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

function consecutiveDays(days = []) {
  const passed = [...new Set(days.filter((day) => day?.pass === true && day?.date).map((day) => day.date))]
    .sort()
    .reverse();
  if (!passed.length) return 0;
  let streak = 1;
  let cursor = new Date(`${passed[0]}T00:00:00Z`);
  for (const date of passed.slice(1)) {
    const expected = new Date(cursor.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (date !== expected) break;
    streak += 1;
    cursor = new Date(`${date}T00:00:00Z`);
  }
  return streak;
}

export default function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  const days = Array.isArray(ledger.days) ? ledger.days : [];
  const verifiedDays = days.filter((day) => day?.pass === true).length;
  const currentStreak = consecutiveDays(days);
  const proofComplete = currentStreak >= Number(ledger.proofWindowDays || 30);
  return send(res, 200, {
    status: proofComplete ? 'proven' : ledger.status,
    objectiveAchieved: proofComplete,
    message: proofComplete
      ? 'The dependability proof window has passed every acceptance gate.'
      : 'The product may operate before proof is complete, but 9–10/10 dependability is not claimed until the full evidence window passes.',
    proofWindowDays: Number(ledger.proofWindowDays || 30),
    verifiedDays,
    currentConsecutivePassDays: currentStreak,
    daysRemaining: Math.max(0, Number(ledger.proofWindowDays || 30) - currentStreak),
    acceptanceGates: ledger.acceptanceGates,
    referenceSet: ledger.referenceSet,
    startedAt: ledger.startedAt,
    completedAt: ledger.completedAt,
    latestDay: days.length ? [...days].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] : null
  });
}
