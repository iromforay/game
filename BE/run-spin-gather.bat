@echo off
cd /d "%~dp0"
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (`findstr /B /C:"SPIN_GATHER_PORT=" ".env"`) do set "%%A=%%B"
)
if not defined SPIN_GATHER_PORT set "SPIN_GATHER_PORT=3006"
echo Spin Gather BE port: %SPIN_GATHER_PORT%
call npm run dev:spin-gather
