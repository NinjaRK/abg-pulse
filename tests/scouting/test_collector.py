"""Adversarial collector tests. All pages and provider responses are synthetic."""
import copy
import json
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from scouting.collector import (
    CollectorError, canonical_url, allowed_url, date_observation, discover_html,
    discover_feed, discover_sec, inspect_html, collect_source, robots_decision, PublicTransport,
)
from scouting.run_probe import validate_register

BASE='https://example.com/releases/'
SOURCE={'id':'test','name':'Example source','allowedHosts':['example.com'],
        'seedUrls':[BASE],'adapter':'html','candidatePatterns':[r'/news/',r'\.pdf(?:$|\?)'],
        'listingPatterns':[r'/releases/'],'probeMode':'public_metadata_only',
        'rightsStatus':'review_required','productionEnabled':False}

def discover(html):return discover_html(html,BASE,SOURCE)

def response(url,html):return url, {'content-type':'text/html; charset=utf-8'},html.encode()

class DiscoveryTests(unittest.TestCase):
    def test_dated_descriptive_control(self):
        data=discover('<article><time>September 21, 2026</time><a href="/news/one">Company opens factory</a></article>')
        self.assertEqual(len(data['candidates']),1)
    def test_missing_listing_date_is_a_candidate_not_discarded(self):
        data=discover('<a href="/news/one">Company opens factory</a>')
        self.assertEqual(len(data['candidates']),1)
        self.assertIsNone(data['candidates'][0]['publication']['value'])
        self.assertFalse(data['candidates'][0]['publishable'])
    def test_generic_download_preserves_attachment(self):
        row=discover('<h2>Company appointment notice</h2><a href="/docs/notice.pdf">Download</a>')['candidates'][0]
        self.assertEqual(row['kind'],'attachment');self.assertEqual(row['title'],'Company appointment notice')
    def test_forty_five_candidates_no_silent_thirty_cap(self):
        data=discover(''.join(f'<a href="/news/{i}">Company document {i}</a>' for i in range(45)))
        self.assertEqual(len(data['candidates']),45)
    def test_two_query_ids_are_two_documents(self):
        rows=discover('<a href="/news/item?id=1">One report</a><a href="/news/item?id=2">Two report</a>')['candidates']
        self.assertEqual(len(rows),2);self.assertNotEqual(rows[0]['id'],rows[1]['id'])
    def test_unicode_link_text_survives(self):
        rows=discover('<a href="/news/item">हिंडाल्को कंपनी की नई परियोजना</a>')['candidates']
        self.assertIn('हिंडाल्को',rows[0]['title'])
    def test_duplicate_known_trackers_collapse(self):
        rows=discover('<a href="/news/item?id=1&amp;utm_source=x">One report</a><a href="/news/item?id=1&amp;utm_source=y">One report</a>')['candidates']
        self.assertEqual(len(rows),1)
    def test_short_heading_and_generic_link_do_not_disappear(self):
        self.assertEqual(len(discover('<a href="/news/x">Read more</a>')['candidates']),1)
    def test_pagination_kept_separate_from_articles(self):
        data=discover('<a rel="next" href="/releases/?page=2">Next</a><a href="/news/x">Report</a>')
        self.assertEqual(data['nextPages'],['https://example.com/releases/?page=2'])
        self.assertEqual(len(data['candidates']),1)
    def test_do_not_fetch_external_anchor(self):
        self.assertEqual(discover('<a href="https://evil.test/news/x">Article</a>')['candidates'],[])
    def test_no_results_is_not_assumed_no_news(self):
        self.assertEqual(discover('<div id="app"></div>')['pageState'],'empty_or_unrecognised')
    def test_nested_tags_entity_decode_and_duplicate_labels(self):
        rows=discover('<a href="/news/x"><strong>A &amp; B</strong></a><a href="/news/x">Read more</a>')['candidates']
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['title'],'A & B')

