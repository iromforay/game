// 1장 숲 최종 에셋 자동 검수 — 읽기 전용(파일을 쓰거나 바꾸지 않는다). 외부 네트워크·신규 의존성 없이 Node 내장(fs·zlib)만 쓴다.
// 사람이 실행하는 명령은 verify-forest-assets.mjs(npm run verify:forest-assets)이고, 이 파일은 그 검사 로직(자동 시험도 이 로직을 쓴다).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ASSETS_DIR = join(here, '..', 'src', 'assets');
export const DEFAULT_FOREST_JSON = join(here, '..', '..', 'BE', 'story-data', 'save-a-turby', 'stages', 'forest.json');

// 검수 대상 12개: 경로(assets 기준), 규격, 종류(opaque = 불투명 배경 / alpha = 투명 PNG)
export const FOREST_ASSETS = [
  { path: 'world/forest/forest-base.png', width: 3200, height: 2400, kind: 'opaque' },
  { path: 'world/forest/hidden-path-reveal.png', width: 960, height: 560, kind: 'alpha' },
  { path: 'world/forest/dust-wind-closed.png', width: 320, height: 360, kind: 'alpha' },
  { path: 'world/forest/root-gate-closed.png', width: 480, height: 520, kind: 'alpha' },
  { path: 'world/forest/root-gate-open.png', width: 480, height: 520, kind: 'alpha' },
  { path: 'world/forest/props/cut-yarn-strand.png', width: 768, height: 320, kind: 'alpha' },
  { path: 'world/forest/props/ancient-yarn-strand.png', width: 512, height: 256, kind: 'alpha' },
  { path: 'world/forest/props/hidden-yarn-path.png', width: 768, height: 256, kind: 'alpha' },
  { path: 'items/story/glowing-yarn-dust.png', width: 96, height: 96, kind: 'alpha' },
  { path: 'world/forest/props/giant-thread-knot-map.png', width: 512, height: 512, kind: 'alpha' },
  { path: 'world/forest/npcs/bopuli-tangled-overlay.png', width: 256, height: 256, kind: 'alpha' },
  { path: 'world/forest/npcs/dansuring.png', width: 192, height: 192, kind: 'alpha' },
];
// 닫힘/열림이 같은 캔버스여야 하는 쌍(전환 때 위치가 튀지 않는다)
export const SAME_SIZE_PAIRS = [['world/forest/root-gate-closed.png', 'world/forest/root-gate-open.png']];
// forest.json의 에셋 키 중 검수 대상이 아닌 것(이미 있는 캐릭터 이미지·임시 도형)
const NOT_FINAL_KEY = /^(turby-|placeholder-|fog-veil$)/; // fog-veil: 실행 중에 만드는 안개 막(에셋 파일이 아니다)

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ---------- PNG 읽기(필요한 만큼만: 헤더·알파·픽셀) ----------

export class PngError extends Error {}

export function decodePng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new PngError('PNG 서명이 아니다');
  let pos = 8;
  let ihdr = null;
  let palette = null;
  let trns = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (data.length !== len) throw new PngError('PNG 청크가 잘렸다');
    if (type === 'IHDR') ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), bitDepth: data[8], colorType: data[9], interlace: data[12] };
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!ihdr) throw new PngError('IHDR 청크가 없다');
  const { width, height, bitDepth, colorType, interlace } = ihdr;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new PngError(`지원하지 않는 색상 형식 ${colorType}`);
  if (interlace !== 0) throw new PngError('인터레이스 PNG는 검사하지 못한다(비인터레이스로 저장해 달라)');
  const bitsPerPixel = channels * bitDepth;
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const hasAlpha = colorType === 4 || colorType === 6 || ((colorType === 3 || colorType === 0 || colorType === 2) && !!trns);
  const base = { width, height, bitDepth, colorType, hasAlpha };
  return {
    ...base,
    // 픽셀은 필요할 때만 푼다(헤더만 볼 때는 압축을 풀지 않는다)
    pixels() {
      const raw = inflateSync(Buffer.concat(idat));
      if (raw.length !== height * (1 + rowBytes)) throw new PngError(`픽셀 데이터 길이가 맞지 않는다(기대 ${height * (1 + rowBytes)}, 실제 ${raw.length})`);
      const out = Buffer.alloc(height * rowBytes);
      for (let y = 0; y < height; y++) {
        const filter = raw[y * (1 + rowBytes)];
        const src = y * (1 + rowBytes) + 1;
        const dst = y * rowBytes;
        const prev = dst - rowBytes;
        for (let i = 0; i < rowBytes; i++) {
          const x = raw[src + i];
          const a = i >= bpp ? out[dst + i - bpp] : 0;
          const b = y > 0 ? out[prev + i] : 0;
          const c = y > 0 && i >= bpp ? out[prev + i - bpp] : 0;
          let v;
          if (filter === 0) v = x;
          else if (filter === 1) v = x + a;
          else if (filter === 2) v = x + b;
          else if (filter === 3) v = x + ((a + b) >> 1);
          else if (filter === 4) {
            const p = a + b - c;
            const pa = Math.abs(p - a);
            const pb = Math.abs(p - b);
            const pc = Math.abs(p - c);
            v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          } else throw new PngError(`알 수 없는 필터 ${filter}`);
          out[dst + i] = v & 0xff;
        }
      }
      return {
        ...base,
        // (x, y) 픽셀의 알파(0~255). 알파가 없으면 255
        alphaAt(x, y) {
          const row = y * rowBytes;
          if (colorType === 6) return bitDepth === 8 ? out[row + x * 4 + 3] : out[row + x * 8 + 6];
          if (colorType === 4) return bitDepth === 8 ? out[row + x * 2 + 1] : out[row + x * 4 + 2];
          if (colorType === 3) {
            const perByte = 8 / bitDepth;
            const byte = out[row + Math.floor(x / perByte)];
            const idx = (byte >> (8 - bitDepth * ((x % perByte) + 1))) & ((1 << bitDepth) - 1);
            return trns && idx < trns.length ? trns[idx] : 255;
          }
          if (trns && bitDepth === 8) {
            // 투명 색 키(gray 1개 / RGB 3개)와 같은 픽셀이 투명
            const n = colorType === 0 ? 1 : 3;
            for (let k = 0; k < n; k++) if (out[row + x * n + k] !== trns[k * 2 + 1]) return 255;
            return 0;
          }
          return 255;
        },
      };
    },
  };
}

