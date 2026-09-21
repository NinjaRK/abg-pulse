"""Generate draft alias batches from the existing canonical entity inventory.

No provider queries are issued and no entity/appointment is freshly verified.
"""
from __future__ import annotations
from .collector import CollectorError

def build_query_plans(entities: list[dict], batch_size: int = 4) -> dict:
    if type(batch_size) is not int or not 1 <= batch_size <= 10:
        raise CollectorError('invalid_query_batch')
    plans=[]; ids=set()
    for e in entities:
        if not e.get('id') or e['id'] in ids: raise CollectorError('duplicate_entity_id')
        ids.add(e['id'])
        aliases=list(dict.fromkeys([e['name']]+e.get('aliases',[])))
        if any(not isinstance(a,str) or not a.strip() for a in aliases): raise CollectorError('invalid_alias')
        plans.append({'entityId':e['id'],'entityType':e['type'],
            'aliasBatches':[aliases[i:i+batch_size] for i in range(0,len(aliases),batch_size)],
            'shortAliasesRequiringContext':[a for a in aliases if len(a)<5],
            'personDisambiguationRequired':e['type']=='person',
            'nativeLanguageAliasesReviewed':False,'queryExecution':'not_connected'})
    return {'schemaVersion':1,'complete':False,'origin':'existing data/entities.json; not fresh source verification',
        'rules':['Do not require the parent Aditya Birla name for distinctive company searches.',
                 'Disambiguate short or common names with sourced location/company/role context.',
                 'Account for every alias batch; no silent truncation.'], 'plans':plans}
