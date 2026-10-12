// 구현 전 배치 사전 검수 도구(10-12 v1 §2) — Node 표준 라이브러리만 쓴다. 읽기 전용: spec과 PNG를 읽고 출력 폴더에만 쓴다.
// 사용: node scripts/layout-qa.mjs <spec.json> [--out <출력 폴더>]
// 출력(해상도마다): <id>.svg(일반 합성) · <id>.qa.svg(경계·HUD·id·간격 표시) / 전체: qa.json
// 같은 입력은 바이트가 같은 출력을 만든다(시각·절대경로를 파일에 넣지 않는다).
//
// 좌표 계산 순서(명시):
//   1) 월드 좌표(x, y, width, height, pivot) → 월드 사각형: left = x - width*pivot[0], top = y - height*pivot[1]
//   2) 월드 사각형 → 논리 화면 좌표: (월드 - worldView) * zoom. worldView = 카메라 중심 - 논리 화면/2, 월드 경계 안으로 고정(Phaser 카메라 경계와 같다)
//   3) 논리 화면 좌표 → 실제 viewport 좌표: × (viewport.width / logical.width)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const r2 = (v) => Math.round(v * 100) / 100;
const posix = (p) => p.split(sep).join('/').replace(/\\/g, '/');
// spec 안의 경로는 Windows(\)와 POSIX(/) 구분자를 모두 받는다
const norm = (p) => String(p).replace(/\\/g, '/');
export const normalizePath = norm;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- 순수 계산 ----------
export function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG가 아니다');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function worldRect(t) {
  const pv = t.pivot ?? [0.5, 0.5];
  const l = t.x - t.width * pv[0];
  const tp = t.y - t.height * pv[1];
  return { l, t: tp, r: l + t.width, b: tp + t.height };
}

export function worldViewOf(spec) {
  const { width: lw, height: lh } = spec.logical;
  const world = spec.world;
  const zoom = spec.camera.zoom ?? 1;
  const vw = lw / zoom;
  const vh = lh / zoom;
  let x;
  let y;
  if (spec.camera.worldView) {
    x = spec.camera.worldView.x;
    y = spec.camera.worldView.y;
  } else {
    x = spec.camera.center.x - vw / 2;
    y = spec.camera.center.y - vh / 2;
  }
  x = Math.min(Math.max(x, 0), Math.max(0, world.width - vw));
  y = Math.min(Math.max(y, 0), Math.max(0, world.height - vh));
  return { x, y, zoom, width: vw, height: vh };
}

export function toViewport(rect, view, spec, viewport) {
  const k = viewport.width / spec.logical.width;
  return {
    l: (rect.l - view.x) * view.zoom * k,
    t: (rect.t - view.y) * view.zoom * k,
    r: (rect.r - view.x) * view.zoom * k,
    b: (rect.b - view.y) * view.zoom * k,
  };
}

export const area = (a) => Math.max(0, a.r - a.l) * Math.max(0, a.b - a.t);
export function intersectArea(a, b) {
  return Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
}
// 두 사각형 가장자리 사이 거리(겹치면 0)
export function rectGap(a, b) {
  const dx = Math.max(0, Math.max(a.l, b.l) - Math.min(a.r, b.r));
  const dy = Math.max(0, Math.max(a.t, b.t) - Math.min(a.b, b.b));
  return Math.hypot(dx, dy);
}
// 화면 밖 구분: full(전부 밖) / partial(일부 밖) / none(전부 안)
export function offscreenOf(rect, viewport) {
  const vis = intersectArea(rect, { l: 0, t: 0, r: viewport.width, b: viewport.height });
  if (vis <= 0) return 'full';
  return vis < area(rect) - 1e-6 ? 'partial' : 'none';
}
const rectOut = (a) => ({ left: r2(a.l), top: r2(a.t), right: r2(a.r), bottom: r2(a.b), width: r2(a.r - a.l), height: r2(a.b - a.t) });

