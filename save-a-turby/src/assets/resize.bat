@echo off
setlocal

if "%~1"=="" (
  echo Usage: resize.bat relative-path-from-assets [size]
  echo Example: resize.bat avatar\child.png
  echo Example: resize.bat turby\nubi.png 512
  exit /b 1
)

set "REL=%~1"
set "SIZE=%~2"
set "TARGET=%~dp0%REL%"

if "%SIZE%"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0resize.ps1" -Path "%TARGET%"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0resize.ps1" -Path "%TARGET%" -Size %SIZE%
)
