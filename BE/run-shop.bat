@echo off
rem Sweet Shop BE daemon (NestJS + Socket.IO)
cd /d "%~dp0"

rem Read the port from BE/.env when configured.
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (`findstr /B /C:"SWEET_SHOP_PORT=" ".env"`) do set "%%A=%%B"
)

if not defined SWEET_SHOP_PORT set "SWEET_SHOP_PORT=3005"
if not defined SWEET_SHOP_MULTIPLAYER_ENABLED set "SWEET_SHOP_MULTIPLAYER_ENABLED=true"
echo Sweet Shop BE port: %SWEET_SHOP_PORT%
echo Sweet Shop multiplayer: %SWEET_SHOP_MULTIPLAYER_ENABLED%
call npm run dev:sweet-shop
