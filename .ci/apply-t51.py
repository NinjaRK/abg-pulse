from pathlib import Path
import hashlib, subprocess
root=Path.cwd()
changed=['api/claims.js','api/events.js','api/scan.js','app.js','index.html','lib/claim-evidence.mjs','scripts/build-claim-evidence-snapshot.mjs','service-worker.js','tests/browser-acceptance.py','tests/claim-evidence.test.mjs']
subprocess.run(['git','diff','--exit-code','17d669f3e66806922e51b05d29f13f9c35fe95cd','HEAD','--',*changed],check=True)
p=root/'lib/claim-evidence.mjs';s=p.read_text()
s=s.replace("import { createHash } from 'node:crypto';", "import { createHash } from 'node:crypto';\nimport { CLAIM_SUPPORT_POLICY, assessSourceMetadata, traceableSourceUrl } from './claim-support.mjs';")
a=s.index('function canonicalUrl(');b=s.index('function evidenceFromSource(',a)
s=s[:a]+"const canonicalUrl = traceableSourceUrl;\n\n"+s[b:]
a=s.index('function independentEvidence(');b=s.index('function factStatements(',a)
s=s[:a]+s[b:]
s=s.replace('  const support = supportStatus(evidence);','  const support = assessSourceMetadata(evidence);')
s=s.replace('    independentEvidenceCount: independentEvidence(evidence),\n    supportStatus: support.status,\n    supportReason: support.reason,\n    supportConfidence: support.confidence,','    ...support,')
s=s.replace("    snapshotSourceCommit: source.snapshotSourceCommit || null", "    snapshotSourceCommit: source.snapshotSourceCommit || null,\n    // Retain reporting-origin hints, never treat supplied hints as proof.\n    originalReportUrl: canonicalUrl(source.originalReportUrl || source.originalUrl || source.originalSourceUrl),\n    wireService: typeof source.wireService === 'string' ? source.wireService : null")
s=s.replace("    schemaVersion: '1.0.0',\n    generatedAt,", "    schemaVersion: '1.0.0',\n    supportPolicy: CLAIM_SUPPORT_POLICY,\n    statementVerification: 'not_performed',\n    generatedAt,")
p.write_text(s)
p=root/'api/claims.js';s=p.read_text()
s="import { CLAIM_SUPPORT_POLICY, applyClaimSupportPolicy } from '../lib/claim-support.mjs';\n\n"+s
s=s.replace("res.setHeader('Cache-Control', status === 200 ? 'public, max-age=60, stale-while-revalidate=180' : 'no-store');", "// Do not replay legacy overconfident support labels from an API cache.\n  res.setHeader('Cache-Control', 'no-store');")
s=s.replace("export function projectClaimGraph(payload, filters = {}, { summaryOnly = false, includeEvidence = true } = {}) {\n", "export function projectClaimGraph(payload, filters = {}, { summaryOnly = false, includeEvidence = true } = {}) {\n  payload = applyClaimSupportPolicy(payload);\n")
s=s.replace('    const payload = await loadClaimEvidenceGraph();\n    const freshness = validateClaimEvidenceGraph(payload, { staleAfterMinutes });', '    const original = await loadClaimEvidenceGraph();\n    const freshness = validateClaimEvidenceGraph(original, { staleAfterMinutes });\n    const payload = applyClaimSupportPolicy(original);')
s=s.replace('      schemaVersion: payload.schemaVersion,','      schemaVersion: payload.schemaVersion,\n      supportPolicy: CLAIM_SUPPORT_POLICY,\n      statementVerification: \'not_performed\',')
s=s.replace("fact: 'A factual statement is stored separately from interpretation and linked to the evidence that supports it.'", "fact: 'A factual assertion is stored separately from interpretation and linked to source metadata. Its truth is not established by that link.'")
s=s.replace("supported: 'Supported by a direct official source, or by sufficient independent high-quality corroboration.'", "supported: 'Reserved for statement-to-source verification. This metadata-only policy does not emit supported factual claims.'")
s=s.replace("provisional: 'Relevant evidence exists but does not yet meet the strongest support threshold.'", "provisional: 'Source metadata is attached; statement verification has not been performed. Several domains may repeat the same original report.'")
s=s.replace("unsupported: 'No traceable evidence is attached. Material unsupported claims block graph publication.'", "unsupported: 'No traceable source is attached. Untraceable facts are not delivered by this policy.'")
p.write_text(s)
p=root/'scripts/build-claim-evidence-snapshot.mjs';s=p.read_text().replace("    publishable: unsupportedMaterialClaims.length === 0,", "    publishable: unsupportedMaterialClaims.length === 0,\n    factualAccuracyVerified: false,\n    supportPolicy: graph.supportPolicy,")
s=s.replace("rule: 'No unsupported factual claim at or above the materiality floor may be published as a dependable claim graph.'", "rule: 'Material claims without traceable sources block publication. Source attachment does not establish factual accuracy.'")
p.write_text(s)
p=root/'tests/claim-evidence.test.mjs';s=p.read_text()
s=s.replace("test('direct official evidence marks factual claims supported'", "test('official source metadata alone leaves factual claims provisional'")
s=s.replace("facts.every((claim) => claim.supportStatus === 'supported')", "facts.every((claim) => claim.supportStatus === 'provisional')")
s=s.replace('facts.every((claim) => claim.supportConfidence >= 0.94)', 'facts.every((claim) => claim.supportConfidence === null)')
s=s.replace("assert.equal(result.claims[0].supportConfidence, 0);", "assert.equal(result.claims[0].supportConfidence, null);")
s=s.replace('assert.equal(graph.summary.supportedFactClaims, 2);','assert.equal(graph.summary.supportedFactClaims, 0);').replace('assert.equal(graph.summary.provisionalFactClaims, 1);','assert.equal(graph.summary.provisionalFactClaims, 3);')
p.write_text(s)
p=root/'app.js';s=p.read_text();s="import { eventSupportPresentation } from './lib/claim-support.mjs';\n"+s
s=s.replace("function statusLabel(status) {\n  return status === 'confirmed' ? 'Confirmed' : status === 'strong' ? 'Strong reporting' : 'Developing';\n}", "function statusLabel(event) {\n  return eventSupportPresentation(event).label;\n}")
s=s.replace('statusLabel(event.status)','statusLabel(event)')
s=s.replace('class="status-pill ${escapeHtml(event.status || \'developing\')}"','class="status-pill developing"')
s=s.replace('class="status-pill ${escapeHtml(event.status)}"','class="status-pill developing"')
s=s.replace("${scoreItem('Certainty', intelligence.certainty ?? 0, 'certainty')}", "<p class=\"method-note\" data-claim-support=\"source-metadata-only-v1\">Statement check: pending</p>")
s=s.replace("${intelligenceTile('Certainty', intelligence.certainty)}", "${intelligenceTile('Statement check', 'Pending')}")
s=s.replace("<section class=\"dialog-section\"><h3>Evidence and sources</h3>", "<section class=\"dialog-section\"><h3>Evidence and sources</h3><p class=\"method-note\" data-claim-support=\"source-metadata-only-v1\">${escapeHtml(eventSupportPresentation(event).notice)}</p>")
s=s.replace('Facts above are derived from the linked evidence;', 'Statements above have not been verified against source passages;')
s=s.replace("lead: 'Materially changes today’s senior-management picture and is supported strongly enough to brief now.'", "lead: 'A heuristic attention priority, not a factual verification label. Check the sources before acting.'")
s=s.replace("certainty: { title: 'Certainty', lead: 'Strength of evidence supporting the factual core.', formula: 'Base by source tier + limited corroboration + confirmation terms − speculative language.', note: 'Several domains can still repeat one wire story, so count is not proof.' }", "certainty: { title: 'Statement verification', lead: 'Statement-level source verification has not yet been performed.', formula: 'Source tier, headline language and domain counts do not verify the statement. The legacy ranking signal is not a probability of truth.', note: 'Source-linked claims remain provisional; syndicated copies are not independent confirmation.' }")
s=s.replace('independent-source diversity', 'source-domain breadth (not verified independence)')
s=s.replace('Certainty = evidence', 'Statement verification = pending')
s=s.replace('Verified frame', 'Reference frame · not independently verified').replace('The verified and emerging frames currently remain aligned.', 'No divergence was detected between the reference and emerging frames; neither is independently verified.')
s=s.replace('Verified brief active · live discovery degraded','Saved brief active · live discovery degraded')
s=s.replace('The verified period record remains available.', 'The saved period record remains available; verify sources before acting.')
s=s.replace('present in the verified record.', 'present in the saved record.').replace('following verified or clearly labelled developments', 'following source-linked, unverified developments')
p.write_text(s)
p=root/'index.html';s=p.read_text().replace('Answers are constructed only from the verified event record shown in this product.', 'Answers use the source-linked event record. Individual statements have not been verified against source text.');p.write_text(s)
p=root/'service-worker.js';s=p.read_text().replace("'abg-pulse-shell-v6'", "'abg-pulse-shell-t51-v1'").replace("'/app.js', '/core.mjs',", "'/app.js', '/core.mjs', '/lib/claim-support.mjs',");p.write_text(s)
for f in ['api/scan.js','api/events.js']:
 p=root/f;s=p.read_text();s="import { applyEventSupportPolicy, CLAIM_SUPPORT_POLICY } from '../lib/claim-support.mjs';\n"+s
 s=s.replace('  res.end(JSON.stringify(body));', "  const delivery = Array.isArray(body.events)\n    ? { ...body, supportPolicy: CLAIM_SUPPORT_POLICY, events: body.events.map(applyEventSupportPolicy) }\n    : body;\n  res.end(JSON.stringify(delivery));")
 p.write_text(s)
