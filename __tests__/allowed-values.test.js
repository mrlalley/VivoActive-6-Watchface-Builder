// __tests__/allowed-values.test.js
//
// Regression tests for the shared allowlist module.
//
// These tests guard against the three-file allowlist drift that was identified
// in the technical review:
//
//   lib/validation.js, builder/modules/elements.js, and lib/generators/monkeyc.js
//   previously declared independent copies of the same allowlists, with a manual
//   sync comment as the only enforcement. This test suite enforces the contract
//   automatically.
//
// ADDING A NEW SHAPE/FONT:
//   1. Add it to builder/modules/data-fields.js (the authoritative schema)
//   2. Add it to lib/allowed-values.js
//   3. These tests confirm the value is present in the shared module and that
//      all three call sites use the shared module.
//
// Reference: lib/validation.js; builder/modules/elements.js;
//            lib/generators/monkeyc.js

'use strict';

const {
  VALID_FONTS,
  VALID_SHAPE_TYPES,
  VALID_ALIGNS,
  VALID_VISIBILITY,
} = require('../lib/allowed-values');

const fs = require('fs');
const path = require('path');

// ── Allowlist completeness ───────────────────────────────────────────────

describe('VALID_FONTS completeness', () => {
  const EXPECTED_FONTS = [
    'FONT_XTINY',
    'FONT_TINY',
    'FONT_SMALL',
    'FONT_MEDIUM',
    'FONT_LARGE',
    'FONT_NUMBER_MILD',
    'FONT_NUMBER_MEDIUM',
    'FONT_NUMBER_HOT',
    'FONT_NUMBER_THAI_HOT',
  ];

  test('exports an array', () => {
    expect(Array.isArray(VALID_FONTS)).toBe(true);
  });

  test('contains all expected font names', () => {
    EXPECTED_FONTS.forEach(font => {
      expect(VALID_FONTS).toContain(font);
    });
  });

  test('has no duplicate entries', () => {
    const unique = [...new Set(VALID_FONTS)];
    expect(VALID_FONTS.length).toBe(unique.length);
  });

  test('contains only non-empty strings', () => {
    VALID_FONTS.forEach(v => {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    });
  });

  test('is frozen to prevent accidental mutation', () => {
    expect(Object.isFrozen(VALID_FONTS)).toBe(true);
  });
});

describe('VALID_SHAPE_TYPES completeness', () => {
  const EXPECTED_SHAPES = [
    'circle',
    'line',
    'arc',
    'tickHour',
    'tickMinute',
    'tickMixed',
    'tickDots',
    'analogHour',
    'analogMinute',
    'analogSecond',
    'analogCenter',
    'btIcon',
    'moonPhase',
    'hrGraph',
  ];

  test('exports an array', () => {
    expect(Array.isArray(VALID_SHAPE_TYPES)).toBe(true);
  });

  test('contains all expected shape types', () => {
    EXPECTED_SHAPES.forEach(shape => {
      expect(VALID_SHAPE_TYPES).toContain(shape);
    });
  });

  test('has no duplicate entries', () => {
    const unique = [...new Set(VALID_SHAPE_TYPES)];
    expect(VALID_SHAPE_TYPES.length).toBe(unique.length);
  });

  test('contains only non-empty strings', () => {
    VALID_SHAPE_TYPES.forEach(v => {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    });
  });

  test('is frozen to prevent accidental mutation', () => {
    expect(Object.isFrozen(VALID_SHAPE_TYPES)).toBe(true);
  });
});

describe('VALID_ALIGNS completeness', () => {
  const EXPECTED_ALIGNS = ['left', 'center', 'right'];

  test('exports an array', () => {
    expect(Array.isArray(VALID_ALIGNS)).toBe(true);
  });

  test('contains all expected align values', () => {
    EXPECTED_ALIGNS.forEach(align => {
      expect(VALID_ALIGNS).toContain(align);
    });
  });

  test('has no duplicate entries', () => {
    const unique = [...new Set(VALID_ALIGNS)];
    expect(VALID_ALIGNS.length).toBe(unique.length);
  });

  test('is frozen to prevent accidental mutation', () => {
    expect(Object.isFrozen(VALID_ALIGNS)).toBe(true);
  });
});

