"""Synthetic publication-date cases based on separately observed source markup."""
import unittest
from datetime import datetime, timezone
from scouting.collector import date_observation, inspect_html, collect_source
from scouting.publication import reconcile_publications, observed_feed_day

N_URL='https://investors.novelis.com/news-events/press-releases/detail/1/example'
S_URL='https://www.sebi.gov.in/enforcement/orders/sep-2026/example.html'
N={'id':'S003','allowedHosts':['investors.novelis.com']}
S={'id':'S017','allowedHosts':['www.sebi.gov.in']}

def nhtml(date='August 05, 2026',machine='2026-08-05T06:12:00'):
    return f'<h1>Example result</h1><article class="full-news-article"><div class="related-documents-line row"><time class="date" datetime="{machine}">{date}</time></div><p>Quarter ended June 30, 2026</p></article><footer><time datetime="2026">2026</time></footer>'

def inspect(html=nhtml(),url=N_URL,source=N):
    return inspect_html(html,url,source)['publication']

class FeedDayTests(unittest.TestCase):
    def test_sebi_day_offset_is_not_an_instant(self):
        o=date_observation('17 Sep, 2026 +0530')
        self.assertEqual((o['value'],o['precision'],o['sourceOffset']),('2026-09-17','day','+05:30'))
        self.assertNotIn('T',o['value'])
    def test_offset_local_day_boundary(self):
        o=date_observation('22 Sep, 2026 +0530',datetime(2026,9,21,20,0,tzinfo=timezone.utc))
        self.assertEqual(o['state'],'source_reported')
    def test_future_in_supplied_zone(self):
        o=date_observation('22 Sep, 2026 +0530',datetime(2026,9,21,10,0,tzinfo=timezone.utc))
        self.assertEqual(o['state'],'future')
    def test_bad_offset_rejected(self):
        for raw in ['17 Sep, 2026 +2460','17 Sep, 2026 +1260','17 Sep, 2026 -2500']:
            with self.subTest(raw=raw):self.assertIsNone(date_observation(raw)['value'])
    def test_invalid_calendar_rejected(self):
        self.assertEqual(date_observation('31 Feb, 2026 +0530')['state'],'unparsed')
    def test_leap_date_preserved(self):
        self.assertEqual(date_observation('29 Feb, 2024 +0530')['value'],'2024-02-29')
    def test_wrong_month_not_fabricated(self):
        self.assertEqual(date_observation('17 Bad, 2026 +0530')['state'],'unparsed')
    def test_naive_evaluation_clock_not_assumed_utc(self):
        self.assertEqual(observed_feed_day('17 Sep, 2026 +0530',datetime(2026,9,21))['state'],'unparsed')

