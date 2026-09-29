// Measures a tractor model straight from its .glb: every mesh's vertices in the tractor's axes
// (the instance root at the origin, x to the side, y up, +Z forward, scaled like the scene
// instance), then bounds and slices of the body mesh for the bucket cavity and the pusher boxes.
// Usage: node tools/measure-tractor.mjs <file.glb> [--scale s] [--mesh name] [--from-z z]
//   --scale  the instance root's scale in the scene (default: the glb root's own scale)
//   --mesh   the body mesh (default: the first mesh whose name starts with "Tractor_Tier" and not "_Tire")
//   --from-z where the bucket starts (slices are taken in front of it)

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const file = args[0];
if (!file) {
  console.error('usage: node tools/measure-tractor.mjs <file.glb> [--scale s] [--mesh name] [--from-z z]');
  process.exit(1);
}
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const glb = readFileSync(file);
const jsonLength = glb.readUInt32LE(12);
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'));
const binStart = 20 + jsonLength + 8;
const bin = glb.subarray(binStart);

// --- 4x4 column-major matrices -------------------------------------------------------------
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    out[c * 4 + r] = s;
  }
  return out;
}
function compose(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  const m = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    t[0], t[1], t[2], 1,
  ];
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 4 + r] *= s[c];
  return m;
}
const apply = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

// --- the node tree, the root placed like the scene instance ----------------------------------
const rootIndex = gltf.scenes[gltf.scene ?? 0].nodes[0];
const root = gltf.nodes[rootIndex];
const rootScale = Number(opt('scale', (root.scale ?? [1, 1, 1])[0]));
const meshes = []; // { name, node, matrix }
function walk(index, parent) {
  const node = gltf.nodes[index];
  const local = index === rootIndex
    ? compose([0, 0, 0], node.rotation, [rootScale, rootScale, rootScale])
    : node.matrix ?? compose(node.translation, node.rotation, node.scale);
  const world = multiply(parent, local);
  if (node.mesh !== undefined) meshes.push({ name: gltf.meshes[node.mesh].name, node: node.name, mesh: node.mesh, matrix: world });
  for (const child of node.children ?? []) walk(child, world);
}
walk(rootIndex, identity());

function positions(meshIndex) {
  const out = [];
  for (const prim of gltf.meshes[meshIndex].primitives) {
    const acc = gltf.accessors[prim.attributes.POSITION];
    const view = gltf.bufferViews[acc.bufferView];
    const stride = view.byteStride ?? 12;
    const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    for (let i = 0; i < acc.count; i++) {
      const o = base + i * stride;
      out.push([bin.readFloatLE(o), bin.readFloatLE(o + 4), bin.readFloatLE(o + 8)]);
    }
  }
  return out;
}

/** Triangles of a mesh as index triples into positions(meshIndex) (primitives concatenated). */
function triangles(meshIndex) {
  const out = [];
  let offset = 0;
  for (const prim of gltf.meshes[meshIndex].primitives) {
    const acc = gltf.accessors[prim.indices];
    const view = gltf.bufferViews[acc.bufferView];
    const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const size = acc.componentType === 5125 ? 4 : 2;
    const read = (i) => (size === 4 ? bin.readUInt32LE(base + i * 4) : bin.readUInt16LE(base + i * 2));
    for (let i = 0; i + 2 < acc.count; i += 3) out.push([read(i) + offset, read(i + 1) + offset, read(i + 2) + offset]);
    offset += gltf.accessors[prim.attributes.POSITION].count;
  }
  return out;
}

const f = (v) => v.toFixed(3);
function bounds(points) {
  const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const p of points) for (let k = 0; k < 3; k++) {
    b.min[k] = Math.min(b.min[k], p[k]);
    b.max[k] = Math.max(b.max[k], p[k]);
  }
  return b;
}

console.log(`${file}: root "${root.name}" scale ${rootScale}`);
const placed = new Map();
const tris = new Map();
for (const m of meshes) {
  const pts = positions(m.mesh).map((p) => apply(m.matrix, p));
  placed.set(m.node, pts);
  tris.set(m.node, triangles(m.mesh));
  const b = bounds(pts);
  console.log(`  ${m.node} (${m.name}, ${pts.length} verts): x ${f(b.min[0])}..${f(b.max[0])}  y ${f(b.min[1])}..${f(b.max[1])}  z ${f(b.min[2])}..${f(b.max[2])}`);
}

const bodyName = opt('mesh', meshes.find((m) => m.name.startsWith('Tractor_Tier') && !m.name.includes('Tire'))?.node);
const body = placed.get(bodyName);
if (!body) process.exit(0);
const all = [...placed.values()].flat();
const allBounds = bounds(all);
console.log(`  whole model: x ${f(allBounds.min[0])}..${f(allBounds.max[0])}  y ${f(allBounds.min[1])}..${f(allBounds.max[1])}  z ${f(allBounds.min[2])}..${f(allBounds.max[2])}`);