p=root/'tests/browser-acceptance.py';s=p.read_text()
s=s.replace("        expect(detail).to_be_visible();detail.click();expect(page.locator('#story-dialog')).to_be_visible()", """        expect(detail).to_be_visible()
        labels = page.locator('#view-today .status-pill').all_text_contents()
        assert labels and all('unverified' in value or 'No traceable source' in value for value in labels), labels
        assert page.locator('#view-today [data-claim-support]').count() > 0
        passed('Legacy confirmed fixture events display unverified source-linked labels and no truth percentage')
        detail.click();expect(page.locator('#story-dialog')).to_be_visible()
        expect(page.locator('#story-dialog [data-claim-support]')).to_contain_text('statement verification pending')
        assert 'Certainty' not in page.locator('#story-dialog .intelligence-grid').inner_text()
        passed('Evidence dialog explicitly marks statement verification pending')""")
p.write_text(s)
expected={
 'api/claims.js':'06bf6467fd86b094c98d772ec0a614032968502aecc02eabc1aa85ee430f5cc2',
 'api/events.js':'a275202de7fa7c2bc1514bf9b4de9efc0029c3e5f611cd97927a0b32483c72a3',
 'api/scan.js':'a23b5ded5fd265e9b0ce0f802fbdc0cb0eecedf829963fc9e8c1728da0d947bc',
 'app.js':'5e0f831d3c0fa654db8cc278bd928e386b3bb11658a16b92047c6aeb940ba9a3',
 'index.html':'65f6b75fefd95f719e6224ba365c611eb1b7f5cd47bbbaf98f3822c24a0e477d',
 'lib/claim-evidence.mjs':'29f0281ebd540245d41630b7a1ad314c2c90001fb1131ec68e41694aca94d6e4',
 'lib/claim-support.mjs':'7c87891471dbc9fdbca59781c7a4fb0b48b96a92c7027cfd353da3e7e87e496c',
 'scripts/build-claim-evidence-snapshot.mjs':'5c41c4b2e741ea18ddc6faa8e21b57c53d1d386dc7b2bab79b19c4cde7fad280',
 'service-worker.js':'98d2ad660c283af3bd4807dac822d468c5bc0ef96314b7d8d9c52f73a548581f',
 'tests/browser-acceptance.py':'6c6104194d76a5be36f57c7df04d9bb4d81498b3ff5573ca2a954c47ffebda17',
 'tests/claim-evidence.test.mjs':'661034636ce0a323ae129160287e2329ebe6fc900d847a76848f6b3c5bb05fbf',
 'tests/claim-support-regression.test.mjs':'ec9e96ac1f404da77244b072b25fd65b8a9ae5079f15799cc0178a23f5a1a64a'
}
for f,digest in expected.items():
 actual=hashlib.sha256((root/f).read_bytes()).hexdigest()
 assert actual==digest,f'{f}: source differs from the locally tested copy: {actual}'
print('All 12 implementation/test files match the locally tested SHA256 values.')
