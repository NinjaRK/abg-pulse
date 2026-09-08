import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dateParts,dateLabel,selectRecords,validateEntityHistory } from '../lib/entity-history.mjs';
const data=JSON.parse(readFileSync(new URL('../data/entity-history.json',import.meta.url)));
const base=JSON.parse(readFileSync(new URL('../data/entities.json',import.meta.url)));
test('research batch has evidence for all 21 observations without altering the base registry',()=>{assert.equal(base.length,192);assert.equal(data.records.length,21);assert.deepEqual(validateEntityHistory(data,base),{valid:true,errors:[]});});
test('month precision and unknown dates are not converted to exact appointment dates',()=>{assert.equal(dateParts('2026-02').precision,'month');assert.equal(dateLabel('2026-02'),'2026-02 (month only)');assert.equal(dateLabel(null),'Not established');});
for(const value of ['2026-02-30','2026-13','2025-02-29','',123,true]) test(`calendar rejects ${JSON.stringify(value)}`,()=>assert.equal(dateParts(value),null));
for(const [name,mutate] of [
 ['orphan evidence',d=>d.records[0].sourceIds=['missing']],['duplicate record',d=>d.records.push(d.records[0])],['unknown entity',d=>d.records[0].subjectId='missing'],['string ownership',d=>d.records[0].percentage='100'],['over-100 ownership',d=>d.records[0].percentage=101],['missing dated as-of',d=>d.records[0].sourceAsOf=null],['javascript source',d=>d.sources[0].url='javascript:alert(1)'],['credential URL',d=>d.sources[0].url='https://secret:pass@example.com'],['wrong prior entity',d=>d.records.at(-1).previousObservationId=d.records[0].id],['future effective date',d=>d.records[0].effectiveFrom='2030-01-01'],['false completeness',d=>d.complete=true]
]) test(`registry rejects ${name}`,()=>{const d=structuredClone(data);mutate(d);assert.equal(validateEntityHistory(d,base).valid,false);});
test('historical ownership stays separately filterable and unknown percentages stay null',()=>{assert.equal(selectRecords(data,base,{basis:'historical_snapshot'}).length,2);assert.equal(selectRecords(data,base,{query:'Novelis',kind:'leadership'}).length,9);assert.ok(data.records.some(x=>x.percentage===null));});
test('indirect and direct ownership are not merged or double-counted',()=>{const rows=selectRecords(data,base,{kind:'ownership',query:'Novelis'});assert.equal(rows.length,2);assert.deepEqual(new Set(rows.map(r=>r.directness)),new Set(['direct','indirect']));});
test('new permanent title retains prior interim observation without inventing transition day',()=>{const row=data.records.at(-1);assert.ok(row.previousObservationId);assert.equal(row.effectiveFrom,null);assert.equal(data.records.at(-2).effectiveTo,null);});
