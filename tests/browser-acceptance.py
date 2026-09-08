"""Local browser acceptance. QA fixtures are not production or factual-recall proof."""
import json, os, shutil, subprocess, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('BROWSER_PROOF_DIR', '/mnt/data/abg-browser-proof'))
OUT.mkdir(parents=True, exist_ok=True)
report = {'environment': 'local_chromium', 'fixtureMode': 'existing_explicit_qa_mode', 'productionAcceptance': False, 'checks': []}
log = (OUT / 'server.log').open('w')
server = subprocess.Popen(['node','scripts/serve.mjs'],cwd=ROOT,env={**os.environ,'PORT':'4173'},stdout=log,stderr=log)
def passed(name): report['checks'].append({'check':name,'pass':True})
try:
    for _ in range(30):
        try:
            urllib.request.urlopen('http://127.0.0.1:4173/registry',timeout=1);break
        except Exception: time.sleep(.1)
    with sync_playwright() as p:
        exe = os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium')
        browser = p.chromium.launch(**({'executable_path':exe} if exe else {}),args=['--no-sandbox'])
        page = browser.new_page(viewport={'width':1365,'height':1000})
        errors = []; page.on('pageerror',lambda error:errors.append(str(error)))
        page.add_init_script('window.__ABG_PULSE_QA__ = true;')
        page.goto('http://127.0.0.1:4173/?qa=1',wait_until='domcontentloaded')
        expect(page.locator('#sidebar-build-progress')).to_have_text('40%')
        page.locator('#period-select').select_option('30d')
        detail = page.locator('#view-today [data-action="detail"]').first
        expect(detail).to_be_visible();detail.click();expect(page.locator('#story-dialog')).to_be_visible()
        page.get_by_role('button',name='Close story',exact=True).click()
        passed('Home loads, 30-day filter works and evidence dialog opens/closes')
        watch = page.locator('#view-today [data-action="watch"]').first
        before = page.evaluate("localStorage.getItem('abg-pulse:watched:v1')")
        watch.click(); after = page.evaluate("localStorage.getItem('abg-pulse:watched:v1')")
        assert before != after
        page.reload(wait_until='domcontentloaded');expect(page.locator('#sidebar-build-progress')).to_have_text('40%')
        assert page.evaluate("localStorage.getItem('abg-pulse:watched:v1')") == after
        passed('Watch toggle persists through reload on the same device')
        page.locator('.sidebar [data-view="search"]').click();page.locator('#search-input').fill('Novelis')
        expect(page.locator('#view-search')).to_be_visible();passed('Search navigation and query input work')
        page.locator('.sidebar [data-view="control"]').click();expect(page.locator('#control-heading')).to_be_visible()
        page.goto('http://127.0.0.1:4173/registry',wait_until='domcontentloaded');expect(page.locator('#records article')).to_have_count(21)
        passed('Control room renders and the research register loads at /registry')
        page.locator('#kind').select_option('ownership');expect(page.locator('#records article')).to_have_count(9)
        page.locator('#query').fill('Novelis');expect(page.locator('#records article')).to_have_count(2)
        assert 'indirect ownership' in page.locator('#records').inner_text()
        page.locator('#query').fill('');page.locator('#basis').select_option('historical_snapshot');expect(page.locator('#records article')).to_have_count(2)
        assert 'Historical only' in page.locator('#records').inner_text()
        passed('Ownership, search and historical filters return expected source-backed records')
        page.locator('#basis').select_option('all');page.locator('#kind').select_option('leadership');expect(page.locator('#records article')).to_have_count(12)
        assert 'month only' in page.locator('#records').inner_text()
        assert 'change date is not established' in page.locator('#records').inner_text()
        assert page.locator('#records a').evaluate_all("links => links.every(a => a.href.startsWith('https://') && a.rel.includes('noopener'))")
        passed('Date precision, unknown transition dates and safe evidence links are displayed')
        page.locator('#kind').select_option('all');page.screenshot(path=str(OUT/'registry-desktop.png'),full_page=True)
        page.set_viewport_size({'width':390,'height':844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path=str(OUT/'registry-mobile.png'),full_page=True)
        passed('Registry fits a 390-pixel mobile viewport without horizontal overflow')
        page.locator('#query').fill('unmatched-integration-test-query');expect(page.locator('#records article')).to_have_count(0)
        expect(page.get_by_text('No matching records. Change the search or filters.')).to_be_visible()
        passed('Empty search has an explicit recoverable state')
        page.route('**/data/entity-history.json',lambda route:route.fulfill(status=503,content_type='application/json',body='{}'))
        page.reload(wait_until='domcontentloaded');expect(page.locator('#error')).to_be_visible();expect(page.locator('#records article')).to_have_count(0)
        passed('Source outage shows an error rather than records or a healthy claim')
        page.unroute('**/data/entity-history.json')
        bad=json.loads((ROOT/'data/entity-history.json').read_text());bad['sources'][0]['url']='javascript:alert(1)'
        page.route('**/data/entity-history.json',lambda route:route.fulfill(status=200,content_type='application/json',body=json.dumps(bad)))
        page.reload(wait_until='domcontentloaded');expect(page.locator('#error')).to_be_visible();expect(page.locator('#records article')).to_have_count(0)
        passed('Invalid source URLs fail validation before rendering')
        assert not errors, errors
        passed('No uncaught JavaScript exceptions in the tested local journey')
        prod=browser.new_page(viewport={'width':1365,'height':1000})
        try:
            response=prod.goto('https://abg-pulse-intelligence-v4.vercel.app',wait_until='domcontentloaded',timeout=10000)
            report['productionProbe']={'httpStatus':response.status if response else None,'title':prod.title(),'acceptanceCompleted':False}
            prod.screenshot(path=str(OUT/'production-probe.png'))
        except Exception as exc: report['productionProbe']={'error':str(exc)[:600],'acceptanceCompleted':False}
        browser.close()
    report['localPass']=True
except Exception as exc:
    report['localPass']=False;report['error']=str(exc)
    raise
finally:
    server.terminate()
    try: server.wait(timeout=3)
    except subprocess.TimeoutExpired: server.kill();server.wait()
    log.close();(OUT/'browser-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
