#!/usr/bin/env node
// Type-check the game scripts with the TypeScript compiler bundled in Cocos Creator 3.8.8
// (strict mode from tsconfig.json; engine declarations skipped). Exit code 1 on errors.
//
//   node tools/typecheck.mjs

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const TSC = [
  process.env.COCOS_TSC,
  'C:/ProgramData/cocos/editors/Creator/3.8.8/resources/resources/3d/engine/node_modules/typescript/bin/tsc',
].filter(Boolean).find((p) => existsSync(p));
if (!TSC) throw new Error('TypeScript compiler of Cocos Creator 3.8.8 not found; set COCOS_TSC');

const run = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.json', '--noEmit', '--pretty', 'false'], { encoding: 'utf8' });
const out = `${run.stdout}${run.stderr}`.trim();
console.log(out || 'typecheck: OK');
process.exit(run.status === 0 ? 0 : 1);
