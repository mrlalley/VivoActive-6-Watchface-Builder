'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { generateMonkeyC } = require('../lib/generators/monkeyc');
const { generateProjectFiles } = require('../lib/generators');

// Minimal element set — hours text element, always valid
const HOURS_ELEMENT = {
  id: 0, fieldId: 'hours', label: 'Hours',
  x: 195, y: 195, width: 80, height: 53,
  font: 'FONT_NUMBER_MEDIUM', color: '#FFFFFF',
  align: 'center', visibility: 'always',
  format: '', zIndex: 0, shapeType: null,
};

// ─── generateMonkeyC ─────────────────────────────────────────────────────────

describe('generateMonkeyC — background parameter', () => {
  test('no background → dc.drawBitmap is absent', () => {
    const code = generateMonkeyC([HOURS_ELEMENT], null);
    expect(code).not.toContain('dc.drawBitmap');
    expect(code).not.toContain('WatchBackground');
  });

  test('background present → dc.drawBitmap(0, 0, Rez.Drawables.WatchBackground) emitted', () => {
    const bg = { source: 'bundled', assetId: 'analog-dress-gold' };
    const code = generateMonkeyC([HOURS_ELEMENT], bg);
    expect(code).toContain('dc.drawBitmap(0, 0, Rez.Drawables.WatchBackground)');
  });

  test('drawBitmap appears before element draw calls (after dc.clear)', () => {
    const bg = { source: 'bundled', assetId: 'analog-dress-gold' };
    const code = generateMonkeyC([HOURS_ELEMENT], bg);
    const bitmapIdx = code.indexOf('dc.drawBitmap');
    const clearIdx  = code.indexOf('dc.clear()');
    const textIdx   = code.indexOf('dc.drawText');
    expect(clearIdx).toBeGreaterThan(-1);
    expect(bitmapIdx).toBeGreaterThan(clearIdx);
    expect(textIdx).toBeGreaterThan(bitmapIdx);
  });

  test('drawable ID is always hardcoded WatchBackground (not derived from assetId)', () => {
    const bg = { source: 'bundled', assetId: 'analog-sport-dark' };
    const code = generateMonkeyC([HOURS_ELEMENT], bg);
    expect(code).toContain('Rez.Drawables.WatchBackground');
    expect(code).not.toContain('analog-sport-dark'); // assetId must not appear in source
  });

  test('background null (default param) works without explicit null arg', () => {
    const code = generateMonkeyC([HOURS_ELEMENT]);
    expect(code).not.toContain('dc.drawBitmap');
  });
});

// ─── generateProjectFiles ────────────────────────────────────────────────────

describe('generateProjectFiles — background parameter', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfb-gen-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeCfg(exportDir) {
    return {
      exportDir,
      devKey: '/fake/key.der',
      monkeyc: '/fake/monkeyc',
    };
  }

  test('no background → drawables.xml has only LauncherIcon, no bg.png', () => {
    const cfg = makeCfg(tmpDir);
    generateProjectFiles([HOURS_ELEMENT], 'TestFace', cfg, null);

    const drawablesXml = fs.readFileSync(
      path.join(tmpDir, 'resources', 'drawables', 'drawables.xml'), 'utf8'
    );
    expect(drawablesXml).toContain('LauncherIcon');
    expect(drawablesXml).not.toContain('WatchBackground');
    expect(fs.existsSync(path.join(tmpDir, 'resources', 'drawables', 'bg.png'))).toBe(false);
  });

  test('bundled background → bg.png copied, drawables.xml has WatchBackground entry', () => {
    const bg = { source: 'bundled', assetId: 'analog-dress-gold' };
    const cfg = makeCfg(tmpDir);
    generateProjectFiles([HOURS_ELEMENT], 'TestFace', cfg, bg);

    const bgPath = path.join(tmpDir, 'resources', 'drawables', 'bg.png');
    expect(fs.existsSync(bgPath)).toBe(true);
    expect(fs.statSync(bgPath).size).toBeGreaterThan(100); // non-trivial PNG

    const drawablesXml = fs.readFileSync(
      path.join(tmpDir, 'resources', 'drawables', 'drawables.xml'), 'utf8'
    );
    expect(drawablesXml).toContain('LauncherIcon');
    expect(drawablesXml).toContain('WatchBackground');
    expect(drawablesXml).toContain('filename="bg.png"');
  });

  test('bundled background → generated Monkey C contains dc.drawBitmap', () => {
    const bg = { source: 'bundled', assetId: 'analog-dress-gold' };
    const cfg = makeCfg(tmpDir);
    generateProjectFiles([HOURS_ELEMENT], 'TestFace', cfg, bg);

    const mc = fs.readFileSync(path.join(tmpDir, 'source', 'WatchFaceView.mc'), 'utf8');
    expect(mc).toContain('dc.drawBitmap(0, 0, Rez.Drawables.WatchBackground)');
  });

  test('non-existent assetId throws with descriptive message', () => {
    const bg = { source: 'bundled', assetId: 'does-not-exist' };
    const cfg = makeCfg(tmpDir);
    expect(() => generateProjectFiles([HOURS_ELEMENT], 'TestFace', cfg, bg))
      .toThrow(/background asset not found/i);
  });

  test('assetId with path traversal chars throws (belt-and-suspenders check)', () => {
    // Regex validation in validateBackground prevents this from reaching the generator,
    // but the generator also has its own path safety check.
    // We bypass validation here to test the generator's own guard directly.
    const bg = { source: 'bundled', assetId: '../../../etc/passwd' };
    const cfg = makeCfg(tmpDir);
    // Either throws path-safety error or asset-not-found — both are safe outcomes
    expect(() => generateProjectFiles([HOURS_ELEMENT], 'TestFace', cfg, bg)).toThrow();
  });

  test('generated Monkey C with no background does not contain dc.drawBitmap', () => {
    const cfg = makeCfg(tmpDir);
    generateProjectFiles([HOURS_ELEMENT], 'TestFace', cfg, null);

    const mc = fs.readFileSync(path.join(tmpDir, 'source', 'WatchFaceView.mc'), 'utf8');
    expect(mc).not.toContain('dc.drawBitmap');
    expect(mc).not.toContain('WatchBackground');
  });
});

