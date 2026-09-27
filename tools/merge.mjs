#!/usr/bin/env node
// Merge the current feature branch into main as a --no-ff merge commit WITHOUT touching the
// working tree. A plain `git switch main && git merge` briefly rewinds the files to main, and the
// open Cocos editor would start re-importing assets or reloading the scene in the middle of it.
//
//   node tools/merge.mjs [--into main] [--dry-run]
//
// Needs a clean working tree. Afterwards HEAD is on the target branch. If the target has not moved
// since the branch point, its tree equals the working tree and the switch changes no file on disk.

import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const into = option('--into', 'main');
const dryRun = argv.includes('--dry-run');

const git = (args, input) =>
  execFileSync('git', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const fail = (message) => {
  console.error(`merge: ${message}`);
  process.exit(1);
};

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch === 'HEAD') fail('detached HEAD');
if (branch === into) fail(`already on '${into}'; run this from the feature branch`);
if (git(['status', '--porcelain'])) fail('uncommitted changes; commit them first');

const target = git(['rev-parse', into]);
const tip = git(['rev-parse', 'HEAD']);
if (git(['merge-base', into, 'HEAD']) === tip) fail(`'${branch}' has nothing new for '${into}'`);

let tree;
try {
  // Exit code 1 means conflicts; the first output line is the tree id either way.
  tree = git(['merge-tree', '--write-tree', into, 'HEAD']).split('\n')[0];
} catch (err) {
  fail(`conflicts between '${branch}' and '${into}':\n${err.stdout}`);
}

const commits = git(['log', '--reverse', '--format=- %s', `${into}..HEAD`]);
const message = `Merge branch '${branch}'\n\n${commits}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n`;
if (dryRun) {
  console.log(message);
  process.exit(0);
}

const merge = git(['commit-tree', tree, '-p', target, '-p', tip, '-F', '-'], message);
// Compare-and-swap: fails if the target moved while we were working.
git(['update-ref', '-m', `merge ${branch} into ${into}`, `refs/heads/${into}`, merge, target]);
const touched = git(['diff', '--name-only', 'HEAD', merge]);
git(['switch', into]);

console.log(`${into} -> ${merge.slice(0, 7)}  Merge branch '${branch}'`);
if (touched) console.log(`files updated on disk (${into} had moved):\n${touched}`);
