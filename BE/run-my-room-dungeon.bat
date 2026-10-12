@echo off
rem 내 방이 던전 전용 BE(NestJS, src/my-room-dungeon-main.ts) 단독 실행용
cd /d "%~dp0"

rem 포트는 BE/.env를 단일 설정 원본으로 사용한다.
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (`findstr /B /C:"MY_ROOM_DUNGEON_PORT=" ".env"`) do set "%%A=%%B"
)

if not defined MY_ROOM_DUNGEON_PORT set "MY_ROOM_DUNGEON_PORT=3004"
echo 내 방이 던전 BE 포트: %MY_ROOM_DUNGEON_PORT%
call npm run dev:my-room-dungeon
