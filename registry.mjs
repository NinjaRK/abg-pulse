import { dateLabel, safeSourceUrl, selectRecords, validateEntityHistory } from './lib/entity-history.mjs';
const $ = s => document.querySelector(s);
const node = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
try {
  const load = async url => { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`Record source unavailable (HTTP ${r.status}).`); return r.json(); };
  const [data, base] = await Promise.all([load('/data/entity-history.json'), load('/data/entities.json')]);
  const validation = validateEntityHistory(data, base);
  if (!validation.valid) throw new Error('The research records failed validation; nothing has been displayed.');
  const names = new Map([...base, ...data.additionalEntities].map(e => [e.id, e.name]));
  const sources = new Map(data.sources.map(s => [s.id, s]));
  function render() {
    const rows = selectRecords(data, base, { query: $('#query').value, kind: $('#kind').value, basis: $('#basis').value });
    $('#records').replaceChildren();
    $('#status').textContent = `${rows.length} of ${data.records.length} records · sources retrieved ${data.retrievedOn} · coverage incomplete`;
    if (!rows.length) { $('#records').append(node('p', 'No matching records. Change the search or filters.')); return; }
    for (const row of rows) {
      const card = node('article'); card.dataset.recordId = row.id;
      card.append(node('span', row.kind === 'ownership' ? 'Ownership' : 'Leadership', 'badge'));
      card.append(node('h2', names.get(row.subjectId)));
      card.append(node('p', `${row.kind === 'ownership' ? 'Owner: ' : 'Organisation: '}${names.get(row.relatedEntityId)}`, 'sub'));
      let description = row.label;
      if (row.kind === 'ownership') description = `${row.percentage === null ? 'Percentage not reported' : `${row.percentage}%${row.percentagePrecision === 'rounded' ? ' (rounded in source)' : ''}`} · ${row.directness.replaceAll('_', ' ')} ownership`;
      card.append(node('p', description));
      const dates = node('dl', undefined, 'dates');
      for (const [term, value] of [['Effective from', dateLabel(row.effectiveFrom)], ['Evidence as of', row.sourceAsOf || 'Undated official page'], ['Effective to', dateLabel(row.effectiveTo)], ['Retrieved', data.retrievedOn]]) {
        const pair = node('div'); pair.append(node('dt', term), node('dd', value)); dates.append(pair);
      }
      card.append(dates, node('p', row.basis === 'historical_snapshot' ? 'Historical only. Do not use as a current holding.' : row.basis === 'filing_snapshot' ? 'Filing-date observation. Current status is not asserted.' : 'Observed on an official page. Continued tenure or ownership is not guaranteed.', 'sub'));
      if (row.previousObservationId) card.append(node('p', `Earlier observation retained: ${row.previousObservationId}. The change date is not established.`, 'sub'));
      const evidence = node('div', undefined, 'sources'); evidence.append(node('p', row.locator));
      row.sourceIds.forEach(id => { const source = sources.get(id); const p = node('p'); const a = node('a', source.title); a.href = safeSourceUrl(source.url); a.target = '_blank'; a.rel = 'noopener noreferrer'; p.append(a); evidence.append(p); });
      card.append(evidence); $('#records').append(card);
    }
  }
  $('#filters').addEventListener('submit', event => event.preventDefault());
  $('#query').addEventListener('input', render); $('#kind').addEventListener('change', render); $('#basis').addEventListener('change', render); render();
} catch (error) {
  $('#records').replaceChildren(); $('#status').textContent = 'Records unavailable; no verified-current status is claimed.';
  $('#error').hidden = false; $('#error').textContent = error.message || 'Research records could not be loaded.';
}
