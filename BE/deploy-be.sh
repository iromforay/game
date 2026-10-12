#!/usr/bin/env bash
#
# BE 배포 스크립트 — 운영 서버에서 git pull 이후 실행
# DB 스키마 변경(BE/prisma/sql/*.sql)은 이 스크립트 실행 "전에" 수동으로 반영할 것.
#
# 사용: ./deploy-be.sh                                   (기본: 전체 BE 프로세스)
#       APPS="my-room-dungeon-be kirby-be" ./deploy-be.sh  (일부 프로세스만 배포할 때)
#
# 배경(2026-09-23): 운영 BE는 pm2가 dist/*.js를 실행하는데 dist는 git에 없고, 루트 build.sh는
# hub(FE)만 배포한다. 그래서 git pull + pm2 restart만 하면 9월 18일 빌드가 그대로 떠서 로비
# 소켓 이벤트(lobby:*)가 운영에 없었고, 서버 Prisma 클라이언트도 옛 스키마라 빌드가 실패했었다.
#
set -euo pipefail

BE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$BE_DIR/.." && pwd)"
APPS="${APPS:-my-room-dungeon-be kirby-be be turby-be}"

# 포트 설정은 BE/.env를 단일 원본으로 사용한다. 셸 코드를 실행하지 않고 포트 변수만 읽는다.
if [ -f "$BE_DIR/.env" ]; then
    while IFS='=' read -r key value; do
        key="${key%$'\r'}"
        value="${value%$'\r'}"
        case "$key" in
            PORT|TURBY_PORT|KIRBY_PORT|MY_ROOM_DUNGEON_PORT)
                export "$key=$value"
                ;;
        esac
    done < "$BE_DIR/.env"
fi

: "${MY_ROOM_DUNGEON_PORT:=3004}"
export MY_ROOM_DUNGEON_PORT
echo "내 방이 던전 BE 포트: $MY_ROOM_DUNGEON_PORT"

# 1. 로컬 HEAD가 upstream과 같은지 확인(build.sh와 동일, fetch/pull은 하지 않음)
if [ -d "$REPO_DIR/.git" ]; then
    LOCAL_HEAD="$(git -C "$REPO_DIR" rev-parse HEAD)"
    REMOTE_HEAD="$(git -C "$REPO_DIR" rev-parse '@{u}' 2>/dev/null || true)"
    if [ -n "$REMOTE_HEAD" ] && [ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]; then
        echo "ERROR: 로컬 HEAD가 upstream과 다릅니다. git pull 먼저 실행하세요." >&2
        exit 1
    fi
    echo "HEAD: $(git -C "$REPO_DIR" log -1 --oneline)"
fi

# 2. 의존성 설치 — 반드시 루트에서(npm workspaces), tsc/prisma CLI가 devDependency라 --include=dev 필수
( cd "$REPO_DIR" && npm install --include=dev )

# 3. Prisma 클라이언트 재생성 — 타입/클라이언트만 다시 만듦, DB는 건드리지 않음
( cd "$BE_DIR" && npx prisma generate )

# 4. 빌드 — 에러가 있으면 set -e로 여기서 중단되어 재시작하지 않음
( cd "$BE_DIR" && npm run build )

# 5. 빌드 산출물이 방금 갱신됐는지 확인(10분 이내)
if [ -z "$(find "$BE_DIR/dist" -name '*.js' -mmin -10 | head -1)" ]; then
    echo "ERROR: dist가 갱신되지 않았습니다." >&2
    exit 1
fi

# 6. 재시작(최초 배포 앱은 ecosystem 설정으로 생성) + 목록 저장(서버 재부팅 시 복구용)
for app in $APPS; do
    if pm2 describe "$app" >/dev/null 2>&1; then
        pm2 restart "$app" --update-env
    else
        pm2 start "$BE_DIR/ecosystem.config.js" --only "$app" --update-env
    fi
done
pm2 save

# 7. 기동 확인 — 몇 초 뒤 상태와 최근 에러 로그 출력
sleep 5
pm2 list
for app in $APPS; do
    echo "===== $app 최근 에러 로그 ====="
    pm2 logs "$app" --err --lines 15 --nostream || true
done
echo "완료. 재시작 횟수(↺)가 계속 늘어나면 크래시 루프이니 로그를 확인하세요."
