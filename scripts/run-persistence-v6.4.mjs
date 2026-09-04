import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const sourcePath = 'scripts/apply-persistence-v6.4.mjs';
let source = readFileSync(sourcePath, 'utf8');
source = source
  .replaceAll('${process.env.SUPABASE_URL.replace', '\\${process.env.SUPABASE_URL.replace')
  .replaceAll('${process.env.SUPABASE_SERVICE_ROLE_KEY}', '\\${process.env.SUPABASE_SERVICE_ROLE_KEY}');
const temporaryPath = '/tmp/apply-persistence-v6.4.mjs';
writeFileSync(temporaryPath, source);
await import(pathToFileURL(temporaryPath));
