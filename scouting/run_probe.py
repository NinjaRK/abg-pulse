"""Run bounded public metadata probes. Every failure is retained in the report."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
from datetime import datetime, timezone
from .query_plan import build_query_plans
from .collector import PublicTransport, collect_source, CollectorError, canonical_url

ROOT = Path(__file__).resolve().parents[1]

def validate_register(register):
    if register.get('schemaVersion') != 1 or register.get('scopeComplete') is not False:
        raise CollectorError('invalid_register')
    ids=set()
    for s in register.get('sources',[]):
        if not s.get('id') or s['id'] in ids: raise CollectorError('duplicate_source_id')
        ids.add(s['id'])
        if s.get('productionEnabled') is not False: raise CollectorError('production_activation_not_supported')
        if not s.get('allowedHosts') or not s.get('rightsStatus'): raise CollectorError('source_contract_missing')
        if s.get('rightsStatus') in {'written_permission_required','permission_or_licence_required'} and s.get('probeMode') != 'disabled':
            raise CollectorError('permission_gate_bypass')
        for u in s.get('seedUrls',[]):
            from urllib.parse import urlsplit
            if urlsplit(canonical_url(u)).hostname not in s['allowedHosts']: raise CollectorError('source_host_mismatch')
    return register


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--sources',default='S001,S002,S003,S004,S005,S006,S007,S015,S017,S023,S033,S054,S055')
    ap.add_argument('--output',required=True)
    ap.add_argument('--document-metadata',action='store_true',help='Retain paragraph hashes/locators only; no article text or PDF fetch')
    args=ap.parse_args()
    reg=validate_register(json.loads((ROOT/'scouting/sources.json').read_text()))
    selected=args.sources.split(','); mapping={s['id']:s for s in reg['sources']}
    if len(selected)>20 or len(selected)!=len(set(selected)) or not all(s in mapping for s in selected): raise CollectorError('invalid_source_selection')
    results=[]
    for id_ in selected:
        s=mapping[id_]
        transport=PublicTransport(s['allowedHosts'])
        result=collect_source(s,transport.get,max_pages=2,max_details=2,document_metadata=args.document_metadata)
        result['httpObservations']=transport.records
        results.append(result)
        print(json.dumps({'sourceId':id_,'status':result['status'],'candidates':result.get('candidateCount',0),'retrievedDetails':result.get('retrievedDetails',0),'errors':result['errors']},ensure_ascii=False),flush=True)
    out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    report={'schemaVersion':1,'observedAt':datetime.now(timezone.utc).isoformat(),
       'codeCommit':os.environ.get('GITHUB_SHA'),'workflowRun':os.environ.get('GITHUB_RUN_ID'),
       'documentMetadataEnabled':args.document_metadata,'writesToProduction':False,'fullTextRetained':False,'independentRecallBenchmark':False,'productionReady':False,
       'scope':'At most 2 listing/feed/filing-index requests and 2 detail requests per permitted source; robots checks additional.',
       'sources':results,
       'summary':{'selectedSources':len(results),'sourcesWithPages':sum(bool(r['pages']) for r in results),
       'candidates':sum(r.get('candidateCount',0) for r in results),'htmlDetailsRetrieved':sum(r.get('retrievedDetails',0) for r in results),
       'rightsOrConfigurationPending':sum(r['status']=='rights_or_configuration_pending' for r in results)}}
    data=(json.dumps(report,indent=2,ensure_ascii=False)+'\n').encode()
    (out/'collector-report.json').write_bytes(data)
    (out/'collector-report.sha256').write_text(hashlib.sha256(data).hexdigest()+'\n')
    (out/'query-plans.json').write_text(json.dumps(build_query_plans(json.loads((ROOT/'data/entities.json').read_text())),indent=2,ensure_ascii=False)+'\n')
    records=[c for r in results for c in r['candidates']]
    (out/'candidates.ndjson').write_text(''.join(json.dumps(c,ensure_ascii=False)+'\n' for c in records))
    # Exercise success is not a claim of comprehensive source coverage.
    return 0 if report['summary']['sourcesWithPages'] else 1

if __name__ == '__main__':
    raise SystemExit(main())
