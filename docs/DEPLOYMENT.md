# Deployment

ABG Pulse v5 deployment source of truth is the `main` branch of `NinjaRK/abg-pulse`.

The repository is connected to the Vercel project `abg-pulse-intelligence-v4`.

## Release gate

A release is successful only when all of these pass for the exact deployed commit:

1. The public homepage returns HTTP 200 and renders ABG Pulse.
2. `/api/health` returns valid JSON and the governed entity universe is reconciled.
3. `/api/scan` returns valid intelligence JSON, source-health detail and no demonstration fallback.
4. `/api/progress` returns the evidence-weighted milestone Job Meter.

## Current recovery trigger

The precision-hardening commit `f9e1977b46461f3be2d2af92dfdd2b55b8eab31d` was accepted by GitHub but Vercel marked that individual deployment as blocked. This follow-up commit is intentionally authored through the connected GitHub account to re-establish a deployable author identity without changing the verified product code.

Do not report the release as complete until the production endpoints pass again.