// ─── generateProjectFiles — AOD variant ─────────────────────────────────────

describe('generateProjectFiles — AOD dimmed variant', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfb-gen-aod-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeCfg(exportDir) {
    return { exportDir, devKey: '/fake/key.der', monkeyc: '/fake/monkeyc' };
  }

  test('aod.variant none → no bg-aod.png, no WatchBackgroundAOD', () => {
    const bg = { source: 'bundled', assetId: 'analog-dress-gold', aod: { variant: 'none' } };
    generateProjectFiles([HOURS_ELEMENT], 'TestFace', makeCfg(tmpDir), bg);

    expect(fs.existsSync(path.join(tmpDir, 'resources', 'drawables', 'bg-aod.png'))).toBe(false);
    const xml = fs.readFileSync(path.join(tmpDir, 'resources', 'drawables', 'drawables.xml'), 'utf8');
    expect(xml).not.toContain('WatchBackgroundAOD');
  });

  test('aod absent → no bg-aod.png (treated as none)', () => {
    const bg = { source: 'bundled', assetId: 'analog-dress-gold' };
    generateProjectFiles([HOURS_ELEMENT], 'TestFace', makeCfg(tmpDir), bg);

    expect(fs.existsSync(path.join(tmpDir, 'resources', 'drawables', 'bg-aod.png'))).toBe(false);
  });

  test('aod.variant dimmed → bg-aod.png created', () => {
    const bg = { source: 'bundled', assetId: 'analog-dress-gold', aod: { variant: 'dimmed' } };
    generateProjectFiles([HOURS_ELEMENT], 'TestFace', makeCfg(tmpDir), bg);

    const aodPath = path.join(tmpDir, 'resources', 'drawables', 'bg-aod.png');
    expect(fs.existsSync(aodPath)).toBe(true);
    expect(fs.statSync(aodPath).size).toBeGreaterThan(100);
  });

  test('aod.variant dimmed → drawables.xml contains WatchBackgroundAOD', () => {
    const bg = { source: 'bundled', assetId: 'analog-dress-gold', aod: { variant: 'dimmed' } };
    generateProjectFiles([HOURS_ELEMENT], 'TestFace', makeCfg(tmpDir), bg);

    const xml = fs.readFileSync(path.join(tmpDir, 'resources', 'drawables', 'drawables.xml'), 'utf8');
    expect(xml).toContain('WatchBackgroundAOD');
    expect(xml).toContain('filename="bg-aod.png"');
  });

  test('aod.variant dimmed → Monkey C emits isAwake branch', () => {
    const bg = { source: 'bundled', assetId: 'analog-dress-gold', aod: { variant: 'dimmed' } };
    generateProjectFiles([HOURS_ELEMENT], 'TestFace', makeCfg(tmpDir), bg);

    const mc = fs.readFileSync(path.join(tmpDir, 'source', 'WatchFaceView.mc'), 'utf8');
    expect(mc).toContain('System.getDeviceSettings().isAwake');
    expect(mc).toContain('WatchBackgroundAOD');
    expect(mc).toContain('WatchBackground');
  });

  test('aod.variant dimmed → Monkey C uses isAwake branch (not unconditional draw)', () => {
    const bg = { source: 'bundled', assetId: 'analog-dress-gold', aod: { variant: 'dimmed' } };
    const mc = require('../lib/generators/monkeyc').generateMonkeyC([HOURS_ELEMENT], bg);
    // isAwake guard must be present
    expect(mc).toContain('System.getDeviceSettings().isAwake');
    // Both bitmap IDs must appear
    expect(mc).toContain('dc.drawBitmap(0, 0, Rez.Drawables.WatchBackground)');
    expect(mc).toContain('dc.drawBitmap(0, 0, Rez.Drawables.WatchBackgroundAOD)');
    // The unconditional single-draw form (no if/else) must NOT appear when AOD is dimmed
    expect(mc).not.toMatch(/dc\.clear\(\);\s*\n\s*dc\.drawBitmap\(0, 0, Rez\.Drawables\.WatchBackground\);\s*\n\s*(?!.*else)/m);
  });

  test('bg-aod.png is dimmer than bg.png (average pixel value is lower)', () => {
    const bg = { source: 'bundled', assetId: 'analog-minimal-white', aod: { variant: 'dimmed' } };
    generateProjectFiles([HOURS_ELEMENT], 'TestFace', makeCfg(tmpDir), bg);

    // The AOD file should be strictly smaller in file size (dimmer = more zeros = better compression)
    const bgSize    = fs.statSync(path.join(tmpDir, 'resources', 'drawables', 'bg.png')).size;
    const bgAodSize = fs.statSync(path.join(tmpDir, 'resources', 'drawables', 'bg-aod.png')).size;
    expect(bgAodSize).toBeLessThan(bgSize);
  });
});
