# ABG Pulse notification policy

## Governing rule

ABG Pulse sends nothing unless a genuinely new or materially updated development passes the verification and materiality gates.

A growing article count, syndicated copies, headline rewrites or routine market commentary are not material changes.

## New-development gate

A new event is notification-eligible only when:

- it is verified by a direct Tier-0 source or corroborated by at least two independent source origins;
- it is not disputed;
- it is Must Know with materiality of at least 60, or a high-materiality Watch item of at least 75;
- it has not already produced the same notification key.

## Material-update gate

An existing event can notify when one or more of these changes:

- priority escalates, especially Watch to Must Know;
- verification strengthens materially;
- direct authoritative evidence appears;
- a new supported material claim appears;
- a material number changes;
- recommended action posture changes;
- a contradiction appears or is resolved;
- an event is corrected or retracted.

A disputed update is held for review rather than automatically delivered.

## Idempotency

Every eligible notification receives a deterministic SHA-256 key based on the event identity, lifecycle, verification, evidence chain and supported material claims. The database reserves this key before delivery. A duplicate reservation is suppressed.

## Delivery evidence

The notification ledger records:

- reserved, sent, failed or suppressed status;
- destination;
- attempt count;
- delivery time;
- response metadata or error;
- the exact alert payload.

## n8n workflow

`n8n/material-change-alerts.json` implements the loop:

1. scan public and official sources;
2. read previous persistent history;
3. read prior notification keys;
4. compare current and previous events;
5. persist the current scan;
6. reserve only unseen eligible notifications;
7. deliver through the configured webhook;
8. record success or failure.

The workflow is intentionally inactive in source control. It requires:

- `PULSE_BASE_URL`
- `PULSE_INGEST_SECRET`
- `PULSE_ALERT_WEBHOOK_URL`

The outbound webhook can connect to an approved Teams, Slack, WhatsApp Business or internal notification service. Gmail and Outlook are not dependencies.

## Silence is not proof

If source health is degraded, the platform must not interpret an empty alert queue as proof that nothing happened. Source failures remain visible in the Trust Centre and production evidence.
