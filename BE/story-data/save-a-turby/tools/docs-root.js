// docs/는 .gitignore 대상이라 대본·설계 문서(docs/scene 등)는 본 체크아웃에만 있다(워크트리 docs/에는 소통 폴더만 있음).
// 찾는 순서: TURBY_DOCS_ROOT 환경변수 → 이 체크아웃 → git 공용 저장소(.git)가 속한 본 체크아웃.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function docsRoot(repoRoot) {
  const candidates = [process.env.TURBY_DOCS_ROOT, repoRoot];
  try {
    const common = execSync('git rev-parse --path-format=absolute --git-common-dir', { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    candidates.push(path.dirname(common));
  } catch {
    // git이 없으면 앞의 후보만 본다
  }
  const found = candidates.find((dir) => dir && fs.existsSync(path.join(dir, 'docs', 'scene')));
  if (!found) throw new Error('docs/scene을 찾지 못했습니다. TURBY_DOCS_ROOT에 docs/scene이 있는 체크아웃 경로를 지정해 주세요.');
  return found;
}

module.exports = { docsRoot };
