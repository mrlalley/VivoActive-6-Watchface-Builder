'use strict';

const { validateBackground } = require('../lib/validation');
const { ValidationError } = require('../lib/errors');

describe('validateBackground()', () => {
  test('null is valid (no background)', () => {
    expect(validateBackground(null)).toBe(true);
  });

  test('undefined is valid (absent field — old designs)', () => {
    expect(validateBackground(undefined)).toBe(true);
  });

  test('valid bundled descriptor passes', () => {
    expect(validateBackground({ source: 'bundled', assetId: 'analog-dress-gold' })).toBe(true);
  });

  test('assetId with uppercase letters is rejected', () => {
    expect(() => validateBackground({ source: 'bundled', assetId: 'Analog-Dress' }))
      .toThrow(ValidationError);
  });

  test('assetId with dot is rejected', () => {
    expect(() => validateBackground({ source: 'bundled', assetId: 'analog.dress' }))
      .toThrow(ValidationError);
  });

  test('assetId with forward slash is rejected', () => {
    expect(() => validateBackground({ source: 'bundled', assetId: 'folder/name' }))
      .toThrow(ValidationError);
  });

  test('assetId with backslash is rejected', () => {
    expect(() => validateBackground({ source: 'bundled', assetId: 'folder\\name' }))
      .toThrow(ValidationError);
  });

  test('assetId with space is rejected', () => {
    expect(() => validateBackground({ source: 'bundled', assetId: 'analog dress' }))
      .toThrow(ValidationError);
  });

  test('assetId exceeding 64 chars is rejected', () => {
    const long = 'a' + '-x'.repeat(33); // 67 chars
    expect(() => validateBackground({ source: 'bundled', assetId: long }))
      .toThrow(ValidationError);
  });

  test('source "custom" passes (Phase 2 — user-imported images)', () => {
    expect(validateBackground({ source: 'custom', assetId: 'custom-abc123' })).toBe(true);
  });

  test('source "unknown" is rejected', () => {
    expect(() => validateBackground({ source: 'unknown', assetId: 'analog-dress-gold' }))
      .toThrow(ValidationError);
  });

  test('missing assetId is rejected', () => {
    expect(() => validateBackground({ source: 'bundled' }))
      .toThrow(ValidationError);
  });

  test('non-object background is rejected', () => {
    expect(() => validateBackground('analog-dress-gold'))
      .toThrow(ValidationError);
    expect(() => validateBackground(42))
      .toThrow(ValidationError);
  });

  test('array is rejected', () => {
    expect(() => validateBackground(['analog-dress-gold']))
      .toThrow(ValidationError);
  });

  test('valid assetId with numbers and dashes passes', () => {
    expect(validateBackground({ source: 'bundled', assetId: 'dial-001-v2' })).toBe(true);
  });

  test('single character assetId is rejected (too short)', () => {
    expect(() => validateBackground({ source: 'bundled', assetId: 'a' }))
      .toThrow(ValidationError);
  });
});

describe('validateBackground() — AOD field', () => {
  test('absent aod field is valid', () => {
    expect(validateBackground({ source: 'bundled', assetId: 'analog-dress-gold' })).toBe(true);
  });

  test('null aod field is valid', () => {
    expect(validateBackground({ source: 'bundled', assetId: 'analog-dress-gold', aod: null })).toBe(true);
  });

  test('aod.variant "dimmed" is valid', () => {
    expect(validateBackground({ source: 'bundled', assetId: 'analog-dress-gold', aod: { variant: 'dimmed' } })).toBe(true);
  });

  test('aod.variant "none" is valid', () => {
    expect(validateBackground({ source: 'bundled', assetId: 'analog-dress-gold', aod: { variant: 'none' } })).toBe(true);
  });

  test('aod.variant "separate" is rejected (not yet supported)', () => {
    expect(() => validateBackground({ source: 'bundled', assetId: 'analog-dress-gold', aod: { variant: 'separate' } }))
      .toThrow(ValidationError);
  });

  test('aod.variant "unknown" is rejected', () => {
    expect(() => validateBackground({ source: 'bundled', assetId: 'analog-dress-gold', aod: { variant: 'unknown' } }))
      .toThrow(ValidationError);
  });

  test('aod as a non-object (string) is rejected', () => {
    expect(() => validateBackground({ source: 'bundled', assetId: 'analog-dress-gold', aod: 'dimmed' }))
      .toThrow(ValidationError);
  });

  test('aod as array is rejected', () => {
    expect(() => validateBackground({ source: 'bundled', assetId: 'analog-dress-gold', aod: ['dimmed'] }))
      .toThrow(ValidationError);
  });
});