// ---------- 검수 ----------

const keyOf = (file) => basename(file).replace(/\.png$/i, '');

function collectKeys(forest) {
  const keys = new Set();
  const add = (k) => {
    if (typeof k === 'string' && !NOT_FINAL_KEY.test(k)) keys.add(k);
  };
  add(forest.render?.background?.assetKey);
  for (const o of forest.render?.overlays ?? []) add(o.assetKey);
  for (const g of forest.layout?.gates ?? []) {
    add(g.closedAssetKey);
    add(g.openAssetKey);
  }
  for (const o of forest.objects ?? []) add(o.assetKey);
  for (const p of forest.storyPoints ?? []) add(p.assetKey);
  return keys;
}

// 같은 파일명(=assetKey)이 다른 폴더에도 있으면 나중 것이 앞의 것을 덮어쓴다 — 로더가 파일명으로 키를 만들기 때문
function duplicateKeys(assetsDir) {
  const seen = new Map();
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.png$/i.test(name)) {
        const k = keyOf(name);
        seen.set(k, [...(seen.get(k) ?? []), relative(assetsDir, full).split(sep).join('/')]);
      }
    }
  };
  for (const root of ['world', 'sprites', 'ui', 'items']) walk(join(assetsDir, root));
  return seen;
}

// 결과: { checks: [{ file, check, ok, expected?, actual? }], files: [{ path, width, height, alpha }], ok }
// 알파 0~8/255는 육안으로 구분되지 않는 투명으로 본다(생성 도구가 모서리에 알파 1을 남기는 경우가 있다)
const CORNER_ALPHA_MAX = 8;

