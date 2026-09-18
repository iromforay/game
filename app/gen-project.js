const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  TwaManifest, TwaGenerator, Config, JdkHelper, KeyTool,
  BufferedLog, ConsoleLog,
} = require('@bubblewrap/core');

const TARGET_DIR = __dirname;

function randomPassword(len = 24) {
  return crypto.randomBytes(len).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, len);
}

async function main() {
  const twaManifest = await TwaManifest.fromWebManifest('https://game.bomul.ai.kr/manifest.json');

  // Overrides decided with the user.
  twaManifest.host = 'game.bomul.ai.kr';
  twaManifest.packageId = 'com.bomul.game';
  twaManifest.generatorApp = 'bubblewrap-cli';
  twaManifest.orientation = 'landscape';
  twaManifest.signingKey.path = path.join(TARGET_DIR, 'android.keystore');
  twaManifest.signingKey.alias = 'android';

  await twaManifest.saveToFile(path.join(TARGET_DIR, 'twa-manifest.json'));

  const twaGenerator = new TwaGenerator();
  const log = new BufferedLog(new ConsoleLog('Generating TWA'));
  await twaGenerator.createTwaProject(TARGET_DIR, twaManifest, log, () => {});
  log.flush();

  // checksum file
  const manifestContents = await fs.promises.readFile(path.join(TARGET_DIR, 'twa-manifest.json'));
  const sum = crypto.createHash('sha1').update(manifestContents).digest('hex');
  await fs.promises.writeFile(path.join(TARGET_DIR, 'manifest-checksum.txt'), sum);

  // Signing key - fresh key for this app, not shared with boyak-app.
  const config = Config.deserialize(await fs.promises.readFile(path.join(require('os').homedir(), '.bubblewrap', 'config.json'), 'utf8'));
  const jdkHelper = new JdkHelper(process, config);
  const keytool = new KeyTool(jdkHelper);

  const keystorePassword = randomPassword();
  const keyPassword = randomPassword();

  await keytool.createSigningKey({
    fullName: 'GameHub App',
    organizationalUnit: 'GameHub',
    organization: 'Bomul',
    country: 'KR',
    password: keystorePassword,
    keypassword: keyPassword,
    alias: twaManifest.signingKey.alias,
    path: twaManifest.signingKey.path,
  });

  const credsPath = path.join(TARGET_DIR, 'keystore-credentials.txt');
  await fs.promises.writeFile(credsPath,
    `android.keystore 서명키 정보 (절대 git에 커밋하지 말 것 - .gitignore 처리됨)\n\n` +
    `keystore path: ${twaManifest.signingKey.path}\n` +
    `alias: ${twaManifest.signingKey.alias}\n` +
    `keystore password: ${keystorePassword}\n` +
    `key password: ${keyPassword}\n`
  );

  console.log('DONE');
  console.log('signing key at:', twaManifest.signingKey.path);
  console.log('credentials at:', credsPath);
}

main().catch((e) => { console.error(e); process.exit(1); });
