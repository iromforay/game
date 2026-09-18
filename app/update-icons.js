const path = require('path');
const { TwaManifest, TwaGenerator, BufferedLog, ConsoleLog } = require('@bubblewrap/core');

async function main() {
  const TARGET_DIR = __dirname;
  // Reloads the existing twa-manifest.json (signing key untouched) and
  // re-fetches icon/webmanifest data to refresh generated Android resources
  // - used when only the source icon images changed, not the app identity.
  const twaManifest = await TwaManifest.fromFile(path.join(TARGET_DIR, 'twa-manifest.json'));
  const twaGenerator = new TwaGenerator();
  const log = new BufferedLog(new ConsoleLog('Updating TWA icons'));
  await twaGenerator.createTwaProject(TARGET_DIR, twaManifest, log, () => {});
  log.flush();
  console.log('DONE');
}

main().catch((e) => { console.error(e); process.exit(1); });
