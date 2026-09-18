#!/usr/bin/env node
/**
 * bubblewrap update/build 전에 실행한다.
 *
 * TWA는 웹뷰가 아니라 Chrome Custom Tab을 여는 방식이라 네이티브<->JS
 * 브릿지가 없다 - FE(React)가 자기가 몇 버전 APK 안에서 열렸는지 알 수
 * 있는 유일한 방법은 시작 URL에 쿼리파라미터로 박아 보내는 것뿐이다.
 * 그래서 twa-manifest.json의 appVersionName(단일 소스)을 startUrl에
 * 반영해둔다 - 여기서 고치면 bubblewrap update가 app/build.gradle의
 * launchUrl까지 자동으로 갱신한다.
 *
 * 버전을 올릴 때: twa-manifest.json의 appVersion/appVersionName/
 * appVersionCode 수정 -> node scripts/inject-version.js -> bubblewrap update
 * -> bubblewrap build 순서로 실행한다.
 */
const fs = require("fs");
const path = require("path");

const MANIFEST_PATH = path.join(__dirname, "..", "twa-manifest.json");

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

const versionName = manifest.appVersionName;
if (!versionName) {
  throw new Error("twa-manifest.json에 appVersionName이 없습니다.");
}

manifest.startUrl = `/intro?utm_source=twa&platform=android&version_code=${encodeURIComponent(versionName)}`;

fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
console.log(`startUrl -> ${manifest.startUrl}`);
