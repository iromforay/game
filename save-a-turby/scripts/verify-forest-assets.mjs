// 최종 숲 PNG를 런타임 경로에 복사한 직후 실행하는 읽기 전용 검수 명령.
//   npm run verify:forest-assets
//   node scripts/verify-forest-assets.mjs [--assets <assets 폴더>] [--forest-json <forest.json>]
// 모두 통과하면 종료 코드 0과 13개 파일의 크기·검수 요약, 하나라도 실패하면 파일명·기대값·실제값을 출력하고 종료 코드 1.
// 에셋이 아직 없을 때는 실패하는 것이 정상이다. 파일을 쓰거나 바꾸지 않고 네트워크도 쓰지 않는다.
import { DEFAULT_ASSETS_DIR, DEFAULT_FOREST_JSON, formatReport, verifyForestAssets } from './forest-assets.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const result = verifyForestAssets({ assetsDir: arg('--assets', DEFAULT_ASSETS_DIR), forestJsonPath: arg('--forest-json', DEFAULT_FOREST_JSON) });
const report = formatReport(result);
if (result.ok) {
  console.log(report);
  process.exit(0);
}
console.error(report);
process.exit(1);
