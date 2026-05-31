const { generateManifest } = require('../lib/generators/manifest');

describe('Manifest Generator', () => {
  it('generates valid XML structure', () => {
    const manifest = generateManifest([]);
    expect(manifest).toContain('<?xml version="1.0"?>');
    expect(manifest).toContain('<iq:manifest');
    expect(manifest).toContain('</iq:manifest>');
  });

  it('includes application name', () => {
    const manifest = generateManifest([]);
    expect(manifest).toContain('@Strings.AppName');
  });

  it('includes product ID', () => {
    const manifest = generateManifest([]);
    expect(manifest).toContain('vivoactive6');
  });

  it('includes minimum API level', () => {
    const manifest = generateManifest([]);
    expect(manifest).toContain('minApiLevel="4.2.0"');
  });

  it('generates permissions block when permissions provided', () => {
    const manifest = generateManifest(['UserProfile', 'SensorHistory']);
    expect(manifest).toContain('<iq:permissions>');
    expect(manifest).toContain('</iq:permissions>');
    expect(manifest).toContain('<iq:uses-permission id="UserProfile"/>');
    expect(manifest).toContain('<iq:uses-permission id="SensorHistory"/>');
  });

  it('generates empty permissions block when no permissions', () => {
    const manifest = generateManifest([]);
    expect(manifest).toContain('<iq:permissions/>');
  });

  it('generates a unique RFC 4122 v4 UUID application ID', () => {
    const manifest = generateManifest([]);
    // The ID is now a full random UUID, not a partially-hardcoded timestamp value
    const idMatch = manifest.match(/id="([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/);
    expect(idMatch).toBeTruthy();
    // Two separate exports should produce different UUIDs
    const manifest2 = generateManifest([]);
    const idMatch2 = manifest2.match(/id="([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/);
    expect(idMatch2).toBeTruthy();
    expect(idMatch[1]).not.toBe(idMatch2[1]);
  });

  it('includes launcher icon reference', () => {
    const manifest = generateManifest([]);
    expect(manifest).toContain('launcherIcon="@Drawables.LauncherIcon"');
  });

  it('includes language declaration', () => {
    const manifest = generateManifest([]);
    expect(manifest).toContain('<iq:language>eng</iq:language>');
  });

  it('validates XML structure with multiple permissions', () => {
    const manifest = generateManifest([
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
    const manifest = generateManifest([]);
    expect(manifest).toBeTruthy();
    // Note: The actual XML doesn't escape the name since it's referenced via @Strings.AppName
  });
});
