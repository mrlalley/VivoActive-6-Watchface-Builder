const {
  validateProjectName,
  validateColor,
  validateElement,
  validateElements,
  SAFE_AREA_MIN,
  SAFE_AREA_MAX,
} = require('../lib/validation');

describe('Validation', () => {
  describe('validateProjectName', () => {
    it('accepts valid project names', () => {
      expect(validateProjectName('MyWatchFace')).toBe(true);
      expect(validateProjectName('Face2024')).toBe(true);
      expect(validateProjectName('a')).toBe(true);
    });

    it('rejects empty strings', () => {
      expect(() => validateProjectName('')).toThrow('non-empty string');
      expect(() => validateProjectName('   ')).toThrow('non-empty string');
    });

    it('rejects non-strings', () => {
      expect(() => validateProjectName(123)).toThrow('non-empty string');
      expect(() => validateProjectName(null)).toThrow('non-empty string');
    });

    it('rejects names over 100 characters', () => {
      const longName = 'a'.repeat(101);
      expect(() => validateProjectName(longName)).toThrow('100 characters or less');
    });

    it('accepts 100 character names', () => {
      const name100 = 'a'.repeat(100);
      expect(validateProjectName(name100)).toBe(true);
    });
  });

  describe('validateColor', () => {
    it('accepts valid hex colors', () => {
      expect(validateColor('#FFFFFF')).toBe(true);
      expect(validateColor('#000000')).toBe(true);
      expect(validateColor('#FF00FF')).toBe(true);
      expect(validateColor('#ffffff')).toBe(true);
      expect(validateColor('#AbCdEf')).toBe(true);
    });

    it('rejects invalid hex colors', () => {
      expect(() => validateColor('FFFFFF')).toThrow('invalid color format');
      expect(() => validateColor('#FFF')).toThrow('invalid color format');
      expect(() => validateColor('#FFFFFFFF')).toThrow('invalid color format');
      expect(() => validateColor('#GGGGGG')).toThrow('invalid color format');
      expect(() => validateColor('rgb(255,255,255)')).toThrow('invalid color format');
    });

    it('rejects non-strings', () => {
      expect(() => validateColor(0xFFFFFF)).toThrow('must be a string');
      expect(() => validateColor(null)).toThrow('must be a string');
    });

    it('accepts all uppercase hex', () => {
      expect(validateColor('#ABCDEF')).toBe(true);
    });

    it('accepts all lowercase hex', () => {
      expect(validateColor('#abcdef')).toBe(true);
    });

    it('accepts black (#000000)', () => {
      expect(validateColor('#000000')).toBe(true);
    });

    it('accepts all single-digit variations', () => {
      expect(validateColor('#000001')).toBe(true);
      expect(validateColor('#00000F')).toBe(true);
      expect(validateColor('#0000F0')).toBe(true);
    });

    it('rejects colors with spaces', () => {
      expect(() => validateColor('# FFFFFF')).toThrow('invalid color format');
      expect(() => validateColor('#FFFFFF ')).toThrow('invalid color format');
    });

    it('rejects 3-digit CSS shorthand', () => {
      expect(() => validateColor('#FFF')).toThrow('invalid color format');
      expect(() => validateColor('#000')).toThrow('invalid color format');
    });

    it('rejects 4-digit colors', () => {
      expect(() => validateColor('#FF00')).toThrow('invalid color format');
      expect(() => validateColor('#ABCD')).toThrow('invalid color format');
    });

    it('rejects 8-digit RGBA colors', () => {
      expect(() => validateColor('#FFFFFFFF')).toThrow('invalid color format');
      expect(() => validateColor('#00000000')).toThrow('invalid color format');
    });
  });

  describe('validateElement', () => {
    const validElement = {
      id: 1,
      fieldId: 'hours',
      label: 'Hours',
      x: 100,
      y: 100,
      width: 50,
      height: 50,
      font: 'FONT_MEDIUM',
      color: '#FFFFFF',
      visibility: 'always',
      zIndex: 0,
    };

    it('accepts valid elements', () => {
      expect(validateElement(validElement, 0)).toBe(true);
    });

    it('validates id field', () => {
      const bad = { ...validElement, id: -1 };
      expect(() => validateElement(bad, 0)).toThrow('element[0].id');

      const notNumber = { ...validElement, id: 'one' };
      expect(() => validateElement(notNumber, 0)).toThrow('element[0].id');
    });

    it('validates fieldId field', () => {
      const bad = { ...validElement, fieldId: 'invalidFieldId' };
      expect(() => validateElement(bad, 0)).toThrow('element[0].fieldId: unknown field ID');
    });

    it('validates label field', () => {
      const bad = { ...validElement, label: 123 };
      expect(() => validateElement(bad, 0)).toThrow('element[0].label: must be a string');
    });

    it('validates position bounds', () => {
      const badX = { ...validElement, x: SAFE_AREA_MIN - 1 };
      expect(() => validateElement(badX, 0)).toThrow('element[0].x: must be between');

      const badY = { ...validElement, y: SAFE_AREA_MAX + 1 };
      expect(() => validateElement(badY, 0)).toThrow('element[0].y: must be between');
    });

    it('validates dimensions', () => {
      const badWidth = { ...validElement, width: 0 };
      expect(() => validateElement(badWidth, 0)).toThrow('element[0].width: must be a positive number');

      const badHeight = { ...validElement, height: 401 };
      expect(() => validateElement(badHeight, 0)).toThrow('element[0].height: must be a positive number');
    });

    it('validates font field', () => {
      const badFont = { ...validElement, font: 'INVALID_FONT' };
      expect(() => validateElement(badFont, 0)).toThrow('element[0].font: invalid font');
    });

    it('validates color field', () => {
      const badColor = { ...validElement, color: 'red' };
      expect(() => validateElement(badColor, 0)).toThrow('invalid color format');
    });

    it('validates visibility field', () => {
      const badVis = { ...validElement, visibility: 'never' };
      expect(() => validateElement(badVis, 0)).toThrow('element[0].visibility');
    });

    it('validates zIndex field', () => {
      const badZ = { ...validElement, zIndex: -1 };
      expect(() => validateElement(badZ, 0)).toThrow('element[0].zIndex');
    });

    it('allows optional fields', () => {
      const minimal = {
        id: 1,
        fieldId: 'hours',
        label: 'Hours',
        x: 100,
        y: 100,
        width: 50,
        height: 50,
        zIndex: 0,
      };
      expect(validateElement(minimal, 0)).toBe(true);
    });
  });

  describe('validateElements', () => {
    const validElement = {
      id: 1,
      fieldId: 'hours',
      label: 'Hours',
      x: 100,
      y: 100,
      width: 50,
      height: 50,
      zIndex: 0,
    };

    it('accepts valid arrays', () => {
      expect(validateElements([validElement])).toBe(true);
      expect(validateElements([])).toBe(true);
    });

    it('rejects non-arrays', () => {
      expect(() => validateElements({})).toThrow('elements must be an array');
      expect(() => validateElements('array')).toThrow('elements must be an array');
    });

    it('rejects arrays with > 200 elements', () => {
      const elements = Array.from({ length: 201 }, (_, i) => ({
        ...validElement,
        id: i,
      }));
      expect(() => validateElements(elements)).toThrow('too many elements: max 200');
    });

    it('validates each element', () => {
      const elements = [validElement, { ...validElement, id: 'bad' }];
      expect(() => validateElements(elements)).toThrow('element[1].id');
    });

    it('allows empty array', () => {
      expect(validateElements([])).toBe(true);
    });
  });
});