class DateTests(unittest.TestCase):
    def test_missing_date(self):self.assertEqual(date_observation(None)['state'],'unknown')
    def test_invalid_calendar(self):self.assertEqual(date_observation('2026-02-30')['state'],'unparsed')
    def test_missing_timezone_is_not_guessed(self):self.assertEqual(date_observation('2026-09-21T12:00:00')['state'],'unparsed')
    def test_future_not_publishable(self):self.assertEqual(date_observation('2099-01-01')['state'],'future')
    def test_day_precision_kept(self):self.assertEqual(date_observation('2026-08-05')['precision'],'day')
    def test_rss_timezone_normalized(self):self.assertEqual(date_observation('Mon, 21 Sep 2026 00:00:00 +0530')['value'],'2026-09-20T18:30:00+00:00')
    def test_detail_meta_publication_not_fetch_clock(self):
        row=inspect_html('<h1>Report</h1><meta property="article:published_time" content="2026-08-05T10:12:00Z">','https://example.com/news/x',SOURCE)
        self.assertEqual(row['publication']['value'],'2026-08-05T10:12:00+00:00')
    def test_updated_is_not_published(self):
        row=inspect_html('<h1>Report</h1><meta property="article:modified_time" content="2026-09-20T10:12:00Z">','https://example.com/news/x',SOURCE)
        self.assertEqual(row['publication']['state'],'unknown')
        self.assertIsNotNone(row['modified']['value'])
    def test_jsonld_and_safe_text(self):
        row=inspect_html('<h1>Title</h1><script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-08-05","headline":"Original title"}</script><main>Body<script>bad()</script></main>','https://example.com/news/x',SOURCE)
        self.assertEqual(row['publication']['value'],'2026-08-05');self.assertEqual(row['bodyCharacterCount'],4)
    def test_captcha_page_not_article(self):
        self.assertEqual(inspect_html('<title>Just a moment...</title>','https://example.com/news/x',SOURCE)['retrievalStatus'],'blocked_page')

class FeedTests(unittest.TestCase):
    def test_rss(self):
        xml='<rss><channel><item><title>News</title><link>https://example.com/news/x</link><pubDate>Mon, 21 Sep 2026 00:00:00 GMT</pubDate></item></channel></rss>'
        self.assertEqual(len(discover_feed(xml,BASE,SOURCE)['candidates']),1)
    def test_atom_update_date_separate(self):
        xml='<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>News</title><link href="https://example.com/news/x"/><updated>2026-09-20T00:00:00Z</updated></entry></feed>'
        row=discover_feed(xml,BASE,SOURCE)['candidates'][0]
        self.assertEqual(row['publication']['state'],'unknown');self.assertIsNotNone(row['modified']['value'])
    def test_bad_feed_fails_not_empty_success(self):
        with self.assertRaises(CollectorError):discover_feed('<html><body>Login</body></html>',BASE,SOURCE)
    def test_entity_expansion_rejected(self):
        with self.assertRaises(CollectorError):discover_feed('<!DOCTYPE rss [<!ENTITY x "hello">]><rss/>',BASE,SOURCE)
    def test_unsafe_feed_link_accounted(self):
        data=discover_feed('<rss><channel><item><link>http://127.0.0.1/x</link></item></channel></rss>',BASE,SOURCE)
        self.assertEqual(len(data['rejected']),1)
    def test_sec_records_and_history_pages(self):
        s={**SOURCE,'issuer':'Example','cik':'0000000001'}
        data=discover_sec({'cik':1,'filings':{'recent':{'accessionNumber':['0000000001-26-000001'],'primaryDocument':['a.htm'],'filingDate':['2026-08-01'],'form':['8-K']},'files':[{'name':'CIK0000000001-submissions-001.json'}]}},BASE,s)
        self.assertEqual(len(data['candidates']),1);self.assertEqual(len(data['nextPages']),1)
    def test_sec_array_mismatch_rejected(self):
        with self.assertRaises(CollectorError):discover_sec({'accessionNumber':['x'],'primaryDocument':[],'filingDate':[],'form':[]},BASE,{**SOURCE,'cik':'1','issuer':'Example'})
    def test_sec_wrong_issuer_rejected(self):
        with self.assertRaises(CollectorError):discover_sec({'cik':2},BASE,{**SOURCE,'cik':'1','issuer':'Example'})

