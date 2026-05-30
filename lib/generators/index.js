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

const TEMPLATE_DIR = path.join(__dirname, '..', '..', 'garmin-project-template');

function generateProjectFiles(elements, projectName, cfg) {
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

  fs.writeFileSync(
    path.join(cfg.exportDir, 'resources', 'drawables', 'drawables.xml'),
    `<drawables xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://developer.garmin.com/downloads/connect-iq/resources.xsd">\n    <bitmap id="LauncherIcon" filename="launcher_icon.png" />\n</drawables>\n`,
  );

  const vscodeDir = path.join(cfg.exportDir, '.vscode');
  fs.mkdirSync(vscodeDir, { recursive: true });
  fs.writeFileSync(path.join(vscodeDir, 'settings.json'),
    JSON.stringify({ 'monkeyC.developerKeyPath': cfg.devKey }, null, 2) + '\n');

  const permissions = getRequiredPermissions(elements);

  fs.writeFileSync(path.join(cfg.exportDir, 'manifest.xml'), generateManifest(projectName, permissions));
  fs.writeFileSync(path.join(cfg.exportDir, 'monkey.jungle'), generateJungle());
  fs.writeFileSync(path.join(cfg.exportDir, 'source', 'WatchFaceView.mc'), generateMonkeyC(elements));
  fs.writeFileSync(path.join(cfg.exportDir, 'resources', 'layouts', 'layout.xml'), generateLayout());
  fs.writeFileSync(path.join(cfg.exportDir, 'resources', 'strings', 'strings.xml'), generateStrings(projectName));
}

module.exports = { generateProjectFiles };
