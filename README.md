# ABG Pulse v5.0

ABG Pulse is a mobile-first corporate and narrative intelligence PWA for the Aditya Birla Group universe. It turns repeated public coverage into evidence-backed events and gives a senior user a one-minute view of what changed, why it matters, what may become important next and where every fact came from.

## Governed coverage

- **42/42 official ABG company entries** reconciled to the official Companies page.
- **40/40 official ABG leadership entries** reconciled to the official Leadership page.
- **192 governed entities:** 44 companies, 47 people, 17 brands, 3 initiatives, 80 material stakeholders and the Group.
- **14 governed discovery groups**, **16 direct official-source watches** and **84 governed source domains**.
- Live registry drift checks flag official company/leadership changes.

## Job meter

The Control Room and sidebar show a transparent weighted job meter. It currently reports **37% verified completion** against 12 governed milestones. The meter moves only when acceptance evidence exists; blocked infrastructure and the 30-day proof remain visible.

See `data/build-milestones.json`, `docs/MILESTONE_PLAN.md` and `docs/RESOURCE_READINESS.md`.

## Experience

Today (Must Know / Watch / Other), Watching, Narrative Radar, Ask Pulse, Search and Control Room. Every major heading and score has a clickable explanation. The period can be changed from one hour to 30 days or an exact custom range.

## Intelligence measures

Materiality, Certainty, Momentum, Media Tone, Observed Open-Public Sentiment, Narrative Drift and 6/24/72-hour importance forecasts remain separate. Media Tone is not public opinion. Open-public sentiment always shows sample size, channels and confidence. Full X, LinkedIn, Instagram, TikTok and comment-level coverage requires authorised or licensed access.

## Modes

- **Live on demand:** works without credentials and scans when opened/refreshed.
- **Persistent:** connect Supabase and n8n for shared history and scheduled scans.

## Run and verify

```bash
npm run serve
npm test
npm run check
python scripts/render_qa.py
```

Use `?demo=1` only for deterministic interface review. Demo events are never silently served in production mode.

## Persistence

Run `db/schema.sql`, then `db/seed.sql`, set the server-side environment variables, and import `workflows/n8n-abg-pulse.json`. Optional authorised social observations use `api/social-ingest.js` and `workflows/n8n-social-listening.json`.

## Completion boundary

The product architecture and public/official live-on-demand build are complete. Full closed-platform sentiment requires external data rights. A 9–10/10 dependability claim still requires a 30-day live shadow benchmark; it cannot be honestly pre-declared.
