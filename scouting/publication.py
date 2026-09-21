"""Narrow publication-date adapters, preserving precision and provenance.

Selectors come from dated metadata observations, not guessed timezone offsets.
A source-reported date is not independent verification or publishing approval.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

MONTHS = {name.lower(): i for i, name in enumerate(
    'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(), 1)}
DAY_WITH_OFFSET = re.compile(r'^(\d{1,2}) ([A-Za-z]{3}), (\d{4}) ([+-])(\d{2})(\d{2})$')
MONTH_DAY = re.compile(
    r'^(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+(\d{1,2}),?\s+(\d{4})(?=\s|$)', re.I)


def observed_feed_day(value, now=None):
    """SEBI's day-only +0530 is a local calendar day, not midnight UTC."""
    if not isinstance(value, str):
        return None
    match = DAY_WITH_OFFSET.fullmatch(' '.join(value.split()))
    if not match:
        return None
    result = {'raw': value, 'value': None, 'precision': None, 'state': 'unparsed'}
    day, month, year, sign, hours, minutes = match.groups()
    try:
        if int(hours) > 23 or int(minutes) > 59:
            return result
        offset = timedelta(hours=int(hours), minutes=int(minutes)) * (-1 if sign == '-' else 1)
        zone = timezone(offset)
        reported = datetime(int(year), MONTHS[month.lower()], int(day), tzinfo=zone)
        clock = now or datetime.now(timezone.utc)
        if clock.utcoffset() is None:
            raise ValueError('An aware evaluation clock is required.')
        return {**result, 'value': reported.date().isoformat(), 'precision': 'day',
                'sourceOffset': f'{sign}{hours}:{minutes}',
                'state': 'future' if reported.date() > clock.astimezone(zone).date() else 'source_reported'}
    except (ValueError, KeyError, OverflowError):
        return result


def _has_class(node, token):
    return node is not None and token in node.attrs.get('class', '').split()


def _ancestor(node, tag, token):
    node = node.parent
    while node is not None:
        if node.tag == tag and _has_class(node, token):
            return True
        node = node.parent
    return False


def _date_text(text):
    text = ' '.join(text.split())
    if len(text) > 160:
        return None
    match = MONTH_DAY.match(text)
    if not match:
        return None
    try:
        return datetime(int(match[3]), MONTHS[match[1][:3].lower()], int(match[2])).date().isoformat()
    except (ValueError, KeyError):
        return None


def reconcile_publications(*observations):
    """Keep disagreement visible; never let a missing detail erase a feed date."""
    evidence = []
    for observation in observations:
        if not isinstance(observation, dict):
            continue
        if observation.get('evidence'):
            evidence.extend(observation['evidence'])
        elif observation.get('raw') is not None or observation.get('state') not in (None, 'unknown'):
            evidence.append({k: v for k, v in observation.items() if k != 'evidence'})
    unique = []
    for item in evidence:
        if item not in unique:
            unique.append(item)
    valid = [e for e in unique if e.get('value') is not None and e.get('state') in {'source_reported', 'future'}]
    inherited_conflict = any(isinstance(o, dict) and o.get('state') == 'conflicting' for o in observations)
    days = {e['value'][:10] for e in valid}
    instants = {e['value'] for e in valid if e.get('precision') == 'instant'}
    if inherited_conflict or len(days) > 1 or len(instants) > 1:
        return {'raw': None, 'value': None, 'precision': None, 'state': 'conflicting', 'evidence': unique}
    if valid:
        # Preserve an actually supplied instant when consistent with day-only hints.
        chosen = next((e for e in valid if e.get('precision') == 'instant'), valid[0])
        return {**chosen, 'evidence': unique}
    return {'raw': None, 'value': None, 'precision': None,
            'state': 'unparsed' if unique else 'unknown', 'evidence': unique}


def source_publication(nodes, url, source, parser):
    """Recognise only the inspected source's release header; ignore body dates."""
    u = urlsplit(url)
    novelis = source.get('id') == 'S003' and u.hostname == 'investors.novelis.com' and u.path.startswith('/news-events/press-releases/detail/')
    sebi = source.get('id') == 'S017' and u.hostname == 'www.sebi.gov.in' and bool(re.match(r'^/(enforcement|media-and-notifications|legal)/', u.path))
    found = []
    for node in nodes:
        locator = None
        if novelis and _ancestor(node, 'article', 'full-news-article'):
            if node.tag == 'time' and _has_class(node, 'date') and _has_class(node.parent, 'related-documents-line'):
                locator = 'article.full-news-article .related-documents-line time.date'
            elif node.tag == 'p' and _has_class(node, 'spr-ir-news-article-date'):
                locator = 'article.full-news-article p.spr-ir-news-article-date'
        if sebi and node.tag == 'h5' and _has_class(node.parent, 'date_value') and _ancestor(node, 'section', 'main_section'):
            locator = 'section.main_section .date_value h5'
        if locator is None:
            continue
        visible = node.text()
        day = _date_text(visible)
        observation = parser(day) if day else parser(None)
        observation.update(raw=visible[:160], locator=locator, sourceUrl=url,
                           basis='source_release_header', state=observation['state'] if day else 'unparsed')
        if node.attrs.get('datetime'):
            observation['machineTimeRaw'] = node.attrs['datetime'][:120]
            observation['machineTimezoneAssumed'] = False
            # A valid machine date that disagrees with the visible date is evidence,
            # not permission to quietly choose whichever makes the item look newer.
            raw_time = node.attrs['datetime']
            if re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?', raw_time):
                try:
                    dt = datetime.fromisoformat(raw_time)
                    if day and dt.date().isoformat() != day:
                        found.append({**parser(dt.date().isoformat()), 'raw': raw_time,
                                      'locator': locator + '[datetime] (day only)',
                                      'basis': 'source_release_header', 'sourceUrl': url})
                except ValueError:
                    pass
        found.append(observation)
    return reconcile_publications(*found)
