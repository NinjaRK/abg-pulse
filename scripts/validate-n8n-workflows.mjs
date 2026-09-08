import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const directory = resolve(process.env.N8N_WORKFLOW_DIR || 'n8n');
const files = readdirSync(directory)
  .filter((name) => name.endsWith('.json'))
  .map((name) => join(directory, name))
  .filter((path) => statSync(path).isFile())
  .sort();

if (!files.length) throw new Error(`No n8n workflow JSON files found in ${directory}.`);
const forbiddenSecretPatterns = [
  /sk-[A-Za-z0-9_-]{12,}/,
  /sb_secret_[A-Za-z0-9_-]{12,}/,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  /(?:password|secret|token|api[_-]?key)\s*[=:]\s*["'][^"'{}$]{8,}["']/i
];

const summaries = [];
for (const path of files) {
  const text = readFileSync(path, 'utf8');
  let workflow;
  try { workflow = JSON.parse(text); } catch (error) { throw new Error(`${path} is not valid JSON: ${error.message}`); }
  if (!workflow.name || typeof workflow.name !== 'string') throw new Error(`${path} has no workflow name.`);
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length < 1) throw new Error(`${path} has no nodes.`);
  if (!workflow.connections || typeof workflow.connections !== 'object') throw new Error(`${path} has no connections object.`);
  const names = workflow.nodes.map((node) => node.name);
  const ids = workflow.nodes.map((node) => node.id);
  if (new Set(names).size !== names.length) throw new Error(`${path} contains duplicate node names.`);
  if (new Set(ids).size !== ids.length) throw new Error(`${path} contains duplicate node ids.`);
  if (workflow.active !== false) throw new Error(`${path} must be imported inactive and explicitly enabled after environment verification.`);
  for (const [sourceName, outputs] of Object.entries(workflow.connections)) {
    if (!names.includes(sourceName)) throw new Error(`${path} connection starts at unknown node: ${sourceName}`);
    for (const outputGroup of Object.values(outputs || {})) {
      for (const branch of outputGroup || []) {
        for (const edge of branch || []) {
          if (!names.includes(edge.node)) throw new Error(`${path} connection points to unknown node: ${edge.node}`);
        }
      }
    }
  }
  for (const pattern of forbiddenSecretPatterns) {
    if (pattern.test(text)) throw new Error(`${path} appears to contain hard-coded secret material matching ${pattern}.`);
  }
  const environmentReferences = [...text.matchAll(/\$env\.([A-Z0-9_]+)/g)].map((match) => match[1]);
  summaries.push({
    file: path,
    name: workflow.name,
    nodes: workflow.nodes.length,
    active: workflow.active,
    environmentReferences: [...new Set(environmentReferences)].sort()
  });
}

console.log(JSON.stringify({ workflowCount: summaries.length, workflows: summaries }, null, 2));
