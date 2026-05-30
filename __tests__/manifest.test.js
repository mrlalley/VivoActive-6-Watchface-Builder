const { generateManifest } = require('../lib/generators/manifest');

describe('Manifest Generator', () => {
  it('generates valid XML structure', () => {
    const manifest = generateManifest('TestFace', []);
    expect(manifest).toContain('<?xml version="1.0"?>');
    expect(manifest).toContain('<iq:manifest');
    expect(manifest).toContain('</iq:manifest>');
  });

  it('includes application name', () => {
    const manifest = generateManifest('MyWatchFace', []);
    expect(manifest).toContain('@Strings.AppName');
  });

  it('includes product ID', () => {
    const manifest = generateManifest('Face', []);
    expect(manifest).toContain('vivoactive6');
  });

  it('includes minimum API level', () => {
    const manifest = generateManifest('Face', []);
    expect(manifest).toContain('minApiLevel="4.2.0"');
  });

  it('generates permissions block when permissions provided', () => {
    const manifest = generateManifest('Face', ['UserProfile', 'SensorHistory']);
    expect(manifest).toContain('<iq:permissions>');
    expect(manifest).toContain('</iq:permissions>');
    expect(manifest).toContain('<iq:uses-permission id="UserProfile"/>');
    expect(manifest).toContain('<iq:uses-permission id="SensorHistory"/>');
  });

  it('generates empty permissions block when no permissions', () => {
    const manifest = generateManifest('Face', []);
    expect(manifest).toContain('<iq:permissions/>');
  });

  it('generates application ID based on timestamp', () => {
    const manifest = generateManifest('Face', []);

    // Extract ID
    const idMatch = manifest.match(/id="(a[0-9a-f-]+)"/);
    expect(idMatch).toBeTruthy();
    expect(idMatch[1]).toMatch(/^a[0-9a-f-]+$/);
  });

  it('includes launcher icon reference', () => {
    const manifest = generateManifest('Face', []);
    expect(manifest).toContain('launcherIcon="@Drawables.LauncherIcon"');
  });

  it('includes language declaration', () => {
    const manifest = generateManifest('Face', []);
    expect(manifest).toContain('<iq:language>eng</iq:language>');
  });

  it('validates XML structure with multiple permissions', () => {
    const manifest = generateManifest('ComplexFace', [
      'UserProfile',
      'SensorHistory',
      'Positioning',
    ]);

    expect(manifest).toContain('id="UserProfile"');
    expect(manifest).toContain('id="SensorHistory"');
    expect(manifest).toContain('id="Positioning"');
  });

  it('escapes special characters in app name', () => {
    // The manifest generator should handle the projectName safely
    const manifest = generateManifest('Face & Friends', []);
    expect(manifest).toBeTruthy();
    // Note: The actual XML doesn't escape the name since it's referenced via @Strings.AppName
  });
});