class SafetyTests(unittest.TestCase):
    def test_known_tracking_only(self):self.assertEqual(canonical_url('https://example.com/doc?ID=12&token=x&utm_source=y'),'https://example.com/doc?ID=12&token=x')
    def test_query_order_preserved(self):self.assertEqual(canonical_url('https://example.com/doc?b=2&a=1&a=3'),'https://example.com/doc?b=2&a=1&a=3')
    def test_urls_refuse_credentials_local_schemes_ports(self):
        for u in ['http://example.com/','javascript:alert(1)','https://user:pass@example.com/','https://example.com:444/','https://example.com\\@evil.test/','https://example.com./']:
            with self.subTest(u=u),self.assertRaises(CollectorError):canonical_url(u)
    def test_allowlist_not_suffix_match(self):
        with self.assertRaises(CollectorError):allowed_url('https://example.com.evil.test/',SOURCE['allowedHosts'])
    def test_private_dns_never_connected(self):
        t=PublicTransport(['example.com'])
        with patch('socket.getaddrinfo',return_value=[(2,1,6,'',('127.0.0.1',443))]),patch('socket.create_connection') as con:
            with self.assertRaises(CollectorError):t.raw_get('https://example.com/')
            con.assert_not_called()
    def test_robots_disallow(self):self.assertFalse(robots_decision('User-agent: *\nDisallow: /news','https://example.com/news/x')[0])
    def test_robots_specific_allow(self):self.assertTrue(robots_decision('User-agent: *\nDisallow: /news\nAllow: /news/open','https://example.com/news/open')[0])
    def test_robots_wildcard_end(self):
        self.assertFalse(robots_decision('User-agent: *\nDisallow: /*.pdf$','https://example.com/a.pdf')[0])
    def test_robots_multiple_matching_groups(self):
        text='User-agent: ABGPulseScout\nDisallow: /a\nUser-agent: ABGPulseScout\nDisallow: /b'
        self.assertFalse(robots_decision(text,'https://example.com/b')[0])
    def test_robots_nonfinite_delay_rejected(self):
        with self.assertRaises(CollectorError):robots_decision('User-agent: *\nCrawl-delay: Infinity','https://example.com/')
    def test_restricted_source_no_requests(self):
        with patch('scouting.collector.PublicTransport.get') as fetcher:
            row=collect_source({**SOURCE,'probeMode':'disabled'},fetcher)
            fetcher.assert_not_called();self.assertEqual(row['status'],'rights_or_configuration_pending')
    def test_actual_register_cannot_activate_restricted_sources(self):
        reg=json.loads(Path('scouting/sources.json').read_text());validate_register(reg)
        restricted=next(s for s in reg['sources'] if s['id']=='S006');restricted['probeMode']='public_metadata_only'
        with self.assertRaises(CollectorError):validate_register(reg)
    def test_register_and_queries_are_not_full_coverage_claims(self):
        reg=json.loads(Path('scouting/sources.json').read_text())
        self.assertEqual(len(reg['sources']),71);self.assertFalse(reg['scopeComplete'])
        self.assertTrue(all(s['productionEnabled'] is False for s in reg['sources']))

