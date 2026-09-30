// Serves the packed page to a phone on the same Wi-Fi (the packed file itself needs no network; this is only a way to get
// it onto the phone without a cable):  node tools/serve-lan.mjs [file = dist/ZombieMiner.html] [--port 8080]
// Only that one file is served (at / and /<name>), no directory listing, never cached. Stop with Ctrl+C.
// Windows asks once to let node through the firewall: allow it for the private network only.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { basename, resolve } from 'node:path';

const args = process.argv.slice(2);
const portAt = args.indexOf('--port');
const port = portAt >= 0 ? Number(args.splice(portAt, 2)[1]) : 8080;
const file = resolve(args[0] ?? 'dist/ZombieMiner.html');
const name = basename(file);

const server = createServer(async (req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (path !== '/' && path !== '/' + name) {
    res.writeHead(404).end('not found');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-length': body.length });
    res.end(body);
    console.log(`${new Date().toLocaleTimeString()}  ${req.socket.remoteAddress}  ${req.headers['user-agent']?.slice(0, 70) ?? ''}`);
  } catch (e) {
    res.writeHead(500).end(String(e.message));
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`serving ${file}`);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  on the phone (same Wi-Fi): http://${a.address}:${port}/`);
    }
  }
});
