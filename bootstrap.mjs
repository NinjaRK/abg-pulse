import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Keep the existing postinstall entry point, but never unpack the historical
// .bootstrap archive. Installation must preserve the exact checked-out source.
export const REQUIRED_RUNTIME_FILES = Object.freeze([
  'package.json', 'vercel.json', 'index.html', 'app.js', 'core.mjs', 'official.mjs',
  'api/health.js', 'api/scan.js', 'api/progress.js', 'api/events.js',
  'api/ingest.js', 'api/social-ingest.js', 'lib/live-snapshot.mjs',
  'data/entities.json', 'data/entity-universe-summary.json',
  'data/source-registry.json', 'data/build-milestones.json',
  'config/queries.json', 'config/official-sources.json'
]);

/** Validate committed runtime assets without downloading, restoring or writing. */
export function validateRuntime(root = fileURLToPath(new URL('.', import.meta.url))) {
  const failures = [];
  for (const relative of REQUIRED_RUNTIME_FILES) {
    try {
      const path = resolve(root, relative);
      const stat = statSync(path);
      if (!stat.isFile() || stat.size === 0) {
        failures.push(`${relative}: missing or empty regular file`);
        continue;
      }
      if (relative.endsWith('.json')) {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        if (parsed === null || typeof parsed !== 'object') {
          failures.push(`${relative}: expected a JSON object or array`);
        }
      }
    } catch (error) {
      failures.push(`${relative}: ${error instanceof SyntaxError ? 'invalid JSON' : error.code || 'unreadable'}`);
    }
  }
  if (failures.length) {
    throw new Error(`ABG Pulse runtime validation failed:\n${failures.join('\n')}\nRestore the missing source from the intended Git commit. Historical archives are not an installation fallback.`);
  }
  return { status: 'ok', checkedFiles: REQUIRED_RUNTIME_FILES.length, sourceMutated: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = validateRuntime();
    console.log(`ABG Pulse runtime validated: ${result.checkedFiles} committed files; source unchanged.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
