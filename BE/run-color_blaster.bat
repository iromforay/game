@echo off
rem Color Blasters dedicated NestJS and Socket.IO server.
cd /d "%~dp0"

rem Read the dedicated port from BE/.env when configured.
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (`findstr /B /C:"COLOR_BLASTERS_PORT=" ".env"`) do set "%%A=%%B"
)

if not defined COLOR_BLASTERS_PORT set "COLOR_BLASTERS_PORT=3007"
echo Color Blasters BE port: %COLOR_BLASTERS_PORT%
call npm run dev:color-blasters
