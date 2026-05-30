const {
  validateProjectName,
  validateColor,
  validateElement,
  validateElements,
  CANVAS_SIZE,
  CANVAS_CENTER,
  SAFE_AREA_RADIUS,
  isWithinSafeCircle,
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

    it('validates position bounds (canvas limits)', () => {
      const outOfBoundsX = { ...validElement, x: -1 };
      expect(() => validateElement(outOfBoundsX, 0)).toThrow('element[0].x: must be between 0');

      const outOfBoundsY = { ...validElement, y: CANVAS_SIZE + 1 };
      expect(() => validateElement(outOfBoundsY, 0)).toThrow('element[0].y: must be between 0');
    });

    it('validates circular boundary (elements in corners fail)', () => {
      // Element in corner (380, 380) with 20x20 extends beyond circular boundary
      const cornerElement = { ...validElement, x: 370, y: 370, width: 20, height: 20 };
      expect(() => validateElement(cornerElement, 0)).toThrow('extends outside the safe display area');
    });

    it('allows elements at canvas center', () => {
      // Element centered at canvas middle should pass
      const centered = { ...validElement, x: 170, y: 170, width: 50, height: 50 };
      expect(validateElement(centered, 0)).toBe(true);
    });

    it('allows elements near cardinal edges (within safe circle)', () => {
      // Top edge (within safe radius)
      const topElement = { ...validElement, x: 170, y: 15, width: 50, height: 30 };
      expect(validateElement(topElement, 0)).toBe(true);

      // Right edge (within safe radius)
      const rightElement = { ...validElement, x: 340, y: 170, width: 30, height: 50 };
      expect(validateElement(rightElement, 0)).toBe(true);
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

  describe('isWithinSafeCircle', () => {
    it('accepts elements at canvas center', () => {
      // Center of canvas with 50x50 element
      expect(isWithinSafeCircle(170, 170, 50, 50)).toBe(true);
    });

    it('accepts elements at cardinal edges (within radius)', () => {
      // Top: center x, near top edge
      expect(isWithinSafeCircle(170, 20, 50, 30)).toBe(true);

      // Bottom: center x, near bottom edge
      expect(isWithinSafeCircle(170, 340, 50, 30)).toBe(true);

      // Left: near left edge, center y
      expect(isWithinSafeCircle(20, 170, 30, 50)).toBe(true);

      // Right: near right edge, center y
      expect(isWithinSafeCircle(340, 170, 30, 50)).toBe(true);
    });

    it('rejects elements in corners (extend beyond safe radius)', () => {
      // Top-left corner
      expect(isWithinSafeCircle(10, 10, 30, 30)).toBe(false);

      // Top-right corner
      expect(isWithinSafeCircle(350, 10, 30, 30)).toBe(false);

      // Bottom-left corner
      expect(isWithinSafeCircle(10, 350, 30, 30)).toBe(false);

      // Bottom-right corner
      expect(isWithinSafeCircle(350, 350, 30, 30)).toBe(false);
    });

    it('accepts small elements anywhere within safe area', () => {
      // Tiny 1x1 element at corner should still fail (it's at the corner)
      expect(isWithinSafeCircle(10, 10, 1, 1)).toBe(false);

      // But small element near center should pass
      expect(isWithinSafeCircle(190, 190, 10, 10)).toBe(true);
    });

    it('rejects elements where any corner exceeds safe radius', () => {
      // Element partially in corner: x in bounds but corners exceed circle
      expect(isWithinSafeCircle(365, 170, 30, 50)).toBe(false);
    });
  });
});
