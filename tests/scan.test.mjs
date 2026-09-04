import test from 'node:test';
import assert from 'node:assert/strict';
import scanHandler from '../api/scan.js';
function mockResponse(){const headers=new Map();return{statusCode:200,body:'',setHeader(n,v){headers.set(String(n).toLowerCase(),v)},end(v=''){this.body=String(v)},json(){return JSON.parse(this.body)},headers}}
function request(){return{method:'GET',url:'/api/scan?start=2026-09-01T00:00:00.000Z&end=2026-09-02T12:00:00.000Z',headers:{host:'abg-pulse.test'}}}
const rss=`<?xml version="1.0"?><rss><channel><item><title>UltraTech Cement announces ₹2,000 crore capacity investment - The Economic Times</title><link>https://news.google.com/rss/articles/ultratech-capacity</link><description>UltraTech Cement announced a major capacity investment in an exchange filing.</description><pubDate>Wed, 02 Sep 2026 08:00:00 GMT</pubDate><source url="https://economictimes.indiatimes.com">The Economic Times</source></item></channel></rss>`;
const atom='<?xml version="1.0"?><feed></feed>',officialHtml='<!doctype html><html><body><main><h1>Newsroom</h1></main></body></html>';
test('scan route always returns JSON and exposes upstream failures instead of crashing',async()=>{const prev=global.fetch;global.fetch=async()=>{throw new Error('upstream unavailable')};try{const res=mockResponse();await scanHandler(request(),res);assert.equal(res.statusCode,200);assert.match(res.headers.get('content-type'),/application\/json/);const body=res.json();assert.deepEqual(body.events,[]);assert.ok(body.meta.queryCount>=60);assert.equal(body.meta.successfulQueries,0);assert.equal(body.meta.errors.length,body.meta.queryCount);assert.equal(body.entityUniverse.officialCompanyEntries,42);assert.equal(body.entityUniverse.officialLeadershipEntries,40)}finally{global.fetch=prev}});
test('scan route deduplicates repeated discovery responses into one evidence-backed event',async()=>{const prev=global.fetch;global.fetch=async(url)=>{const v=String(url);if(v.includes('news.google.com/rss/search'))return{ok:true,status:200,text:async()=>rss};if(v.includes('api.gdeltproject.org'))return{ok:true,status:200,json:async()=>({articles:[]})};if(v.includes('reddit.com/search.rss'))return{ok:true,status:200,text:async()=>atom};return{ok:true,status:200,url:v,text:async()=>officialHtml,headers:{get:()=> 'text/html'}}};try{const res=mockResponse();await scanHandler(request(),res);assert.equal(res.statusCode,200);const body=res.json();assert.equal(body.events.length,1);assert.ok(body.events[0].entityIds.includes('ultratech'));assert.ok(body.events[0].flags.includes('headline-derived'));assert.equal(body.meta.articleCount,1);assert.equal(body.meta.eventCount,1);assert.equal(body.meta.errors.length,0)}finally{global.fetch=prev}});

const precisionRss = `<?xml version="1.0"?><rss><channel>
<item><title>UltraTech Cement announces ₹2,000 crore capacity investment - The Economic Times</title><link>https://news.google.com/rss/articles/ultratech-capacity-precision</link><description>UltraTech Cement announced a major capacity investment in an exchange filing.</description><pubDate>Wed, 02 Sep 2026 08:00:00 GMT</pubDate><source url="https://economictimes.indiatimes.com">The Economic Times</source></item>
<item><title>UltraTech Cement stock to buy: brokerage sets target price - Market Tips</title><link>https://news.google.com/rss/articles/ultratech-stock-tip</link><description>Should investors buy the stock today?</description><pubDate>Wed, 02 Sep 2026 08:30:00 GMT</pubDate><source url="https://markettips.example">Market Tips</source></item>
<item><title>Five stocks investors are discussing today - Daily Roundup</title><link>https://news.google.com/rss/articles/daily-roundup</link><description>The list briefly mentions UltraTech Cement among many shares.</description><pubDate>Wed, 02 Sep 2026 09:00:00 GMT</pubDate><source url="https://roundup.example">Daily Roundup</source></item>
</channel></rss>`;
const precisionAtom = `<?xml version="1.0"?><feed><entry><title>Should I buy Vodafone Idea shares now?</title><link href="https://reddit.com/r/india/vi-question"/><updated>2026-09-02T09:30:00Z</updated><content>Anyone have advice?</content><author><name>example-user</name></author></entry></feed>`;

test('scan keeps corporate developments and rejects stock tips, snippet-only roundups and public questions', async () => {
  const prev = global.fetch;
  global.fetch = async (url) => {
    const value = String(url);
    if (value.includes('news.google.com/rss/search')) return { ok: true, status: 200, text: async () => precisionRss };
    if (value.includes('api.gdeltproject.org')) return { ok: true, status: 200, json: async () => ({ articles: [] }) };
    if (value.includes('reddit.com/search.rss')) return { ok: true, status: 200, text: async () => precisionAtom };
    return { ok: true, status: 200, url: value, text: async () => officialHtml, headers: { get: () => 'text/html' } };
  };
  try {
    const res = mockResponse();
    await scanHandler(request(), res);
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.events.length, 1);
    assert.match(body.events[0].headline, /capacity investment/i);
    assert.equal(body.meta.articleCount, 1);
    assert.equal(body.meta.publicConversationItems, 0);
    assert.ok(body.meta.rejectionReasons.routine_market_advice >= 1);
    assert.ok(body.meta.rejectionReasons.entity_only_in_snippet >= 1);
    assert.ok(body.meta.rejectionReasons.public_question >= 1);
    assert.equal(body.meta.serviceVersion, '6.0.0');
  } finally {
    global.fetch = prev;
  }
});
