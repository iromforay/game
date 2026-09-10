#!/usr/bin/env bash
#
# release+symlink 무중단 배포 스크립트
# git pull은 이 스크립트 밖에서 이미 완료되었다고 가정한다 (여기서는 실행하지 않음).
#
# 동작:
#   1. (가능하면) 로컬 HEAD가 upstream과 같은지 체크만 함 - fetch/pull은 하지 않음
#   2. npm workspaces 의존성 설치 (루트에서 실행해야 hub가 tower-defense/offense-tower를
#      심볼릭 링크로 찾음)
#   3. hub를 build/releases/<timestamp> 로 빌드
#      (hub가 실제 배포 단위 - tower-defense/offense-tower는 hub 번들 안에 이미 포함됨)
#   4. build/current 심볼릭 링크를 새 release로 무중단 전환
#
# 전제: 이 스크립트는 모노레포 루트(hub/, tower-defense/, offense-tower/의 부모)에 위치.
#       nginx root는 <repo>/build/current 를 바라봄.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$SCRIPT_DIR"
APP_DIR="$REPO_DIR/hub"
BUILD_ROOT="$REPO_DIR/build"
RELEASES_DIR="$BUILD_ROOT/releases"
CURRENT_LINK="$BUILD_ROOT/current"

# 1. git pull 여부 체크 (네트워크 접근 없이, 마지막으로 fetch된 upstream ref 기준)
if [ -d "$REPO_DIR/.git" ]; then
    LOCAL_HEAD="$(git -C "$REPO_DIR" rev-parse HEAD)"
    REMOTE_HEAD="$(git -C "$REPO_DIR" rev-parse '@{u}' 2>/dev/null || true)"
    if [ -n "$REMOTE_HEAD" ] && [ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]; then
        echo "ERROR: 로컬 HEAD($LOCAL_HEAD)가 upstream($REMOTE_HEAD)과 다릅니다. git pull 먼저 실행하세요." >&2
        exit 1
    fi
fi

# 2. workspace 의존성 설치 (반드시 루트에서 - hub/tower-defense/offense-tower 심볼릭 링크가 여기서 잡힘)
( cd "$REPO_DIR" && npm install )

# 3. releases/<timestamp> 로 빌드
TIMESTAMP="$(date '+%Y%m%d%H%M%S')"
RELEASE_DIR="$RELEASES_DIR/$TIMESTAMP"
mkdir -p "$RELEASE_DIR"

( cd "$APP_DIR" && npx vite build --outDir "$RELEASE_DIR" )

# 4. current 심볼릭 링크를 새 release로 무중단(원자적) 전환
ln -sfn "releases/$TIMESTAMP" "$BUILD_ROOT/current_tmp"
mv -Tf "$BUILD_ROOT/current_tmp" "$CURRENT_LINK"

echo "current -> releases/$TIMESTAMP"
