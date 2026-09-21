"""One public W3C PDF test fixture; separate from ABG coverage and publisher rights."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from .collector import PublicTransport
from .documents import fetch_document

URL = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    # This narrowly scoped fixture assessment does not grant permissions to any
    # of the 71 product-source records. No W3C PDF or extracted text is retained.
    fixture={'id':'test-fixture-w3c', 'allowedHosts':['www.w3.org'], 'productionEnabled':False,
             'documentPolicy':{'permission':'granted', 'referenceId':'w3c-public-test-copy-policy-20260921',
             'approvedBy':'test-fixture licence assessment only; not product-source approval',
             'evidenceUrl':'https://www.w3.org/copyright/', 'urls':[URL], 'formats':['pdf'],
             'maxRetainedCharacters':0}}
    transport=PublicTransport(fixture['allowedHosts'])
    result=fetch_document({'url':URL,'kind':'attachment'},fixture,transport.get,retain_text=False)
    expected=hashlib.sha256('Dummy PDF file'.encode()).hexdigest()
    result_matches=(result.get('status')=='pdf_text_extracted' and result.get('pageCount')==1
                    and any(p['sha256']==expected and p['reference']['page']==1 for p in result['passages']))
    report={'observedAt':datetime.now(timezone.utc).isoformat(), 'codeCommit':os.environ.get('GITHUB_SHA'),
            'scope':'Public one-page PDF parser control, NOT an ABG news source or coverage benchmark',
            'independentRecallBenchmark':False, 'productionWrites':False, 'originalPdfRetained':False,
            'extractedTextRetained':False, 'fixtureCopyright':'Original W3C-hosted test; see source and policy URL.',
            'expectedPageCount':1,'expectedTextHash':expected,'pass':result_matches,
            'result':result,'httpObservations':transport.records}
    out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    (out/'pdf-fixture-proof.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'pass':result_matches,'status':result['status']},indent=2))
    return 0 if result_matches else 1


if __name__=='__main__':raise SystemExit(main())
