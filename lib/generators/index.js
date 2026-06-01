// Orchestrates project file generation: creates directories and writes all files.

const fs = require('fs');
const path = require('path');
const { generateManifest } = require('./manifest');
const { generateJungle } = require('./jungle');
const { generateMonkeyC } = require('./monkeyc');
const { generateLayout } = require('./layout');
const { generateStrings } = require('./strings');
const { getRequiredPermissions } = require('./permissions');
const { generate54x54Icon } = require('../icon-generator');
const { dimBackground } = require('../aod-generator');

// Root of the assets/backgrounds/ directory — resolved once at module load.
const ASSETS_BG_DIR = path.resolve(__dirname, '..', '..', 'assets', 'backgrounds');

function generateProjectFiles(elements, projectName, cfg, background = null) {
  const dirs = [
    cfg.exportDir,
    path.join(cfg.exportDir, 'source'),
    path.join(cfg.exportDir, 'resources', 'layouts'),
    path.join(cfg.exportDir, 'resources', 'drawables'),
    path.join(cfg.exportDir, 'resources', 'strings'),
    path.join(cfg.exportDir, 'resources', 'fonts'),
    path.join(cfg.exportDir, 'bin'),
  ];
  dirs.forEach(d => fs.mkdirSync(d, { recursive: true }));

  const iconDst = path.join(cfg.exportDir, 'resources', 'drawables', 'launcher_icon.png');
  const iconBuffer = generate54x54Icon();
  fs.writeFileSync(iconDst, iconBuffer);

  // Copy background PNG when a background is selected
  let backgroundBitmapEntry = '';
  if (background !== null) {
    let srcDir, srcPng;

    if (background.source === 'custom') {
      // Custom: resolve from cfg.backgroundsDir (managed userData directory)
      if (!cfg.backgroundsDir) {
        throw new Error('backgroundsDir is not configured — cannot resolve custom background');
      }
      srcDir = path.resolve(cfg.backgroundsDir);
      srcPng = path.resolve(srcDir, `${background.assetId}.png`);
      // Safety: destination must stay within backgroundsDir
      if (!srcPng.startsWith(srcDir + path.sep) && srcPng !== srcDir) {
        throw new Error(`custom background assetId resolves outside backgrounds directory: "${background.assetId}"`);
      }
    } else {
      // Bundled: resolve from assets/backgrounds/ shipped with the app
      srcDir = ASSETS_BG_DIR;
      srcPng = path.resolve(ASSETS_BG_DIR, `${background.assetId}.png`);
      // Safety: assetId already validated by validateBackground() in the route handler.
      // Belt-and-suspenders: ensure resolved source path stays within ASSETS_BG_DIR.
      if (!srcPng.startsWith(ASSETS_BG_DIR + path.sep) && srcPng !== ASSETS_BG_DIR) {
        throw new Error(`background assetId resolves outside assets directory: "${background.assetId}"`);
      }
    }

    if (!fs.existsSync(srcPng)) {
      throw new Error(`background asset not found: "${background.assetId}" (expected at ${srcPng})`);
    }
    const srcBuffer = fs.readFileSync(srcPng);
    const dstPng    = path.join(cfg.exportDir, 'resources', 'drawables', 'bg.png');
    fs.writeFileSync(dstPng, srcBuffer);

    // AOD dimmed variant: generate bg-aod.png at 25% luminance
    const aodVariant = background.aod && background.aod.variant;
    let aodBitmapEntry = '';
    if (aodVariant === 'dimmed') {
      const aodBuffer = dimBackground(srcBuffer, 0.25);
      const dstAodPng = path.join(cfg.exportDir, 'resources', 'drawables', 'bg-aod.png');
      fs.writeFileSync(dstAodPng, aodBuffer);
      aodBitmapEntry = '\n    <bitmap id="WatchBackgroundAOD" filename="bg-aod.png" />';
    }

    backgroundBitmapEntry = `\n    <bitmap id="WatchBackground" filename="bg.png" />${aodBitmapEntry}`;
  }

  fs.writeFileSync(
    path.join(cfg.exportDir, 'resources', 'drawables', 'drawables.xml'),
    `<drawables xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://developer.garmin.com/downloads/connect-iq/resources.xsd">\n    <bitmap id="LauncherIcon" filename="launcher_icon.png" />${backgroundBitmapEntry}\n</drawables>\n`,
  );

  // Note: Don't write developer key path to .vscode/settings.json
  // VS Code can auto-discover keys in standard location (~/.garmin/developer_key.der)
  // Avoid exposing sensitive paths in project files that might be committed
  const vscodeDir = path.join(cfg.exportDir, '.vscode');
  fs.mkdirSync(vscodeDir, { recursive: true });
  fs.writeFileSync(path.join(vscodeDir, 'settings.json'),
    JSON.stringify({ '[monkey-c]': { 'editor.formatOnSave': true } }, null, 2) + '\n');

  const permissions = getRequiredPermissions(elements);

  fs.writeFileSync(path.join(cfg.exportDir, 'manifest.xml'), generateManifest(permissions));
  fs.writeFileSync(path.join(cfg.exportDir, 'monkey.jungle'), generateJungle());
  fs.writeFileSync(path.join(cfg.exportDir, 'source', 'WatchFaceView.mc'), generateMonkeyC(elements, background));
  fs.writeFileSync(path.join(cfg.exportDir, 'resources', 'layouts', 'layout.xml'), generateLayout());
  fs.writeFileSync(path.join(cfg.exportDir, 'resources', 'strings', 'strings.xml'), generateStrings(projectName));
}

module.exports = { generateProjectFiles };
