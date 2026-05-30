const { colorLiteral, generateDataFetch, generateDrawCall, validateElement, validateGeneratorInputs } = require('../lib/generators/monkeyc');

describe('Monkey C Generator', () => {
  describe('colorLiteral', () => {
    it('converts hex colors to 0x format', () => {
      expect(colorLiteral('#FFFFFF')).toBe('0xFFFFFF');
      expect(colorLiteral('#000000')).toBe('0x000000');
      expect(colorLiteral('#FF0000')).toBe('0xFF0000');
      expect(colorLiteral('#00FF00')).toBe('0x00FF00');
      expect(colorLiteral('#0000FF')).toBe('0x0000FF');
    });

    it('handles lowercase hex', () => {
      expect(colorLiteral('#ffffff')).toBe('0xFFFFFF');
      expect(colorLiteral('#abcdef')).toBe('0xABCDEF');
    });

    it('handles mixed case hex', () => {
      expect(colorLiteral('#AbCdEf')).toBe('0xABCDEF');
    });

    it('defaults to white for null/undefined', () => {
      expect(colorLiteral(null)).toBe('0xFFFFFF');
      expect(colorLiteral(undefined)).toBe('0xFFFFFF');
    });

    it('pads short hex values', () => {
      expect(colorLiteral('#FFF')).toBe('0x000FFF');
      expect(colorLiteral('#F')).toBe('0x00000F');
    });

    it('handles edge case colors (min/max valid)', () => {
      expect(colorLiteral('#000000')).toBe('0x000000'); // Black
      expect(colorLiteral('#FFFFFF')).toBe('0xFFFFFF'); // White
    });

    it('preserves color precision for all hex combinations', () => {
      expect(colorLiteral('#123456')).toBe('0x123456');
      expect(colorLiteral('#ABCDEF')).toBe('0xABCDEF');
      expect(colorLiteral('#abcdef')).toBe('0xABCDEF');
    });

    it('is case-insensitive and normalizes to uppercase', () => {
      const red1 = colorLiteral('#ff0000');
      const red2 = colorLiteral('#FF0000');
      const red3 = colorLiteral('#Ff0000');
      expect(red1).toBe(red2);
      expect(red2).toBe(red3);
      expect(red1).toBe('0xFF0000');
    });
  });

  describe('generateDataFetch', () => {
    it('generates fetch code for supported field types', () => {
      const el = { fieldId: 'hours' };
      const result = generateDataFetch(el);
      expect(result).toBeNull(); // hours doesn't need data fetch

      const el2 = { fieldId: 'heartRate' };
      const result2 = generateDataFetch(el2);
      expect(result2).toContain('heartRate');
      expect(result2).toContain('currentHeartRate');
    });

    it('returns null for unsupported field types', () => {
      const el = { fieldId: 'unknownField' };
      expect(generateDataFetch(el)).toBeNull();
    });

    it('generates steps fetch code', () => {
      const el = { fieldId: 'steps' };
      const result = generateDataFetch(el);
      expect(result).toContain('var steps');
      expect(result).toContain('_ami.steps');
    });

    it('generates battery fetch code', () => {
      const el = { fieldId: 'battery' };
      const result = generateDataFetch(el);
      expect(result).toContain('var battery');
      expect(result).toContain('Sys.getSystemStats()');
    });

    it('generates moon phase calculation', () => {
      const el = { fieldId: 'moonPhase' };
      const result = generateDataFetch(el);
      expect(result).toContain('_jdM');
      expect(result).toContain('_phs');
    });

    it('generates sunrise/sunset code with solar calculations', () => {
      const el = { fieldId: 'sunrise' };
      const result = generateDataFetch(el);
      expect(result).toContain('sunriseTime');
      expect(result).toContain('_srMin');
    });
  });

  describe('generateDrawCall', () => {
    const baseElement = {
      id: 1,
      fieldId: 'hours',
      label: 'Hours',
      x: 100,
      y: 100,
      width: 50,
      height: 50,
      font: 'FONT_MEDIUM',
      color: '#FFFFFF',
      align: 'center',
      zIndex: 0,
    };

    it('generates drawText call for time fields', () => {
      const el = { ...baseElement, fieldId: 'hours' };
      const result = generateDrawCall(el);
      expect(result).toContain('dc.drawText');
      expect(result).toContain('clockTime.hour.format');
      expect(result).toContain('0xFFFFFF');
      expect(result).toContain('Gfx.FONT_MEDIUM');
    });

    it('generates drawCircle for circle shapes', () => {
      const el = { ...baseElement, shapeType: 'circle' };
      const result = generateDrawCall(el);
      expect(result).toContain('dc.drawCircle');
      expect(result).toContain('100');
      expect(result).not.toContain('dc.drawText');
    });

    it('generates drawLine for line shapes', () => {
      const el = { ...baseElement, shapeType: 'line', width: 50 };
      const result = generateDrawCall(el);
      expect(result).toContain('dc.drawLine');
      expect(result).not.toContain('dc.drawText');
    });

    it('generates code for Bluetooth icon', () => {
      const el = { ...baseElement, shapeType: 'btIcon' };
      const result = generateDrawCall(el);
      expect(result).toContain('phoneConnected');
      expect(result).toContain('dc.fillCircle');
    });

    it('generates code for moon phase graphic', () => {
      const el = { ...baseElement, shapeType: 'moonPhase' };
      const result = generateDrawCall(el);
      expect(result).toContain('_phs');
      expect(result).toContain('dc.fillCircle');
    });

    it('applies text alignment', () => {
      const left = { ...baseElement, align: 'left' };
      const result = generateDrawCall(left);
      expect(result).toContain('TEXT_JUSTIFY_LEFT');

      const right = { ...baseElement, align: 'right' };
      const result2 = generateDrawCall(right);
      expect(result2).toContain('TEXT_JUSTIFY_RIGHT');
    });

    it('uses custom label for custom text fields', () => {
      const el = { ...baseElement, fieldId: 'customLabel', format: 'Custom Text' };
      const result = generateDrawCall(el);
      expect(result).toContain('Custom Text');
    });

    it('escapes quotes in custom labels', () => {
      const el = { ...baseElement, fieldId: 'customLabel', format: 'Say "Hello"' };
      const result = generateDrawCall(el);
      expect(result).toContain('Say \\"Hello\\"');
    });

    it('escapes backslashes in custom labels before escaping quotes', () => {
      const el = { ...baseElement, fieldId: 'customLabel', format: 'C:\\Users\\name' };
      const result = generateDrawCall(el);
      // Each \ becomes \\ in the output
      expect(result).toContain('C:\\\\Users\\\\name');
    });

    it('collapses newlines in custom labels to spaces', () => {
      const el = { ...baseElement, fieldId: 'customLabel', format: 'line1\nline2' };
      const result = generateDrawCall(el);
      expect(result).toContain('line1 line2');
      // The raw newline must not appear inside the generated string literal
      expect(result).not.toContain('"line1\nline2"');
    });

    it('generates analog hand code', () => {
      const el = { ...baseElement, shapeType: 'analogHour', width: 75, height: 15 };
      const result = generateDrawCall(el);
      expect(result).toContain('clockTime.hour');
      expect(result).toContain('Math.cos');
      expect(result).toContain('dc.drawLine');
    });

    it('generates tick mark code', () => {
      const el = { ...baseElement, shapeType: 'tickHour', width: 182, height: 14 };
      const result = generateDrawCall(el);
      expect(result).toContain('for (var _i');
      expect(result).toContain('Math.PI');
      expect(result).toContain('dc.drawLine');
    });
  });

  describe('validateElement', () => {
    const valid = {
      id: 1, fieldId: 'hours', label: 'Hours',
      x: 100, y: 100, width: 50, height: 50,
      font: 'FONT_MEDIUM', color: '#FFFFFF',
      align: 'center', zIndex: 0, shapeType: null,
    };

    it('accepts a fully valid text element', () => {
      expect(() => validateElement(valid, 0)).not.toThrow();
    });

    it('accepts a valid shape element without font', () => {
      expect(() => validateElement({ ...valid, shapeType: 'circle', font: undefined }, 0)).not.toThrow();
    });

    it('rejects missing fieldId', () => {
      expect(() => validateElement({ ...valid, fieldId: '' }, 0))
        .toThrow('element[0].fieldId');
    });

    it('rejects fieldId with hyphen (not a valid identifier)', () => {
      expect(() => validateElement({ ...valid, fieldId: 'heart-rate' }, 0))
        .toThrow('element[0].fieldId');
    });

    it('rejects fieldId with spaces', () => {
      expect(() => validateElement({ ...valid, fieldId: 'heart rate' }, 0))
        .toThrow('element[0].fieldId');
    });

    it('rejects unknown shapeType', () => {
      expect(() => validateElement({ ...valid, shapeType: 'rectangle' }, 0))
        .toThrow('element[0].shapeType');
    });

    it('rejects unknown font for text elements', () => {
      expect(() => validateElement({ ...valid, font: 'FONT_HUGE' }, 0))
        .toThrow('element[0].font');
    });

    it('allows unknown font for shape elements (font is unused)', () => {
      expect(() => validateElement({ ...valid, shapeType: 'circle', font: 'FONT_HUGE' }, 0))
        .not.toThrow();
    });

    it('rejects invalid color (no hash)', () => {
      expect(() => validateElement({ ...valid, color: 'FFFFFF' }, 0))
        .toThrow('element[0].color');
    });

    it('rejects invalid color (3-digit shorthand)', () => {
      expect(() => validateElement({ ...valid, color: '#FFF' }, 0))
        .toThrow('element[0].color');
    });

    it('rejects NaN x coordinate', () => {
      expect(() => validateElement({ ...valid, x: NaN }, 0))
        .toThrow('element[0].x');
    });

    it('rejects Infinity height', () => {
      expect(() => validateElement({ ...valid, height: Infinity }, 0))
        .toThrow('element[0].height');
    });

    it('includes the element index in the error message', () => {
      expect(() => validateElement({ ...valid, font: 'BAD_FONT' }, 5))
        .toThrow('element[5]');
    });

    it('accepts all valid Garmin fonts', () => {
      const fonts = [
        'FONT_XTINY', 'FONT_TINY', 'FONT_SMALL', 'FONT_MEDIUM', 'FONT_LARGE',
        'FONT_NUMBER_MILD', 'FONT_NUMBER_MEDIUM', 'FONT_NUMBER_HOT', 'FONT_NUMBER_THAI_HOT',
      ];
      fonts.forEach(font => {
        expect(() => validateElement({ ...valid, font }, 0)).not.toThrow();
      });
    });
  });

  describe('validateGeneratorInputs', () => {
    const validEl = {
      id: 1, fieldId: 'hours', label: 'Hours',
      x: 100, y: 100, width: 50, height: 50,
      font: 'FONT_MEDIUM', color: '#FFFFFF',
      align: 'center', zIndex: 0, shapeType: null,
    };

    it('accepts an empty array', () => {
      expect(() => validateGeneratorInputs([])).not.toThrow();
    });

    it('accepts an array of valid elements', () => {
      expect(() => validateGeneratorInputs([validEl, { ...validEl, id: 2 }])).not.toThrow();
    });

    it('rejects non-array input', () => {
      expect(() => validateGeneratorInputs(null)).toThrow('elements must be an array');
      expect(() => validateGeneratorInputs({})).toThrow('elements must be an array');
    });

    it('rejects array containing an invalid element', () => {
      const bad = { ...validEl, color: 'not-a-color' };
      expect(() => validateGeneratorInputs([validEl, bad])).toThrow('element[1].color');
    });

    it('reports the correct index for the failing element', () => {
      const els = [validEl, { ...validEl, id: 2 }, { ...validEl, id: 3, font: 'BOGUS' }];
      expect(() => validateGeneratorInputs(els)).toThrow('element[2]');
    });
  });
});
