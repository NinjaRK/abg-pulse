import { lstatSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Compatibility entry point for existing npm/Vercel install settings.
// Install must validate the checked-out source, never restore an old archive.
export const REQUIRED_RUNTIME_FILES = Object.freeze([
  'api/health.js', 'api/progress.js', 'api/scan.js',
  'core.mjs', 'official.mjs', 'lib/live-snapshot.mjs'
]);
export const REQUIRED_JSON_SHAPES = Object.freeze({
  'data/entities.json': 'array',
  'data/source-registry.json': 'array',
  'data/entity-universe-summary.json': 'object',
  'data/build-milestones.json': 'object',
  'config/queries.json': 'array',
  'config/official-sources.json': 'array'
});
const scriptPath = fileURLToPath(import.meta.url);

/** Validate committed assets without writing files or running archive tools. */
export function validateRuntime(root = dirname(scriptPath)) {
  const paths = [...REQUIRED_RUNTIME_FILES, ...Object.keys(REQUIRED_JSON_SHAPES)];
  for (const relative of paths) {
    let stat;
    try { stat = lstatSync(resolve(root, relative)); }
    catch { throw new Error(`Required runtime file is missing: ${relative}. Restore tracked source from Git, not a runtime archive.`); }
    if (!stat.isFile()) throw new Error(`Required runtime path is not a regular file: ${relative}.`);
    if (stat.size === 0) throw new Error(`Required runtime file is empty: ${relative}.`);
  }
  for (const [relative, shape] of Object.entries(REQUIRED_JSON_SHAPES)) {
    let value;
    try { value = JSON.parse(readFileSync(resolve(root, relative), 'utf8')); }
    catch { throw new Error(`Required runtime JSON is invalid: ${relative}.`); }
    const valid = shape === 'array'
      ? Array.isArray(value)
      : value !== null && typeof value === 'object' && !Array.isArray(value);
    if (!valid) throw new Error(`Required runtime JSON must be an ${shape}: ${relative}.`);
  }
  return { checkedFiles: paths.length, sourceModified: false, archiveRestored: false };
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    const result = validateRuntime();
    console.log(`ABG Pulse: validated ${result.checkedFiles} committed runtime files; no source files were changed.`);
  } catch (error) {
    console.error(`ABG Pulse runtime validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
