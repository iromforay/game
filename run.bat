@echo off
rem 실제 게임 실행 (hub: 대시보드 + tower-defense 포함)
cd /d "%~dp0"
call npm run dev --workspace hub
