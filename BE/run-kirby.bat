@echo off
rem 커비 전용 BE(NestJS + Socket.IO, src/kirby-main.ts) 단독 실행용 - 알까기(run.bat)와 별도 프로세스
cd /d "%~dp0"
call npm run dev:kirby