// ---------- spec 읽기·검사 ----------
export function loadSpec(specPath) {
  const abs = resolve(specPath);
  const spec = JSON.parse(readFileSync(abs, 'utf8'));
  const base = dirname(abs);
  const fail = (m) => { throw new Error(`spec 오류(${basename(abs)}): ${m}`); };
  for (const k of ['name', 'world', 'logical', 'camera', 'viewports', 'targets']) if (spec[k] === undefined) fail(`"${k}"가 없다`);
  if (!Array.isArray(spec.viewports) || spec.viewports.length === 0) fail('viewports가 비어 있다');
  if (!spec.camera.center && !spec.camera.worldView) fail('camera.center 또는 camera.worldView가 필요하다');
  const ids = new Set();
  for (const t of spec.targets) {
    if (!t.id) fail('target에 id가 없다');
    if (ids.has(t.id)) fail(`target id 중복: ${t.id}`);
    ids.add(t.id);
    for (const k of ['x', 'y', 'width', 'height']) if (typeof t[k] !== 'number') fail(`${t.id}.${k}가 숫자가 아니다`);
  }
  for (const h of spec.hud ?? []) {
    if (!h.id) fail('hud에 id가 없다');
    if (ids.has(h.id)) fail(`hud/target id 중복: ${h.id}`);
    ids.add(h.id);
  }
  return { spec, base, abs };
}

// ---------- 검사 ----------
export function evaluate(spec, base, readImage = (p) => readFileSync(p), exists = existsSync) {
  const view = worldViewOf(spec);
  const rules = []; // {id, type, viewport, pass, detail}
  const add = (type, viewport, id, pass, detail) => rules.push({ id, type, viewport, pass, detail });
  const sizeOfImage = new Map();
  for (const t of spec.targets) {
    if (!t.image) continue;
    const p = resolve(base, norm(t.image));
    if (!exists(p)) { add('image', 'all', t.id, false, `이미지 없음: ${posix(t.image)}`); continue; }
    sizeOfImage.set(t.id, pngSize(readImage(p)));
  }
  if (spec.background && !exists(resolve(base, norm(spec.background)))) add('image', 'all', 'background', false, `배경 이미지 없음: ${posix(spec.background)}`);
  const rule = spec.rules ?? {};

  // 뷰포트 독립 규칙: 이미지 비율·허용 범위·깊이 순서
  for (const t of spec.targets) {
    const src = sizeOfImage.get(t.id);
    if (src) {
      const ratioSrc = src.width / src.height;
      const ratio = t.width / t.height;
      add('aspect', 'all', t.id, Math.abs(ratio / ratioSrc - 1) <= (rule.aspectTolerance ?? 0.01), `표시 비율 ${r2(ratio)} / 원본 ${src.width}×${src.height} 비율 ${r2(ratioSrc)}`);
    }
    for (const [key, range] of Object.entries(t.range ?? {})) {
      const v = t[key];
      add('range', 'all', `${t.id}.${key}`, v >= range[0] && v <= range[1], `${key}=${v} 허용 ${range[0]}~${range[1]}`);
    }
  }
  const depthOf = new Map([...spec.targets.map((t) => [t.id, t.depth ?? 0])]);
  for (const order of rule.depthOrder ?? []) {
    let ok = true;
    for (let i = 1; i < order.length; i += 1) if (!(depthOf.get(order[i - 1]) < depthOf.get(order[i]))) ok = false;
    add('depthOrder', 'all', order.join('<'), ok, order.map((id) => `${id}=${depthOf.get(id)}`).join(', '));
  }

  const viewports = [];
  for (const vp of spec.viewports) {
    const k = vp.width / spec.logical.width;
    const rects = new Map();
    for (const t of spec.targets) rects.set(t.id, toViewport(worldRect(t), view, spec, vp));
    for (const h of spec.hud ?? []) {
      const lr = h.overrides?.[vp.id] ?? h.rect;
      if (!lr) continue;
      rects.set(h.id, { l: lr.x * k, t: lr.y * k, r: (lr.x + lr.width) * k, b: (lr.y + lr.height) * k });
    }
    const hudIds = (spec.hud ?? []).filter((h) => rects.has(h.id)).map((h) => h.id);
    const targets = spec.targets.map((t) => {
      const rc = rects.get(t.id);
      const off = offscreenOf(rc, vp);
      const hudHits = hudIds.map((hid) => ({ hud: hid, areaPx: r2(intersectArea(rc, rects.get(hid))) })).filter((x) => x.areaPx > 0);
      return { id: t.id, depth: t.depth ?? 0, rect: rectOut(rc), offscreen: off, hudIntersections: hudHits };
    });
    const byId = new Map(targets.map((t) => [t.id, t]));
    const hudOut = hudIds.map((hid) => ({ id: hid, rect: rectOut(rects.get(hid)) }));

    for (const id of rule.onscreen ?? []) {
      const o = byId.get(id)?.offscreen;
      add('onscreen', vp.id, id, o === 'none', `화면 안 여부: ${o ?? '대상 없음'}`);
    }
    for (const [a, b] of rule.mustNotOverlap ?? []) {
      const ra = rects.get(a);
      const rb = rects.get(b);
      if (!ra || !rb) { add('mustNotOverlap', vp.id, `${a}×${b}`, false, '대상 없음'); continue; }
      const offs = [byId.get(a)?.offscreen ?? (hudIds.includes(a) ? offscreenOf(ra, vp) : 'none'), byId.get(b)?.offscreen ?? (hudIds.includes(b) ? offscreenOf(rb, vp) : 'none')];
      const v = r2(intersectArea(ra, rb));
      if (offs.includes('full')) add('mustNotOverlap', vp.id, `${a}×${b}`, false, '완전히 화면 밖 — 교차 없음의 근거로 쓸 수 없다');
      else add('mustNotOverlap', vp.id, `${a}×${b}`, v === 0, `교차 면적 ${v}px²`);
    }
    for (const g of rule.hudAvoid ?? []) {
      for (const id of g.targets) {
        const t = byId.get(id);
        if (!t) { add('hudAvoid', vp.id, id, false, '대상 없음'); continue; }
        const only = g.hud === 'all' || g.hud === undefined ? hudIds : g.hud;
        const hits = t.hudIntersections.filter((x) => only.includes(x.hud));
        const sum = r2(hits.reduce((n, x) => n + x.areaPx, 0));
        if (t.offscreen === 'full') add('hudAvoid', vp.id, id, false, '완전히 화면 밖 — 교차 없음의 근거로 쓸 수 없다');
        else add('hudAvoid', vp.id, id, sum === 0, `HUD 교차 ${sum}px²${hits.length ? ' (' + hits.map((x) => `${x.hud} ${x.areaPx}`).join(', ') + ')' : ''}`);
      }
    }
    for (const g of rule.minGap ?? []) {
      const need = typeof g.min === 'number' ? g.min : g.min[vp.id];
      if (need === undefined) continue;
      const ra = rects.get(g.a);
      const rb = rects.get(g.b);
      if (!ra || !rb) { add('minGap', vp.id, `${g.a}↔${g.b}`, false, '대상 없음'); continue; }
      const gap = r2(rectGap(ra, rb));
      add('minGap', vp.id, `${g.a}↔${g.b}`, gap >= need, `간격 ${gap}px (최소 ${need}px)`);
    }
    viewports.push({ id: vp.id, width: vp.width, height: vp.height, scale: r2(k), targets, hud: hudOut, _rects: rects });
  }
  return { view, rules, viewports, sizeOfImage };
}

