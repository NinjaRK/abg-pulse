"""Replay the four original synthetic losses against old and new discovery."""
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from .collector import discover_html

def main():
    article=lambda href,text,date='20 September 2026':f'<article><time>{date}</time><a href="{href}">{text}</a></article>'
    cases=[
      ('dated_descriptive_control',1,article('/news/factory','ExampleCo announces a new factory')),
      ('date_on_detail_only',1,'<article><a href="/news/approval">ExampleCo receives factory approval</a></article>'),
      ('generic_pdf_download',1,article('/news/order.pdf','Download')),
      ('forty_five_items',45,''.join(article(f'/news/event-{i}',f'ExampleCo reports material event number {i}') for i in range(45))),
      ('meaningful_query_ids',2,article('/news/item?id=one','ExampleCo reports operating update')+article('/news/item?id=two','ExampleCo reports financing update'))]
    js="""import {extractOfficialItems} from './official.mjs';
import {readFileSync} from 'node:fs';
const cases=JSON.parse(readFileSync(0,'utf8'));
const source={id:'test',name:'ExampleCo',url:'https://example.test/news/',domain:'example.test',include:['/news/']};
console.log(JSON.stringify(cases.map(c=>extractOfficialItems(c[2],source,new Date('2026-09-21T00:00:00Z')).length)));"""
    before=json.loads(subprocess.run(['node','--input-type=module','-e',js],input=json.dumps(cases),text=True,capture_output=True,check=True).stdout)
    s={'id':'test','allowedHosts':['example.test'],'candidatePatterns':[r'/news/'],'listingPatterns':[]}
    rows=[]
    for (name,expected,html),old in zip(cases,before):
        new=len(discover_html(html,'https://example.test/news/',s)['candidates'])
        rows.append({'case':name,'expectedCandidates':expected,'legacyReturned':old,'newReturned':new,'newPass':new==expected})
    print(json.dumps({'observedAt':datetime.now(timezone.utc).isoformat(),'environment':'isolated_synthetic','networkRequests':0,
       'productionWrites':0,'candidateDiscoveryOnly':True,'cases':rows},indent=2))
    return 0 if all(r['newPass'] for r in rows) else 1

if __name__=='__main__':raise SystemExit(main())