describe('VALID_VISIBILITY completeness', () => {
  const EXPECTED_VISIBILITY = ['always', 'awake', 'sleep'];

  test('exports an array', () => {
    expect(Array.isArray(VALID_VISIBILITY)).toBe(true);
  });

  test('contains all expected visibility values', () => {
    EXPECTED_VISIBILITY.forEach(visibility => {
      expect(VALID_VISIBILITY).toContain(visibility);
    });
  });

  test('has no duplicate entries', () => {
    const unique = [...new Set(VALID_VISIBILITY)];
    expect(VALID_VISIBILITY.length).toBe(unique.length);
  });

  test('is frozen to prevent accidental mutation', () => {
    expect(Object.isFrozen(VALID_VISIBILITY)).toBe(true);
  });
});

// ── Drift detection — call sites use the shared module ────────────────

describe('Call sites import from shared module, not local copies', () => {

  const CALL_SITES = [
    {
      label: 'lib/validation.js',
      file:  path.resolve(__dirname, '../lib/validation.js'),
    },
    {
      label: 'builder/modules/elements.js',
      file:  path.resolve(__dirname, '../builder/modules/elements.js'),
    },
    {
      label: 'lib/generators/monkeyc.js',
      file:  path.resolve(__dirname, '../lib/generators/monkeyc.js'),
    },
  ];

  CALL_SITES.forEach(({ label, file }) => {
    describe(`${label}`, () => {
      test('imports from shared module (allowed-values or validation)', () => {
        const source = fs.readFileSync(file, 'utf8');
        const hasSharedImport =
          source.includes('allowed-values') ||  // Direct import
          source.includes('require(\'../validation\')'); // monkeyc.js imports VALID_FONTS from validation

        expect(hasSharedImport).toBe(true);
      });

      test('does not contain the manual sync comment', () => {
        const source = fs.readFileSync(file, 'utf8');
        // The sync comment was evidence of the old manual contract.
        // Its presence after this fix means the refactor was incomplete.
        expect(source).not.toMatch(
          /Must stay in sync with/i
        );
      });

      // For elements.js, verify it no longer has the old local declarations
      if (label === 'builder/modules/elements.js') {
        test('does not have old-style hardcoded IMPORT_ constants', () => {
          const source = fs.readFileSync(file, 'utf8');
          // Old pattern: const IMPORT_VALID_FONTS = new Set([...])
          // Should not exist anymore
          expect(source).not.toMatch(
            /const\s+IMPORT_VALID_FONTS\s*=\s*new\s+Set\s*\(\s*\[\s*'FONT_XTINY'/
          );
        });
      }
    });
  });
});

// ── Documentation test for divergence findings ────────────────────────

describe('Phase 1 divergence findings', () => {
  test('SHAPE_TYPES are now validated by lib/validation.js (was missing)', () => {
    // This was one of the active bugs found in Phase 1:
    // validation.js did not have VALID_SHAPE_TYPES, only elements.js and monkeyc.js did.
    // Now all three import from the shared module.
    const validationSource = fs.readFileSync(
      path.resolve(__dirname, '../lib/validation.js'),
      'utf8'
    );
    expect(validationSource).toMatch(/VALID_SHAPE_TYPES/);
  });

  test('ALIGNS are now exported by lib/allowed-values.js', () => {
    // This was another divergence: IMPORT_VALID_ALIGNS was only in elements.js,
    // not in validation.js or monkeyc.js.
    // Now all have access to it via the shared module.
    expect(VALID_ALIGNS).toBeDefined();
    expect(VALID_ALIGNS.length).toBeGreaterThan(0);
  });

  test('VISIBILITY is now in the shared module', () => {
    // validation.js had hardcoded validVisibility; elements.js had IMPORT_VALID_VISIBILITY.
    // Now both use the shared VALID_VISIBILITY from allowed-values.js.
    expect(VALID_VISIBILITY).toBeDefined();
    expect(VALID_VISIBILITY.length).toBeGreaterThan(0);
  });

  test('all three call sites are in sync via shared module import', () => {
    // The whole point: prove that all three files can now use the same source.
    const validationSource = fs.readFileSync(
      path.resolve(__dirname, '../lib/validation.js'),
      'utf8'
    );
    const elementsSource = fs.readFileSync(
      path.resolve(__dirname, '../builder/modules/elements.js'),
      'utf8'
    );
    const monkeycsource = fs.readFileSync(
      path.resolve(__dirname, '../lib/generators/monkeyc.js'),
      'utf8'
    );

    // All should reference the shared module
    expect(validationSource).toMatch(/allowed-values/);
    expect(elementsSource).toMatch(/allowed-values/);
    expect(monkeycsource).toMatch(/allowed-values/);
  });
});