class HeaderTests(unittest.TestCase):
    def test_novelis_header_date_preserves_day(self):
        o=inspect();self.assertEqual((o['value'],o['precision']),('2026-08-05','day'))
        self.assertEqual(o['machineTimeRaw'],'2026-08-05T06:12:00');self.assertFalse(o['machineTimezoneAssumed'])
    def test_footer_time_not_publication(self):
        self.assertEqual(inspect('<h1>Title</h1><footer><time class="date" datetime="2026">2026</time></footer>')['state'],'unknown')
    def test_body_period_end_is_not_publication(self):
        self.assertEqual(inspect('<h1>Title</h1><article class="full-news-article"><p>Quarter ended June 30, 2026</p></article>')['state'],'unknown')
    def test_same_class_on_unrelated_host_not_a_source_adapter(self):
        self.assertEqual(inspect(nhtml(),'https://example.com/news/x',N)['state'],'unknown')
    def test_same_markup_wrong_route_is_ignored(self):
        self.assertEqual(inspect(nhtml(),'https://investors.novelis.com/other/',N)['state'],'unknown')
    def test_same_markup_unknown_source_id_is_ignored(self):
        self.assertEqual(inspect(nhtml(),N_URL,{'id':'other'})['state'],'unknown')
    def test_two_header_days_remain_conflicting(self):
        html=nhtml().replace('</article>','<p class="spr-ir-news-article-date">August 6, 2026</p></article>')
        o=inspect(html);self.assertEqual(o['state'],'conflicting');self.assertIsNone(o['value'])
    def test_visible_machine_date_disagreement_is_conflict(self):
        self.assertEqual(inspect(nhtml(machine='2026-08-06T06:12:00'))['state'],'conflicting')
    def test_future_header_is_not_current(self):
        self.assertEqual(inspect(nhtml('August 5, 2099','2099-08-05T06:12:00'))['state'],'future')
    def test_malformed_header_not_invented(self):
        self.assertEqual(inspect(nhtml('February 31, 2026','2026-02-31T06:12:00'))['state'],'unparsed')
    def test_no_visible_date_does_not_assign_timezone_to_machine_time(self):
        self.assertIsNone(inspect(nhtml('','2026-08-05T06:12:00'))['value'])
    def test_sebi_header_has_source_locator(self):
        html='<h1>Order</h1><section class="main_section"><div class="date_value"><h5>Sep 17, 2026</h5></div></section>'
        o=inspect(html,S_URL,S);self.assertEqual(o['value'],'2026-09-17');self.assertIn('date_value',o['locator'])
    def test_sebi_date_outside_main_section_is_not_publication(self):
        self.assertEqual(inspect('<h1>Order</h1><div class="date_value"><h5>Sep 17, 2026</h5></div>',S_URL,S)['state'],'unknown')
    def test_ultratech_unlabelled_period_end_remains_unknown(self):
        self.assertIsNone(inspect('<h1>Results Q1FY24</h1><p>Quarter ended June 30, 2023</p>','https://www.ultratechcement.com/corporate/media/press-releases/example',{'id':'S005'})['value'])
    def test_raw_date_evidence_does_not_enable_publication(self):
        result=inspect_html(nhtml(),N_URL,N);self.assertFalse(result['publishable']);self.assertEqual(result['statementVerification'],'not_performed')

class ReconciliationTests(unittest.TestCase):
    def test_valid_feed_survives_missing_detail(self):
        a=date_observation('17 Sep, 2026 +0530');b=date_observation(None)
        self.assertEqual(reconcile_publications(a,b)['value'],'2026-09-17')
    def test_feed_detail_disagreement_is_not_silently_overwritten(self):
        a=date_observation('17 Sep, 2026 +0530');b=date_observation('September 18, 2026')
        o=reconcile_publications(a,b);self.assertEqual(o['state'],'conflicting');self.assertEqual(len(o['evidence']),2)
    def test_feed_detail_agreement_retains_both_locators(self):
        a={**date_observation('2026-09-17'),'locator':'feed'};b={**a,'locator':'header'}
        o=reconcile_publications(a,b);self.assertEqual(o['value'],'2026-09-17');self.assertEqual(len(o['evidence']),2)
    def test_conflict_cannot_be_erased_by_later_missing_date(self):
        a=reconcile_publications(date_observation('2026-09-17'),date_observation('2026-09-18'))
        self.assertEqual(reconcile_publications(a,date_observation(None))['state'],'conflicting')
    def test_actual_instant_preserved_when_day_agrees(self):
        a=date_observation('2026-09-17');b=date_observation('2026-09-17T12:00:00Z')
        self.assertEqual(reconcile_publications(a,b)['precision'],'instant')
    def test_two_different_instants_require_resolution(self):
        self.assertEqual(reconcile_publications(date_observation('2026-09-17T12:00:00Z'),date_observation('2026-09-17T13:00:00Z'))['state'],'conflicting')
    def test_whole_feed_detail_pipeline(self):
        src={**S,'name':'Test','seedUrls':['https://www.sebi.gov.in/rss.xml'],'adapter':'feed','probeMode':'public_metadata_only','rightsStatus':'review_required'}
        def fetch(u):
            text=f'<rss><channel><item><title>Order</title><link>{S_URL}</link><pubDate>17 Sep, 2026 +0530</pubDate></item></channel></rss>' if u.endswith('.xml') else '<h1>Order</h1><section class="main_section"><div class="date_value"><h5>Sep 17, 2026</h5></div></section>'
            return u,{'content-type':'text/html'},text.encode()
        o=collect_source(src,fetch)['candidates'][0]
        self.assertEqual(o['publication']['value'],'2026-09-17');self.assertFalse(o['publishable'])

if __name__=='__main__':unittest.main()