// --- sections: the body's triangles cut by a plane, drawn as ASCII -----------------------------
// --section x=0.5 draws the cut in the z (across) / y (up) plane; y=0.5 draws z across / x up.
// --box zmin,zmax,vmin,vmax sets the drawn window, --cell the drawing's cell size.
const section = opt('section', null);
if (section) {
  const [axisName, valueText] = section.split('=');
  const axis = { x: 0, y: 1, z: 2 }[axisName];
  const value = Number(valueText);
  const across = 2; // z
  const up = axis === 0 ? 1 : 0; // y for an x cut, x for a y cut
  const segments = [];
  for (const [a, b, c] of tris.get(bodyName)) {
    const p = [body[a], body[b], body[c]];
    const hits = [];
    for (let e = 0; e < 3; e++) {
      const u = p[e];
      const v = p[(e + 1) % 3];
      const du = u[axis] - value;
      const dv = v[axis] - value;
      if ((du < 0 && dv >= 0) || (du >= 0 && dv < 0)) {
        const t = du / (du - dv);
        hits.push([u[across] + (v[across] - u[across]) * t, u[up] + (v[up] - u[up]) * t]);
      }
    }
    if (hits.length === 2) segments.push(hits);
  }
  const box = (opt('box', '') || '').split(',').map(Number);
  const [z0, z1, v0, v1] = box.length === 4 ? box : [-2, 3.5, 0, 3.2];
  const cell = Number(opt('cell', 0.05));
  const cols = Math.round((z1 - z0) / cell);
  const rows = Math.round((v1 - v0) / cell);
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(' '));
  for (const [[za, va], [zb, vb]] of segments) {
    const n = Math.max(2, Math.ceil(Math.hypot(zb - za, vb - va) / (cell / 4)));
    for (let k = 0; k <= n; k++) {
      const z = za + ((zb - za) * k) / n;
      const v = va + ((vb - va) * k) / n;
      const col = Math.floor((z - z0) / cell);
      const row = Math.floor((v - v0) / cell);
      if (col >= 0 && col < cols && row >= 0 && row < rows) grid[row][col] = '#';
    }
  }
  console.log(`\nsection ${section}: ${segments.length} segments; z ${z0}..${z1} across, ${up === 1 ? 'y' : 'x'} ${v0}..${v1} up, cell ${cell}`);
  for (let row = rows - 1; row >= 0; row--) {
    const v = v0 + row * cell;
    const label = row % 4 === 0 ? v.toFixed(2).padStart(6) : '      ';
    console.log(`${label} |${grid[row].join('')}`);
  }
  let ruler = '       ';
  for (let col = 0; col < cols; col++) ruler += col % 10 === 0 ? '|' : ' ';
  console.log(ruler);
  let labels = '       ';
  for (let col = 0; col < cols; col += 10) labels += (z0 + col * cell).toFixed(2).padEnd(10);
  console.log(labels);
  process.exit(0);
}

// --- fit: where a ball of radius r fits in the bucket (distance from its centre to the body's triangles)
// --fit r,midZ: the floor under (x, midZ), the back wall per layer, the side walls; walls are reported
// as planes the ball's surface touches (centre limit ∓ r), as Config's BucketShape wants them.
const fit = opt('fit', null);
if (fit) {
  const [r, midZ] = fit.split(',').map(Number);
  const bodyTris = tris.get(bodyName).map(([a, b, c]) => [body[a], body[b], body[c]]);
  const clearance = (x, y, z) => {
    let best = Infinity;
    for (const t of bodyTris) best = Math.min(best, pointTriangleDistance([x, y, z], t));
    return best;
  };
  // Walks from `from` toward `to` along one axis until the ball stops fitting; returns the last centre that fits.
  const reach = (make, from, to, step = 0.002) => {
    let last = NaN;
    const dir = Math.sign(to - from);
    for (let v = from; dir > 0 ? v <= to : v >= to; v += dir * step) {
      if (clearance(...make(v)) < r) return last;
      last = v;
    }
    return last;
  };
  const xs = (opt('fit-x', '0,0.5,1.0') || '').split(',').map(Number);
  console.log(`\nfit: ball radius ${r}, probing the floor at z ${midZ}`);
  let floor = -Infinity;
  for (const x of xs) {
    const y = reach((v) => [x, v, midZ], 1.2, -0.5);
    console.log(`  floor at x ${x}: the centre goes down to y ${f(y)} -> floor ${f(y - r)}`);
    floor = Math.max(floor, y - r);
  }
  const layers = Number(opt('fit-layers', 4));
  for (let layer = 0; layer < layers; layer++) {
    const y = floor + r + layer * 2 * r;
    const backs = xs.map((x) => reach((v) => [x, y, v], midZ, midZ - 2));
    console.log(`  layer ${layer} (centre y ${f(y)}): back wall — the centre reaches z ${backs.map(f).join(' / ')} (x ${xs.join(' / ')}) -> plane ${backs.map((b) => f(b - r)).join(' / ')}`);
  }
  for (let layer = 0; layer < layers; layer++) {
    const y = floor + r + layer * 2 * r;
    const zs = (opt('fit-side-z', `${midZ}`) || '').split(',').map(Number);
    const sides = zs.map((z) => reach((v) => [v, y, z], 0, 2.5));
    console.log(`  layer ${layer} (centre y ${f(y)}): side wall — the centre reaches x ${sides.map(f).join(' / ')} (z ${zs.join(' / ')}) -> plane ${sides.map((s) => f(s + r)).join(' / ')}`);
  }
  process.exit(0);
}