export function verifyForestAssets({ assetsDir = DEFAULT_ASSETS_DIR, forestJsonPath = DEFAULT_FOREST_JSON, spec = FOREST_ASSETS, pairs = SAME_SIZE_PAIRS } = {}) {
  const checks = [];
  const files = [];
  const check = (file, name, ok, expected, actual) => checks.push({ file, check: name, ok, expected, actual });

  let forest = null;
  try {
    forest = JSON.parse(readFileSync(forestJsonPath, 'utf8'));
  } catch (err) {
    check('forest.json', '지역 데이터 읽기', false, forestJsonPath, err instanceof Error ? err.message : String(err));
  }

  const infos = new Map();
  for (const item of spec) {
    const full = join(assetsDir, item.path);
    if (!existsSync(full)) {
      check(item.path, '파일 존재', false, '있음', '없음');
      continue;
    }
    check(item.path, '파일 존재', true);
    let header;
    try {
      header = decodePng(readFileSync(full));
    } catch (err) {
      check(item.path, 'PNG 서명·헤더', false, '올바른 PNG', err instanceof Error ? err.message : String(err));
      continue;
    }
    check(item.path, 'PNG 서명·헤더', true);
    infos.set(item.path, header);
    files.push({ path: item.path, width: header.width, height: header.height, alpha: header.hasAlpha });
    check(item.path, '가로×세로', header.width === item.width && header.height === item.height, `${item.width}×${item.height}`, `${header.width}×${header.height}`);

    if (item.kind === 'alpha') check(item.path, '알파 채널', header.hasAlpha, '있음', '없음');

    let img;
    try {
      img = header.pixels();
    } catch (err) {
      check(item.path, '픽셀 읽기', false, '읽을 수 있는 픽셀', err instanceof Error ? err.message : String(err));
      continue;
    }
    const { width, height } = img;
    if (item.kind === 'alpha') {
      // 네 모서리가 투명
      const corners = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]];
      const opaque = corners.filter(([x, y]) => img.alphaAt(x, y) > CORNER_ALPHA_MAX).map(([x, y]) => `(${x},${y})α=${img.alphaAt(x, y)}`);
      check(item.path, '네 모서리 투명', header.hasAlpha && opaque.length === 0, `네 모서리 알파 ${CORNER_ALPHA_MAX} 이하(육안으로 투명)`, header.hasAlpha ? (opaque.join(', ') || '모두 투명') : '알파 채널 없음');
    } else {
      // 불투명 배경: 가장자리·주요 이동 영역에 완전 투명 픽셀이 없고, 전체가 불투명
      const firstZero = (inside) => {
        let n = 0;
        let first = null;
        const seen = new Set(); // 겹치는 구역·가장자리가 같은 픽셀을 두 번 세지 않게
        for (const [x0, y0, x1, y1] of inside) {
          for (let y = Math.max(0, y0); y < Math.min(height, y1); y++) {
            for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) {
              if (img.alphaAt(x, y) === 0 && !seen.has(y * width + x)) {
                seen.add(y * width + x);
                n++;
                first ??= `(${x},${y})`;
              }
            }
          }
        }
        return { n, first };
      };
      const edge = firstZero([[0, 0, width, 1], [0, height - 1, width, height], [0, 0, 1, height], [width - 1, 0, width, height]]);
      check(item.path, '가장자리 완전 투명 픽셀 없음', edge.n === 0, '0개', `${edge.n}개${edge.first ? `, 처음 ${edge.first}` : ''}`);
      // 주요 이동 영역: 처음부터 열려 있는 구역(visibleAfter 없음)과 길 중심선 둘레
      const rects = (forest?.layout?.zones ?? []).filter((z) => !z.visibleAfter).map((z) => [z.x, z.y, z.x + z.width, z.y + z.height]);
      for (const path of (forest?.layout?.paths ?? []).filter((p) => !p.visibleAfter)) for (const [x, y] of path.points) rects.push([x - 40, y - 40, x + 40, y + 40]);
      const zones = firstZero(rects);
      check(item.path, '주요 이동 영역 완전 투명 픽셀 없음', zones.n === 0, '0개', `${zones.n}개${zones.first ? `, 처음 ${zones.first}` : ''}`);
      let nonOpaque = 0;
      let firstNon = null;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (img.alphaAt(x, y) !== 255) {
            nonOpaque++;
            firstNon ??= `(${x},${y})α=${img.alphaAt(x, y)}`;
          }
        }
      }
      check(item.path, '전체 불투명', nonOpaque === 0, '알파 255만', nonOpaque === 0 ? '모두 불투명' : `${nonOpaque}개 반투명·투명, 처음 ${firstNon}`);
    }
  }

  for (const [a, b] of pairs) {
    const ia = infos.get(a);
    const ib = infos.get(b);
    if (!ia || !ib) {
      check(`${a} ↔ ${b}`, '닫힘/열림 캔버스 크기 같음', false, '두 파일 모두 존재', '한쪽 이상 없음');
      continue;
    }
    check(`${a} ↔ ${b}`, '닫힘/열림 캔버스 크기 같음', ia.width === ib.width && ia.height === ib.height, `${ia.width}×${ia.height}`, `${ib.width}×${ib.height}`);
  }

  // 파일명으로 계산되는 assetKey가 forest.json과 일치
  if (forest) {
    const fileKeys = new Set(spec.map((s) => keyOf(s.path)));
    const jsonKeys = collectKeys(forest);
    for (const k of fileKeys) check(`${k}.png`, 'forest.json에 assetKey 있음', jsonKeys.has(k), `forest.json의 assetKey "${k}"`, jsonKeys.has(k) ? '있음' : '없음');
    for (const k of jsonKeys) check('forest.json', `assetKey "${k}"의 검수 대상 파일`, fileKeys.has(k), `${k}.png`, fileKeys.has(k) ? '있음' : '검수 목록에 없음');
  }
  const dup = duplicateKeys(assetsDir);
  for (const item of spec) {
    const paths = dup.get(keyOf(item.path)) ?? [];
    if (paths.length > 1) check(item.path, '같은 파일명(assetKey) 중복 없음', false, '한 파일', paths.join(' / '));
  }

  return { checks, files, ok: checks.every((c) => c.ok) };
}

export function formatReport(result, spec = FOREST_ASSETS) {
  const lines = [];
  const failed = result.checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    lines.push(`✗ 숲 에셋 검수 실패 — ${failed.length}건`);
    for (const f of failed) lines.push(`  ✗ ${f.file} — ${f.check}: 기대 ${f.expected}, 실제 ${f.actual}`);
    return lines.join('\n');
  }
  lines.push(`✓ 숲 에셋 ${spec.length}개 검수 통과 (${result.checks.length}개 검사)`);
  for (const f of result.files) lines.push(`  ✓ ${f.path} — ${f.width}×${f.height}${f.alpha ? ' 알파' : ' 불투명'}`);
  return lines.join('\n');
}