// ---------- SVG ----------
function svgFor(spec, base, outDir, vp, res, withQa) {
  const k = vp.width / spec.logical.width;
  const world = spec.world;
  const view = res.view;
  const out = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${vp.width}" height="${vp.height}" viewBox="0 0 ${vp.width} ${vp.height}">`);
  out.push(`<rect width="${vp.width}" height="${vp.height}" fill="#1b1b1b"/>`);
  const href = (p) => posix(relative(outDir, resolve(base, norm(p))));
  if (spec.background) out.push(`<image href="${esc(href(spec.background))}" x="${r2(-view.x * view.zoom * k)}" y="${r2(-view.y * view.zoom * k)}" width="${r2(world.width * view.zoom * k)}" height="${r2(world.height * view.zoom * k)}" preserveAspectRatio="none"/>`);
  const order = spec.targets.map((t, i) => ({ t, i })).sort((a, b) => (a.t.depth ?? 0) - (b.t.depth ?? 0) || a.i - b.i);
  const vpRes = res.viewports.find((v) => v.id === vp.id);
  for (const { t } of order) {
    const rc = vpRes._rects.get(t.id);
    if (t.image) out.push(`<image href="${esc(href(t.image))}" x="${r2(rc.l)}" y="${r2(rc.t)}" width="${r2(rc.r - rc.l)}" height="${r2(rc.b - rc.t)}" preserveAspectRatio="none"/>`);
  }
  if (withQa) {
    const failIds = new Set();
    for (const r of res.rules) if (!r.pass && (r.viewport === vp.id || r.viewport === 'all')) for (const part of r.id.split(/[×↔<.]/)) failIds.add(part);
    const box = (id, rc, color, label, dash) => {
      out.push(`<rect x="${r2(rc.l)}" y="${r2(rc.t)}" width="${r2(rc.r - rc.l)}" height="${r2(rc.b - rc.t)}" fill="none" stroke="${color}" stroke-width="2"${dash ? ' stroke-dasharray="6 4"' : ''}/>`);
      out.push(`<text x="${r2(rc.l + 3)}" y="${r2(rc.t + 13)}" font-size="12" font-family="monospace" fill="${color}" stroke="#000" stroke-width="0.4">${esc(label)}</text>`);
    };
    for (const h of vpRes.hud) box(h.id, vpRes._rects.get(h.id), failIds.has(h.id) ? '#e53935' : '#00b0ff', `HUD ${h.id}`, true);
    for (const { t } of order) box(t.id, vpRes._rects.get(t.id), failIds.has(t.id) ? '#e53935' : '#43a047', `${t.id} d${t.depth ?? 0}`, false);
    // 규칙 간격 표시: minGap 선
    for (const r of res.rules) {
      if (r.type !== 'minGap' || r.viewport !== vp.id) continue;
      const [a, b] = r.id.split('↔');
      const ra = vpRes._rects.get(a);
      const rb = vpRes._rects.get(b);
      if (!ra || !rb) continue;
      const x = r2((Math.max(ra.l, rb.l) + Math.min(ra.r, rb.r)) / 2);
      const y1 = ra.b <= rb.t ? ra.b : rb.b <= ra.t ? rb.b : null;
      const y2 = ra.b <= rb.t ? rb.t : rb.b <= ra.t ? ra.t : null;
      if (y1 === null || Math.max(ra.l, rb.l) > Math.min(ra.r, rb.r)) continue;
      out.push(`<line x1="${x}" y1="${r2(y1)}" x2="${x}" y2="${r2(y2)}" stroke="${r.pass ? '#43a047' : '#e53935'}" stroke-width="2"/>`);
      out.push(`<text x="${x + 4}" y="${r2((y1 + y2) / 2 + 4)}" font-size="12" font-family="monospace" fill="${r.pass ? '#43a047' : '#e53935'}" stroke="#000" stroke-width="0.4">${esc(r.detail)}</text>`);
    }
  }
  out.push('</svg>');
  return out.join('\n') + '\n';
}

