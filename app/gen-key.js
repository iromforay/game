const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Config, JdkHelper, KeyTool, TwaManifest } = require('@bubblewrap/core');

function randomPassword(len = 24) {
  return crypto.randomBytes(len).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, len);
}

async function main() {
  const config = Config.deserialize(fs.readFileSync(path.join(os.homedir(), '.bubblewrap', 'config.json'), 'utf8'));
  const jdkHelper = new JdkHelper(process, config);

  const javaBin = jdkHelper.getJavaBin();
  process.env.PATH = javaBin + ';' + process.env.PATH;
  process.env.Path = process.env.PATH;
  process.env.JAVA_HOME = jdkHelper.getJavaHome();

  const keytool = new KeyTool(jdkHelper);
  const twaManifest = await TwaManifest.fromFile(path.join(__dirname, 'twa-manifest.json'));

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

  const credsPath = path.join(__dirname, 'keystore-credentials.txt');
  fs.writeFileSync(credsPath,
    `android.keystore 서명키 정보 (절대 git에 커밋하지 말 것 - .gitignore 처리됨)\n\n` +
    `keystore path: ${twaManifest.signingKey.path}\n` +
    `alias: ${twaManifest.signingKey.alias}\n` +
    `keystore password: ${keystorePassword}\n` +
    `key password: ${keyPassword}\n`
  );

  console.log('DONE');
}

main().catch((e) => { console.error(e); process.exit(1); });
