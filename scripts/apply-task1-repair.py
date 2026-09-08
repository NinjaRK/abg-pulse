from pathlib import Path
import subprocess

root = Path.cwd()
expected = {
 '.github/workflows/refresh-claim-evidence.yml':'679afa230cecda18a6616b56e4ffc3b7c3bef713',
 '.github/workflows/refresh-live-snapshot.yml':'82998bd601d8770277e607207bf20fa505f077ce',
 '.github/workflows/verify-live-feed.yml':'b0b6fd7a5c8931f16d45b36c19a223ac40884434',
 'api/scan.js':'a0cb3f9a412185ba8ac7753bcc7d7bc276890e90',
 'app.js':'68dc6c6ab0f04bf67ca82e3782a8557e7560efd7',
 'lib/live-snapshot.mjs':'56f72557f53fc62aaca7150c998323e0eb95bcc1',
 'scripts/build-claim-evidence-snapshot.mjs':'2a32f4ed92e8c35060447f0f6a88944eaad2e527'
}
subprocess.run(['git','diff','--exit-code','c8bb350a7d27c120e395e3f39cf69a69189fb0b2','HEAD','--',*expected],check=True)
p=root/'scripts/build-claim-evidence-snapshot.mjs'
s=p.read_text().replace("const DEFAULT_LIVE_SNAPSHOT_URL = 'https://raw.githubusercontent.com/NinjaRK/abg-pulse/live-data/data/live-snapshot.json';", "import { DEFAULT_LIVE_SNAPSHOT_URL } from '../lib/live-snapshot.mjs';")
p.write_text(s)
p=root/'.github/workflows/refresh-claim-evidence.yml'
s=p.read_text().replace('live-data/data/live-snapshot.json','live-data/live-snapshot.json')
s=s.replace("      - 'tests/claims-api.test.mjs'", "      - 'tests/claims-api.test.mjs'\n      - 'lib/live-snapshot.mjs'\n      - 'tests/live-feed-integration.test.mjs'")
p.write_text(s)
for file in ['.github/workflows/refresh-live-snapshot.yml','.github/workflows/refresh-claim-evidence.yml']:
 p=root/file;s=p.read_text()
 if 'refresh-live-snapshot' in file:s=s.replace('          ref: main','          ref: ${{ github.sha }}')
 a=s.index('\n',s.index("              node --input-type=module <<'NODE'"))+1
 b=s.index('              NODE',a)+len('              NODE')
 s=s[:a]+'\n'.join(line[4:] for line in s[a:b].split('\n'))+s[b:]
 p.write_text(s)
p=root/'lib/live-snapshot.mjs';s=p.read_text()
old="""  const now = validDate(options.now) || new Date();
  const ageMinutes = snapshotAgeMinutes(snapshot, now);
  const staleAfterMinutes = Number(options.staleAfterMinutes ?? DEFAULT_SNAPSHOT_STALE_MINUTES);
  if (ageMinutes > staleAfterMinutes) {
    throw new SnapshotError(
      'snapshot_stale',
      `The governed snapshot is ${Math.round(ageMinutes)} minutes old; the limit is ${staleAfterMinutes} minutes.`,
      503,
      { ageMinutes, staleAfterMinutes, generatedAt: snapshot.generatedAt }
    );
  }
"""
assert old in s;s=s.replace(old,'')
s=s.replace('  const coverageStart = new Date(snapshot.windowStart);',"""  const now = options.now === undefined ? new Date() : validDate(options.now);
  if (!now) throw new SnapshotError('snapshot_clock_invalid', 'The current time is invalid.');
  const staleAfterMinutes = Number(options.staleAfterMinutes ?? DEFAULT_SNAPSHOT_STALE_MINUTES);
  if (!Number.isFinite(staleAfterMinutes) || staleAfterMinutes <= 0) {
    throw new SnapshotError('snapshot_freshness_config_invalid', 'Snapshot freshness must be a finite positive number.');
  }
  const skewMs = 60_000;
  if (new Date(snapshot.generatedAt).getTime() > now.getTime() + skewMs
      || new Date(snapshot.windowEnd).getTime() > now.getTime() + skewMs) {
    throw new SnapshotError('snapshot_timestamp_future', 'Snapshot timestamps are implausibly in the future.');
  }
  const ageMinutes = snapshotAgeMinutes(snapshot, now);
  const coverageAgeMinutes = Math.max(0, (now.getTime() - new Date(snapshot.windowEnd).getTime()) / 60_000);
  if (Math.max(ageMinutes, coverageAgeMinutes) > staleAfterMinutes) {
    throw new SnapshotError('snapshot_stale', 'The governed snapshot or its coverage is older than the freshness limit.', 503,
      { ageMinutes, coverageAgeMinutes, staleAfterMinutes, generatedAt: snapshot.generatedAt });
  }

  const coverageStart = new Date(snapshot.windowStart);""")
