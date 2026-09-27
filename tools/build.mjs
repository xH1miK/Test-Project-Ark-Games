#!/usr/bin/env node
// Build the project inside the running Cocos Creator editor via Funplay MCP.
// Uses the builder's internal 'add-task' message (the same call the Build panel makes),
// so no need to close the editor for a CLI build (which fails with EPERM while it is open).
//
//   node tools/build.mjs [build-config/web-mobile.json] [--timeout 600]
//
// Exit code 0 on success; prints the task state and the output folder.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const URL_ = process.env.COCOS_MCP_URL || 'http://127.0.0.1:25720/';
const argv = process.argv.slice(2);
const configPath = resolve(argv.find((a) => !a.startsWith('--')) || 'build-config/web-mobile.json');
const tIdx = argv.indexOf('--timeout');
const timeoutSec = tIdx >= 0 ? Number(argv[tIdx + 1]) : 600;

let rpcId = 1;
async function editorJs(code, args = {}) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: rpcId++,
      method: 'tools/call',
      params: { name: 'execute_javascript', arguments: { context: 'editor', code, args } },
    }),
  });
  const msg = JSON.parse(await res.text());
  if (msg.error) throw new Error(msg.error.message);
  const out = msg.result.structuredContent;
  if (!out?.ok) throw new Error(out?.summary || JSON.stringify(msg.result));
  return out.data;
}

const ADD_TASK = `
const busy = Object.values((await Editor.Message.request('builder', 'query-tasks-info')).queue)
  .filter(t => t.state === 'processing' || t.state === 'waiting');
if (busy.length) throw new Error('builder busy: ' + busy.map(t => t.id).join(','));
const before = new Set(Object.keys((await Editor.Message.request('builder', 'query-tasks-info')).queue));
await Editor.Message.request('builder', 'add-task', args.options);
const after = Object.keys((await Editor.Message.request('builder', 'query-tasks-info')).queue);
return after.find(id => !before.has(id)) || null;
`;

const QUERY = `
const t = (await Editor.Message.request('builder', 'query-tasks-info')).queue[args.id];
return t ? { state: t.state, stage: t.stage, progress: t.progress, message: t.message, detail: t.detailMessage } : null;
`;

// Keep the Build panel tidy: drop older finished tasks with the same name (list entry only, files stay).
const CLEANUP = `
const q = (await Editor.Message.request('builder', 'query-tasks-info')).queue;
const old = Object.values(q).filter(t => t.id !== args.keep && t.options && t.options.taskName === args.taskName
  && t.state !== 'processing' && t.state !== 'waiting');
for (const t of old) await Editor.Message.request('builder', 'remove-task', t.id);
return old.length;
`;

const options = JSON.parse(readFileSync(configPath, 'utf8'));
const started = Date.now();
const id = await editorJs(ADD_TASK, { options });
if (!id) throw new Error('add-task did not create a task');
console.log(`task ${id} (${options.platform} -> ${options.buildPath}/${options.outputName})`);

let last = '';
for (;;) {
  await new Promise((r) => setTimeout(r, 1500));
  const t = await editorJs(QUERY, { id });
  if (!t) throw new Error('task disappeared');
  const line = `${t.state} ${(t.progress * 100).toFixed(0)}% ${t.message}`;
  if (line !== last) console.log(`  ${((Date.now() - started) / 1000).toFixed(1)}s ${line}`);
  last = line;
  if (t.state !== 'processing' && t.state !== 'waiting') {
    const ok = t.state === 'success';
    console.log(ok ? `done in ${((Date.now() - started) / 1000).toFixed(1)}s` : `FAILED: ${t.message}\n${t.detail}`);
    if (ok) await editorJs(CLEANUP, { keep: id, taskName: options.taskName });
    process.exit(ok ? 0 : 1);
  }
  if (Date.now() - started > timeoutSec * 1000) throw new Error(`timeout after ${timeoutSec}s`);
}