class PipelineTests(unittest.TestCase):
    def test_detail_date_found_after_undated_listing(self):
        def fetcher(u):return response(u,'<a href="/news/x">New company report</a>' if u==BASE else '<h1>New report</h1><meta property="article:published_time" content="2026-08-05">')
        r=collect_source(SOURCE,fetcher)
        self.assertEqual(r['retrievedDetails'],1);self.assertEqual(r['candidates'][0]['publication']['value'],'2026-08-05')
    def test_page_budget_accounts_for_pending_pages(self):
        def fetcher(u):return response(u,'<a rel="next" href="/releases/?page=2">Next</a><a href="/news/x">News</a>')
        r=collect_source(SOURCE,fetcher,max_pages=1,max_details=0)
        self.assertEqual(len(r['pendingPages']),1);self.assertFalse(r['archiveComplete'])
        self.assertEqual(r['candidates'][0]['retrievalStatus'],'pending_detail_budget')
    def test_multiple_pages_and_cycle(self):
        def fetcher(u):return response(u,'<a rel="next" href="/releases/?page=2">Next</a><a href="/news/one">One</a>' if u==BASE else '<a rel="next" href="/releases/">Next</a><a href="/news/two">Two</a>')
        r=collect_source(SOURCE,fetcher,max_pages=2,max_details=0)
        self.assertEqual(r['candidateCount'],2);self.assertEqual(len(r['pages']),2)
    def test_forty_five_items_accounted_despite_detail_budget(self):
        def fetcher(u):return response(u,''.join(f'<a href="/news/{i}">Company {i}</a>' for i in range(45)))
        r=collect_source(SOURCE,fetcher,max_details=0)
        self.assertEqual(r['candidateCount'],45)
        self.assertTrue(all(c['retrievalStatus']=='pending_detail_budget' for c in r['candidates']))
    def test_fetch_failure_keeps_source_and_error(self):
        def fetcher(u):raise CollectorError('http_503')
        r=collect_source(SOURCE,fetcher)
        self.assertEqual(r['status'],'no_page_retrieved');self.assertEqual(r['errors'][0]['code'],'http_503')
    def test_generic_pdf_is_pending_not_ignored(self):
        r=collect_source(SOURCE,lambda u:response(u,'<h2>Issuer notice</h2><a href="/a.pdf">Download</a>'))
        self.assertEqual(r['candidateCount'],1);self.assertEqual(r['candidates'][0]['retrievalStatus'],'attachment_pending_permission_and_extraction')
    def test_zero_page_budget_is_invalid(self):
        with self.assertRaises(CollectorError):collect_source(SOURCE,lambda u:None,max_pages=0)


class QueryPlanTests(unittest.TestCase):
    def test_all_current_entities_accounted(self):
        from scouting.query_plan import build_query_plans
        entities=json.loads(Path('data/entities.json').read_text())
        self.assertEqual(len(build_query_plans(entities)['plans']),len(entities))
    def test_no_alias_truncation(self):
        from scouting.query_plan import build_query_plans
        p=build_query_plans([{'id':'x','name':'Example','type':'company','aliases':[f'alias{i}' for i in range(15)]}])['plans'][0]
        self.assertEqual(sum(len(b) for b in p['aliasBatches']),16)
    def test_short_and_native_names_preserved_for_review(self):
        from scouting.query_plan import build_query_plans
        p=build_query_plans([{'id':'x','name':'Company','type':'company','aliases':['Vi','हिंडाल्को']}])['plans'][0]
        self.assertIn('Vi',p['shortAliasesRequiringContext']);self.assertIn('हिंडाल्को',p['aliasBatches'][0])
    def test_duplicate_entity_fails(self):
        from scouting.query_plan import build_query_plans
        with self.assertRaises(CollectorError):build_query_plans([{'id':'x','name':'X','type':'person'},{'id':'x','name':'Y','type':'person'}])

class MissingLinkTests(unittest.TestCase):
    def test_missing_feed_link_does_not_become_feed_url(self):
        result=discover_feed('<rss><channel><item><title>Unlinked news</title></item></channel></rss>',BASE,SOURCE)
        self.assertEqual(result['candidates'],[])
        self.assertEqual(result['rejected'][0]['reason'],'missing_feed_link')
    def test_unicode_url_is_encoded_without_losing_identity(self):
        from scouting.collector import canonical_url
        self.assertEqual(canonical_url('https://example.com/हिंदी?id=१&utm_source=test'),'https://example.com/%E0%A4%B9%E0%A4%BF%E0%A4%82%E0%A4%A6%E0%A5%80?id=%E0%A5%A7')

if __name__=='__main__':unittest.main()
