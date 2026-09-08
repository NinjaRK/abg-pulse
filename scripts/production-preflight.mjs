import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export const EXPECTED_PROJECT = 'kzqymboxilxvdgacwypy';
export function configurationPreflight(env = process.env) {
  let projectMatches = false;
  try { const url = new URL(env.SUPABASE_URL); projectMatches = url.origin === `https://${EXPECTED_PROJECT}.supabase.co` && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/'; } catch {}
  const key = typeof env.SUPABASE_SERVICE_ROLE_KEY === 'string' ? env.SUPABASE_SERVICE_ROLE_KEY.trim() : '';
  const checks = { expectedDatabaseProject: projectMatches, serverCredentialPresent: key.length > 0, publicSecretAbsent: !Object.entries(env).some(([name,value]) => /^(?:NEXT_PUBLIC_|VITE_|PUBLIC_)/.test(name) && ((key && value === key) || /(?:SERVICE_ROLE|SECRET_KEY)/.test(name))), ingestionCredentialPresent: typeof env.INGEST_SECRET === 'string' && env.INGEST_SECRET.trim().length > 0 };
  return { configurationReady: Object.values(checks).every(Boolean), checks, expectedProject: EXPECTED_PROJECT, databaseConnected: null, productionTested: false, writesPerformed: false, note:'Presence checks do not validate credentials, permissions, schema compatibility, deployed environment or database reachability. Never print credential values.' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = configurationPreflight(); console.log(JSON.stringify(report,null,2)); if (!report.configurationReady) process.exitCode=1;
}
