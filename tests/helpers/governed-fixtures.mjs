// Synthetic data with complete provenance. Not production-operating evidence.
import { sealPayload, snapshotIdentity } from '../../lib/data-integrity.mjs';
export const fixtureSource = { repository: 'NinjaRK/abg-pulse', commitSha: 'a'.repeat(40), workflowRunId: '42', workflowRunAttempt: '1' };
export function sourceChecks(total, successful) {
  return Array.from({ length: total }, (_, i) => ({ name: `source-${i}`, provider: 'Test', ok: i < successful, status: i < successful ? 'healthy' : 'failed', itemCount: i < successful ? 1 : 0 }));
}
export function sealedGraph(raw) {
  const graph = structuredClone(raw);
  graph.sourceCommit = fixtureSource.commitSha;
  const time = new Date(graph.generatedAt).getTime();
  const snapshot = sealPayload({ schemaVersion: 1, generatedAt: graph.generatedAt,
    windowStart: new Date(time - 86400_000).toISOString(), windowEnd: graph.generatedAt,
    source: fixtureSource, events: [], meta: { queryCount: 1, successfulQueries: 1, sourceChecks: sourceChecks(1,1) } });
  graph.input = { governedSnapshotGeneratedAt: snapshot.generatedAt, governedSnapshotSourceCommit: graph.sourceCommit,
    governedSnapshotWorkflowRunId: '42', governedSnapshotWorkflowRunAttempt: '1',
    governedSnapshotIdentity: snapshotIdentity(snapshot), governedSnapshotEventCount: graph.eventSummaries.length };
  return sealPayload(graph);
}