function pointTriangleDistance(p, [a, b, c]) {
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const at = (s, t) => [a[0] + s * ab[0] + t * ac[0], a[1] + s * ab[1] + t * ac[1], a[2] + s * ab[2] + t * ac[2]];
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  let q;
  if (d1 <= 0 && d2 <= 0) q = a;
  else {
    const bp = sub(p, b);
    const d3 = dot(ab, bp);
    const d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) q = b;
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) q = at(d1 / (d1 - d3), 0);
      else {
        const cp = sub(p, c);
        const d5 = dot(ab, cp);
        const d6 = dot(ac, cp);
        if (d6 >= 0 && d5 <= d6) q = c;
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) q = at(0, d2 / (d2 - d6));
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
              q = [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])];
            } else {
              const denom = 1 / (va + vb + vc);
              q = at(vb * denom, vc * denom);
            }
          }
        }
      }
    }
  }
  const d = sub(p, q);
  return Math.sqrt(dot(d, d));
}

// --- slices of the body in front of fromZ: where the bucket's walls, floor and back are --------
const fromZ = Number(opt('from-z', 0));
const front = body.filter((p) => p[2] >= fromZ);
const fb = bounds(front);
console.log(`\nbody in front of z ${fromZ}: ${front.length} verts, x ${f(fb.min[0])}..${f(fb.max[0])}  y ${f(fb.min[1])}..${f(fb.max[1])}  z ${f(fb.min[2])}..${f(fb.max[2])}`);

// Side view (x near the middle): for each height band, the z of the vertices (back wall curve, teeth).
const band = (lo, hi, pts, axis) => pts.filter((p) => p[axis] >= lo && p[axis] < hi);
const mid = front.filter((p) => Math.abs(p[0]) < Number(opt('mid', 0.35)) * rootScale);
const yStep = Number(opt('y-step', 0.1)) * rootScale;
console.log(`\nside view, |x| < ${f(Number(opt('mid', 0.35)) * rootScale)}: per height band, z of the vertices (sorted)`);
for (let y = fb.min[1]; y < fb.max[1]; y += yStep) {
  const zs = band(y, y + yStep, mid, 1).map((p) => p[2]).sort((a, b) => a - b);
  if (zs.length) console.log(`  y ${f(y)}..${f(y + yStep)}: ${zs.length} verts  z ${zs.map(f).join(' ')}`.slice(0, 260));
}

// Front view: per height band, the x of the vertices (inner/outer side walls).
console.log('\nfront view: per height band, the x of the vertices (sorted, positive side)');
for (let y = fb.min[1]; y < fb.max[1]; y += yStep) {
  const xs = band(y, y + yStep, front, 1).filter((p) => p[0] > 0).map((p) => p[0]).sort((a, b) => a - b);
  if (xs.length) console.log(`  y ${f(y)}..${f(y + yStep)}: ${xs.length} verts  x ${xs.map(f).join(' ')}`.slice(0, 260));
}

// Top view: per z band, the heights of vertices near the middle (floor plate) and the side walls' x.
const zStep = Number(opt('z-step', 0.1)) * rootScale;
console.log('\ntop view: per z band, heights near the middle and the side walls');
for (let z = fb.min[2]; z < fb.max[2]; z += zStep) {
  const pts = band(z, z + zStep, front, 2);
  const ys = pts.filter((p) => Math.abs(p[0]) < 0.35 * rootScale).map((p) => p[1]).sort((a, b) => a - b);
  const xs = pts.filter((p) => p[0] > 0).map((p) => p[0]).sort((a, b) => a - b);
  console.log(`  z ${f(z)}..${f(z + zStep)}: ${pts.length} verts  mid y ${ys.slice(0, 6).map(f).join(' ')}${ys.length > 6 ? ' .. ' + f(ys[ys.length - 1]) : ''}  |  x+ ${xs.slice(0, 4).map(f).join(' ')}${xs.length > 4 ? ' .. ' + f(xs[xs.length - 1]) : ''}`);
}
