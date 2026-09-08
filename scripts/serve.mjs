import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html':'text/html; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };
const ROOT_FILES = new Set(['index.html','app.js','registry.html','registry.mjs','core.mjs','official.mjs','styles.css','service-worker.js','manifest.webmanifest']);
const DATA_DIRS = new Set(['data','lib','assets']);
const READ_API = new Set(['health','events','scan','progress','coverage','dependability','claims','persistence-health']);
export function createAppServer({ root = ROOT, enableApi = true } = {}) {
  root = resolve(root);
  return http.createServer(async (req, res) => {
    const send = (code, body) => { res.statusCode = code; res.end(body); };
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
    if (!['GET','HEAD'].includes(req.method)) { res.setHeader('Allow','GET, HEAD'); return send(405,'Read-only development server.'); }
    try {
      const raw = decodeURIComponent(req.url.split('?')[0]);
      if (raw.includes('\\') || raw.includes('\0') || raw.split('/').some(part => part.startsWith('.'))) return send(403,'Forbidden');
      let path = new URL(req.url, 'http://localhost').pathname;
      if (path.startsWith('/api/')) {
        const name = path.slice(5); if (!enableApi || !READ_API.has(name)) return send(404,'Not found');
        const handler = (await import(pathToFileURL(resolve(root,'api',`${name}.js`)).href)).default;
        req.query = Object.fromEntries(new URL(req.url,'http://localhost').searchParams);
        return await handler(req,res);
      }
      path = raw === '/' ? 'index.html' : raw === '/registry' ? 'registry.html' : raw.replace(/^\//,'');
      const parts = path.split('/');
      if (!(ROOT_FILES.has(path) || (parts.length > 1 && DATA_DIRS.has(parts[0]))) || !MIME[extname(path)]) return send(404,'Not found');
      const target = await realpath(resolve(root,path));
      if (!target.startsWith(root + sep) || !(await stat(target)).isFile()) return send(403,'Forbidden');
      const content = await readFile(target); res.setHeader('Content-Type',MIME[extname(path)]); send(200,req.method === 'HEAD' ? '' : content);
    } catch (error) { send(error?.code === 'ENOENT' ? 404 : 500,'Resource unavailable.'); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 4173); if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port.');
  const server = createAppServer(); server.listen(port,'127.0.0.1',()=>console.log(`ABG Pulse local verification server: http://127.0.0.1:${port}`));
}
