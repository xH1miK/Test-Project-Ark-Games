#!/usr/bin/env node
// Minimal CLI client for the Funplay Cocos MCP server (Streamable HTTP, stateless).
// Useful when the MCP tools are not loaded into the AI session, and for scripted runs.
//
//   node tools/mcp.mjs list                       -> tool names
//   node tools/mcp.mjs <tool> '<json args>'       -> call a tool, print the result
//   node tools/mcp.mjs <tool> @args.json          -> args from a file
//   node tools/mcp.mjs js <scene|editor> @code.js -> shortcut for execute_javascript
//
// Env: COCOS_MCP_URL (default http://127.0.0.1:25720/)

import { readFileSync } from 'node:fs';

const URL_ = process.env.COCOS_MCP_URL || 'http://127.0.0.1:25720/';
let nextId = 1;

async function rpc(method, params) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  const text = await res.text();
  // The server may answer with plain JSON or a single SSE "data:" event.
  const json = text.startsWith('{') ? text : text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('');
  const msg = JSON.parse(json);
  if (msg.error) throw new Error(`${msg.error.code}: ${msg.error.message}`);
  return msg.result;
}

const readArg = (s) => (s && s.startsWith('@') ? readFileSync(s.slice(1), 'utf8') : s);

async function main() {
  const [cmd, a1, a2] = process.argv.slice(2);
  if (!cmd) throw new Error('usage: mcp.mjs list | <tool> [json|@file] | js <scene|editor> <code|@file>');
  if (cmd === 'list') {
    const { tools } = await rpc('tools/list', {});
    console.log(tools.map((t) => t.name).join('\n'));
    return;
  }
  let name = cmd;
  let args;
  if (cmd === 'js') {
    name = 'execute_javascript';
    args = { context: a1, code: readArg(a2) };
  } else {
    args = a1 ? JSON.parse(readArg(a1)) : {};
  }
  const result = await rpc('tools/call', { name, arguments: args });
  const out = result.structuredContent ?? result.content?.map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n');
  console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
  if (result.isError) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
