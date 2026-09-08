# Ownership, leadership and remaining release gates

## Research register

Open `/registry` on a deployment containing this change, or run `npm run serve` and use `http://127.0.0.1:4173/registry` locally. The new page is separately addressable; the existing executive-feed navigation and scoring are unchanged.

`data/entity-history.json` contains nine ownership observations and twelve leadership observations from eight primary-source pages. It links to the existing 192-record entity registry and adds eight separately identified entities without rewriting that base dataset. This is an initial batch, not completion of the whole ABG universe.

The data distinguishes direct and indirect holdings, rounded and unreported percentages, exact days and month-only dates, historical filings and undated official-page observations. Retrieval date, source reporting date and effective date are not interchangeable. A missing effective-to date never certifies continued tenure. The 2021 AMC percentages are historical-only. The two Chirag Shah observations retain the interim and subsequent permanent titles without inventing a transition date.

The browser renders text through DOM textContent, permits only validated HTTPS evidence links, and withholds records if source loading or validation fails. Existing product source, existing tests and progress scores are unchanged.

## Existing database, not a new resource

The owner's earlier setup identifies **ABG Pulse Production** under **Personal**, project `kzqymboxilxvdgacwypy`, region Singapore. The current connection lists only the separate BuiltNotBorn project and denies access to the intended project. This is an access problem, not proof that the project does not exist. Do not create a duplicate or repurpose BuiltNotBorn.

`node scripts/production-preflight.mjs` checks the expected project hostname and presence of server-only configuration without printing credentials. It is not a connection or migration test and is not automatically wired into production. After the correct connection is authorised, inspect the existing schema and migration history before applying the repository's evidence migrations. The historical database setup and current evidence schema must be reconciled, not blindly overwritten.

Required configuration belongs in the deployment provider's encrypted server environment, never in source or chat: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and INGEST_SECRET. A present credential is not necessarily valid. The preflight also rejects obvious public-variable exposure.

## Website and verification boundary

Vercel management denies access to the `ninjarks-projects` team. The new data/code cannot be called live until the exact reviewed commit is deployed and independently checked. Reconnect the Vercel account with access to that team and the Supabase account with access to Personal / ABG Pulse Production. These provider-side account approvals cannot be completed by changing ChatGPT tool permission preferences.

The read-only browser workflow tests the app's explicit QA mode and the registry on its own local server. Those fixtures do not prove that production data, authentication, cross-device history or external sources work. It records any public production navigation separately and never treats a successful homepage load as complete acceptance. No deployment or database writes are performed by this workflow.

## Rollback and sustained reliability

A local source rollback rehearsal is distinct from a Vercel production alias rollback or a database restore. The latter require authorised infrastructure and separately retained evidence. Do not mark them complete on the basis of a local test.

`assessReliabilityWindow` requires thirty complete consecutive elapsed daily records, independent and production evidence descriptors, prerequisite flags and measured counters. It rejects missing dates, duplicates, future observations, missed critical events, unsupported material claims and insufficient high-materiality weighted recall. Even a structurally valid record set is only eligible for independent review: this helper does not authenticate remote evidence and never certifies dependability.

The actual dependability ledger is unchanged. Synthetic test fixtures are never copied into that ledger. Progress remains unchanged until acceptance evidence is reviewed.
