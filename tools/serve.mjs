// Tiny static file server for previewing builds: node tools/serve.mjs <dir> <port>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '.');
const port = Number(process.argv[3] ?? 8080);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.bin': 'application/octet-stream', '.wasm': 'application/wasm',
};

http.createServer((req, res) => {
  let file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': types[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(buf);
  });
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