// ---------- 실행 ----------
export function runLayoutQa(specPath, outDirArg) {
  const started = Date.now();
  const { spec, base } = loadSpec(specPath);
  const outDir = resolve(outDirArg ?? join(base, '..', 'out', spec.name));
  mkdirSync(outDir, { recursive: true });
  const res = evaluate(spec, base);
  const files = [];
  for (const vp of spec.viewports) {
    for (const [suffix, qa] of [['', false], ['.qa', true]]) {
      const f = join(outDir, `${vp.id}${suffix}.svg`);
      writeFileSync(f, svgFor(spec, base, outDir, vp, res, qa));
      files.push(f);
    }
  }
  const qaJson = {
    spec: spec.name,
    world: spec.world,
    logical: spec.logical,
    worldView: { x: r2(res.view.x), y: r2(res.view.y), width: r2(res.view.width), height: r2(res.view.height), zoom: res.view.zoom },
    viewports: res.viewports.map((v) => ({ id: v.id, width: v.width, height: v.height, scale: v.scale, targets: v.targets, hud: v.hud })),
    rules: res.rules,
    summary: { total: res.rules.length, pass: res.rules.filter((r) => r.pass).length, fail: res.rules.filter((r) => !r.pass).length },
  };
  const qaPath = join(outDir, 'qa.json');
  writeFileSync(qaPath, JSON.stringify(qaJson, null, 2) + '\n');
  files.push(qaPath);
  return { qa: qaJson, files, outDir, elapsedMs: Date.now() - started };
}

function main(argv) {
  const args = argv.slice(2);
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 ? args[outIdx + 1] : undefined;
  const spec = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
  if (!spec) {
    console.error('사용: node scripts/layout-qa.mjs <spec.json> [--out <출력 폴더>]');
    return 2;
  }
  let r;
  try {
    r = runLayoutQa(spec, out);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    return 2;
  }
  const { summary, rules } = r.qa;
  console.log(`layout-qa: ${r.qa.spec}`);
  for (const rule of rules) if (!rule.pass) console.log(`  ✗ [${rule.viewport}] ${rule.type} ${rule.id} — ${rule.detail}`);
  console.log(`규칙 ${summary.total}개 · 통과 ${summary.pass} · 실패 ${summary.fail}`);
  console.log(`출력: ${r.outDir}`);
  for (const f of r.files) console.log(`  ${basename(f)}`);
  console.log(`실행 시간: ${(r.elapsedMs / 1000).toFixed(3)}s`);
  return summary.fail === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
