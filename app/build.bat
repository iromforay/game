@echo off
rem Build the Boyak app (APK/AAB).
rem
rem Steps:
rem   1) sync-version      - reflect twa-manifest.json's appVersionName into
rem                          startUrl's version_code query param
rem   2) bubblewrap update - apply that twa-manifest.json change to the
rem                          generated Android project (app/build.gradle etc.)
rem   3) bubblewrap build  - produce a signed APK/AAB (enter the keystore
rem                          password from keystore-credentials.txt if asked)
rem
rem Before running this for a new release, bump appVersion / appVersionName /
rem appVersionCode in twa-manifest.json first.

setlocal
cd /d "%~dp0"

echo [1/3] sync-version (twa-manifest.json -^> startUrl)
call npm run sync-version
if errorlevel 1 goto :error

echo [2/3] bubblewrap update
call npx bubblewrap update
if errorlevel 1 goto :error

echo [3/3] bubblewrap build
call npx bubblewrap build
if errorlevel 1 goto :error

echo.
echo Build finished. Check app-release-signed.apk / app-release-bundle.aab
exit /b 0

:error
echo.
echo Build failed. See the log above.
exit /b 1
