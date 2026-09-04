# Scheduled ingestion

ABG Pulse can run a secure hourly overlap scan using Vercel Cron. The endpoint is dormant and performs no external work until `CRON_SECRET`, `INGEST_SECRET`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` are configured server-side.

Once configured, each run scans a two-hour overlap window and sends an idempotency key to the existing ingest endpoint. Source failures remain visible in the stored scan metadata. No secret is committed to this public repository.
