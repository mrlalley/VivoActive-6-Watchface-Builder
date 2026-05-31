// Regression tests for naming collision fix.
// Verifies that validateProjectName() and safePrgName() now enforce the same
// 30-character limit to prevent silent truncation and false collision errors.

const { validateProjectName } = require('../lib/validation');
const { safePrgName, PRG_NAME_MAX_LENGTH } = require('../lib/naming');

describe('naming collision regression', () => {
  describe('PRG_NAME_MAX_LENGTH constant', () => {
    test('is exported and equals 30', () => {
      expect(PRG_NAME_MAX_LENGTH).toBe(30);
    });
  });

  describe('validation and truncation alignment', () => {
    test('name at limit (30 chars) passes validation', () => {
      const name = 'a'.repeat(30);
      expect(() => validateProjectName(name)).not.toThrow();
    });

    test('name exceeding limit (31 chars) throws validation error', () => {
      const name = 'a'.repeat(31);
      expect(() => validateProjectName(name)).toThrow();
    });

    test('safePrgName preserves names within limit', () => {
      const name = 'MyWatchFace';
      expect(safePrgName(name)).toBe(name);
    });

    test('safePrgName truncates names exceeding limit', () => {
      const name = 'a'.repeat(40);
      expect(safePrgName(name).length).toBe(30);
    });
  });

  describe('collision scenario (prevented)', () => {
    test('two names identical within 30 chars are blocked at validation', () => {
      // Old bug: these would both pass validation, then safePrgName would truncate
      // both to the same 30-char prefix, causing a collision.
      const name1 = 'MyWatchFace' + 'a'.repeat(20); // 31 chars total
      const name2 = 'MyWatchFace' + 'b'.repeat(20); // 31 chars total

      // Both should now fail validation
      expect(() => validateProjectName(name1)).toThrow(/30 characters or fewer/);
      expect(() => validateProjectName(name2)).toThrow(/30 characters or fewer/);
    });

    test('two distinct names at exactly 30 chars may produce identical filenames after sanitization', () => {
      // If both names are exactly 30 chars and share the same prefix, they will
      // have identical sanitized output (since safePrgName won't truncate anything).
      const name1 = 'WatchFaceWithVerySpecificNam1'; // 30 chars exactly
      const name2 = 'WatchFaceWithVerySpecificNam2'; // 30 chars exactly, differs only at position 30

      // Both pass validation (at limit)
      expect(() => validateProjectName(name1)).not.toThrow();
      expect(() => validateProjectName(name2)).not.toThrow();

      // But they are different names
      expect(name1).not.toBe(name2);

      // After sanitization, they should still be different
      // (because safePrgName preserves the final char since we're at limit)
      expect(safePrgName(name1)).not.toBe(safePrgName(name2));
    });

    test('character sanitization + truncation are idempotent', () => {
      const name = 'My Watch Face With Spaces';
      const sanitized1 = safePrgName(name);
      const sanitized2 = safePrgName(sanitized1);
      expect(sanitized1).toBe(sanitized2);
    });
  });

  describe('validation error message references the limit', () => {
    test('error message mentions 30 characters', () => {
      const name = 'a'.repeat(31);
      try {
        validateProjectName(name);
        fail('should have thrown');
      } catch (e) {
        expect(e.message).toMatch(/30/);
      }
    });

    test('error message explains the .prg device constraint', () => {
      const name = 'a'.repeat(31);
      try {
        validateProjectName(name);
        fail('should have thrown');
      } catch (e) {
        expect(e.message).toMatch(/\.prg/i);
      }
    });
  });
});
