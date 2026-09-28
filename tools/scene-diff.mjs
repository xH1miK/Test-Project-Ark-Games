#!/usr/bin/env node
// Structural diff of a Cocos scene/prefab file against a git revision: objects are matched by what
// they are (a node by its path, a component by its node's path and type, anything else by who refers
// to it and through which field), not by their __id__, so the renumbering a save brings after every
// new object does not show. References are printed as the key of the object they point at.
//
//   node tools/scene-diff.mjs [file = assets/scenes/Main.scene] [rev = HEAD]

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const file = process.argv[2] || 'assets/scenes/Main.scene';
const rev = process.argv[3] || 'HEAD';

const before = JSON.parse(execFileSync('git', ['show', `${rev}:${file}`], { encoding: 'utf8', maxBuffer: 64 << 20 }));
const after = JSON.parse(readFileSync(file, 'utf8'));

/** key per object index: node path, component "path::Type", other "owner.field". */
function keysOf(objects) {
  const keys = new Array(objects.length).fill(null);
  const nodePath = (i, seen = new Set()) => {
    if (keys[i]) return keys[i];
    const o = objects[i];
    if (seen.has(i)) return `#${i}`;
    seen.add(i);
    const parent = o._parent?.__id__;
    const base = parent === undefined ? '' : `${nodePath(parent, seen)}/`;
    // Siblings with the same name get their order among them.
    let name = o._name || o.__type__;
    if (parent !== undefined) {
      const twins = (objects[parent]._children || []).map((c) => c.__id__).filter((c) => (objects[c]._name || '') === (o._name || ''));
      if (twins.length > 1) name += `[${twins.indexOf(i)}]`;
    }
    return (keys[i] = base + name);
  };
  objects.forEach((o, i) => {
    if (o.__type__ === 'cc.Node' || o.__type__ === 'cc.Scene') nodePath(i);
  });
  objects.forEach((o, i) => {
    if (keys[i] || !o.node || o.node.__id__ === undefined) return;
    const owner = nodePath(o.node.__id__);
    const same = objects.filter((p) => p.node?.__id__ === o.node.__id__ && p.__type__ === o.__type__);
    keys[i] = `${owner}::${o.__type__}${same.length > 1 ? `[${same.indexOf(o)}]` : ''}`;
  });
  // The rest by the first keyed object that refers to them (breadth first).
  let grew = true;
  while (grew) {
    grew = false;
    objects.forEach((o, i) => {
      if (!keys[i]) return;
      const visit = (value, path) => {
        if (Array.isArray(value)) value.forEach((v, k) => visit(v, `${path}[${k}]`));
        else if (value && typeof value === 'object') {
          if (typeof value.__id__ === 'number') {
            if (!keys[value.__id__]) {
              keys[value.__id__] = `${keys[i]}.${path}`;
              grew = true;
            }
            return;
          }
          for (const [k, v] of Object.entries(value)) visit(v, path ? `${path}.${k}` : k);
        }
      };
      visit(o, '');
    });
  }
  return keys.map((k, i) => k || `#orphan${i}`);
}

/** The object with references replaced by the keys they point at. */
function normalise(value, keys) {
  if (Array.isArray(value)) return value.map((v) => normalise(v, keys));
  if (value && typeof value === 'object') {
    if (typeof value.__id__ === 'number') return { ref: keys[value.__id__] };
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalise(v, keys)]));
  }
  return value;
}

function index(objects) {
  const keys = keysOf(objects);
  const map = new Map();
  objects.forEach((o, i) => map.set(keys[i], normalise(o, keys)));
  return map;
}

const a = index(before);
const b = index(after);
const short = (v) => {
  const s = v === undefined ? '(none)' : JSON.stringify(v);
  return s.length > 160 ? `${s.slice(0, 157)}...` : s;
};
let changes = 0;
for (const [key, o] of b) {
  if (!a.has(key)) {
    changes++;
    console.log(`+ ${key}  (${o.__type__})`);
  }
}
for (const key of a.keys()) {
  if (!b.has(key)) {
    changes++;
    console.log(`- ${key}  (${a.get(key).__type__})`);
  }
}
for (const [key, o] of b) {
  const old = a.get(key);
  if (!old) continue;
  const fields = new Set([...Object.keys(old), ...Object.keys(o)]);
  for (const f of fields) {
    if (JSON.stringify(old[f]) === JSON.stringify(o[f])) continue;
    changes++;
    console.log(`~ ${key} .${f}: ${short(old[f])} -> ${short(o[f])}`);
  }
}
console.log(`${changes} change(s): ${file} vs ${rev} (${before.length} -> ${after.length} objects)`);
