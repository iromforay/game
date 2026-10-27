@echo off
setlocal

set "COLOR_BLASTERS_BE=%~dp0..\..\color-blaster-worktree\BE"

if not exist "%COLOR_BLASTERS_BE%\run-color_blaster.bat" (
  echo ERROR: Color Blasters worktree was not found.
  echo Expected: %COLOR_BLASTERS_BE%
  exit /b 1
)

call "%COLOR_BLASTERS_BE%\run-color_blaster.bat"
exit /b %ERRORLEVEL%