s=s.replace("  if (!coverageComplete && options.requireCompleteWindow !== false) {", """  // Scheduled evidence cannot cover the future tail of a rolling 'to now'
  // request. Only this bounded tail may be served as explicitly partial.
  // Missing history, non-overlapping windows and future requests still fail.
  const trailingLagAllowed = options.allowTrailingLag === true
    && requestedStart >= coverageStart && requestedStart < coverageEnd
    && requestedEnd > coverageEnd && requestedEnd.getTime() <= now.getTime() + skewMs;
  if (!coverageComplete && !trailingLagAllowed && options.requireCompleteWindow !== false) {""")
s=s.replace('        coverageComplete\n', """        coverageComplete,
        coverageThrough: new Date(Math.min(requestedEnd.getTime(), coverageEnd.getTime())).toISOString(),
        coverageLagMinutes: Math.max(0, (requestedEnd.getTime() - coverageEnd.getTime()) / 60_000),
        coverageNotice: coverageComplete ? null
          : `Evidence checked through ${snapshot.windowEnd}; the remaining requested period is not yet checked.`
""")
s=s.replace('  requireCompleteWindow = true,\n', '  requireCompleteWindow = true,\n  allowTrailingLag = false,\n').replace('      requireCompleteWindow\n', '      requireCompleteWindow,\n      allowTrailingLag\n');p.write_text(s)
p=root/'api/scan.js';p.write_text(p.read_text().replace('        now: startedAt,\n','        now: startedAt,\n        allowTrailingLag: true,\n'))
p=root/'app.js';s=p.read_text()
s=s.replace("  else if (state.liveStatus === 'success' && state.lastScanAt) label.textContent = `Live scan ${relativeTime(state.lastScanAt)}`;", """  else if (state.liveStatus === 'success' && state.liveMeta?.snapshot) {
    const snapshot = state.liveMeta.snapshot;
    label.textContent = `Checked through ${formatDate(snapshot.coverageThrough || snapshot.windowEnd, true)}${snapshot.coverageComplete ? '' : ' · newer period not yet checked'}`;
  }
  else if (state.liveStatus === 'success' && state.lastScanAt) label.textContent = `Live scan ${relativeTime(state.lastScanAt)}`;""")
s=s.replace("  const scanCopy = coverage.attemptedChecks", "  const coverageNotice = state.liveMeta?.snapshot?.coverageNotice || '';\n  const scanCopy = coverage.attemptedChecks")
s=s.replace('${capCopy ? `<p>', '${coverageNotice ? `<p><strong>${escapeHtml(coverageNotice)}</strong></p>` : \'\'}${capCopy ? `<p>');p.write_text(s)
p=root/'.github/workflows/verify-live-feed.yml';s=p.read_text().replace('      - uses: actions/upload-artifact@v4', """      - name: Verify exact deployed code and real production feed
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        env:
          EXPECTED_DEPLOYMENT_SHA: ${{ github.sha }}
        run: node scripts/verify-live-feed.mjs /tmp/live-feed-proof/runtime.json
      - uses: actions/upload-artifact@v4""");p.write_text(s)
for file,wanted in expected.items():
 actual=subprocess.check_output(['git','hash-object',file],text=True).strip()
 assert actual==wanted, f'{file}: does not match the locally tested blob'
print('All seven modified files exactly match the locally tested source blobs.')
