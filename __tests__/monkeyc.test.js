const { colorLiteral, generateDataFetch, generateDrawCall, validateElement, validateGeneratorInputs, generateMonkeyC } = require('../lib/generators/monkeyc');

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

  // ─── generateMonkeyC integration ────────────────────────────────────────────
  // These tests call the full generator and inspect the assembled Monkey C output.
  // They catch assembly-level regressions that unit tests of sub-functions miss:
  //   - wrong / missing `using` imports
  //   - onPartialUpdate emitted for analog-only faces (the hardcoded-clock bug)
  //   - variables referenced in draw calls that were never fetched
  //   - missing lifecycle functions (initialize, onUpdate, onTick…)
  describe('generateMonkeyC integration', () => {
    // ── shared element fixtures ───────────────────────────────────────────────
    const mkEl = (overrides) => ({
      id: 1, fieldId: 'hours', label: 'Hours',
      x: 195, y: 160, width: 120, height: 60,
      font: 'FONT_NUMBER_HOT', color: '#FFFFFF', align: 'center',
      visibility: 'always', zIndex: 0, shapeType: null,
      ...overrides,
    });

    const analogHour   = mkEl({ id: 1, fieldId: 'analogHour',   label: 'Hour Hand',   shapeType: 'analogHour',   font: undefined, width: 80,  height: 6 });
    const analogMinute = mkEl({ id: 2, fieldId: 'analogMinute', label: 'Minute Hand', shapeType: 'analogMinute', font: undefined, width: 100, height: 4 });
    const analogSecond = mkEl({ id: 3, fieldId: 'analogSecond', label: 'Second Hand', shapeType: 'analogSecond', font: undefined, width: 110, height: 2, color: '#FF0000' });
    const hoursEl      = mkEl({ id: 1, fieldId: 'hours',    label: 'Hours',   x: 195, y: 155 });
    const minutesEl    = mkEl({ id: 2, fieldId: 'minutes',  label: 'Minutes', x: 195, y: 225, color: '#CCCCCC' });
    const secondsEl    = mkEl({ id: 3, fieldId: 'seconds',  label: 'Seconds', x: 195, y: 285, font: 'FONT_SMALL' });
    const heartRateEl  = mkEl({ id: 4, fieldId: 'heartRate', label: 'HR', x: 100, y: 310, font: 'FONT_SMALL', color: '#FF0000' });
    const stepsEl      = mkEl({ id: 5, fieldId: 'steps',    label: 'Steps', x: 290, y: 310, font: 'FONT_SMALL' });
    const bodyBattery  = mkEl({ id: 6, fieldId: 'bodyBattery', label: 'BB', x: 195, y: 340, font: 'FONT_SMALL' });
    const sunriseEl    = mkEl({ id: 7, fieldId: 'sunrise',  label: 'Sunrise', x: 70, y: 270, font: 'FONT_TINY' });

    // ── required boilerplate is always present ────────────────────────────────
    it('always emits the required class skeleton and lifecycle functions', () => {
      const out = generateMonkeyC([hoursEl]);
      expect(out).toContain('class WatchFaceView');
      expect(out).toContain('function initialize()');
      expect(out).toContain('function onLayout(dc)');
      expect(out).toContain('function onUpdate(dc)');
      expect(out).toContain('function onTick(');
      expect(out).toContain('function onHide()');
      expect(out).toContain('function onEnterSleep()');
      expect(out).toContain('function onExitSleep()');
    });

    it('always imports the core Toybox namespaces', () => {
      const out = generateMonkeyC([hoursEl]);
      expect(out).toContain('using Toybox.WatchUi');
      expect(out).toContain('using Toybox.Graphics');
      expect(out).toContain('using Toybox.System');
    });

    // ── pure analog face: no digital time → no onPartialUpdate ───────────────
    it('does NOT emit onPartialUpdate for a pure analog face', () => {
      const out = generateMonkeyC([analogHour, analogMinute, analogSecond]);
      expect(out).not.toContain('onPartialUpdate');
    });

    it('does NOT stamp a hardcoded digital clock over an analog face', () => {
      const out = generateMonkeyC([analogHour, analogMinute]);
      // The hardcoded-clock bug wrote H:MM:SS at (195,195) with FONT_NUMBER_HOT
      expect(out).not.toContain('FONT_NUMBER_HOT');
      expect(out).not.toContain('clockTime.hour.format("%02d") + ":"');
    });

    it('emits Math import for analog faces that need trig', () => {
      const out = generateMonkeyC([analogHour, analogMinute]);
      expect(out).toContain('using Toybox.Math');
    });

    // ── digital face: has time elements → onPartialUpdate mirrors the design ─
    it('emits onPartialUpdate for a digital face', () => {
      const out = generateMonkeyC([hoursEl, minutesEl]);
      expect(out).toContain('onPartialUpdate');
    });

    it('onPartialUpdate uses the element positions and fonts from the design, not hardcoded values', () => {
      const out = generateMonkeyC([hoursEl, minutesEl]);
      // Element positions: hoursEl at (195,155), minutesEl at (195,225)
      // The partial update must reference those positions — not a single hardcoded (195,195)
      expect(out).toContain('155');  // hoursEl.y
      expect(out).toContain('225');  // minutesEl.y
      // And it draws each element's time expression correctly
      expect(out).toContain('clockTime.hour.format');
      expect(out).toContain('clockTime.min.format');
    });

    it('onPartialUpdate element color is taken from the design, not hardcoded white', () => {
      // minutesEl has color #CCCCCC — should appear in the partial update, not 0xFFFFFF
      const out = generateMonkeyC([hoursEl, minutesEl]);
      expect(out).toContain('0xCCCCCC'); // minutesEl color in partial update
    });

    it('onPartialUpdate includes seconds element when seconds field is in the design', () => {
      const out = generateMonkeyC([hoursEl, minutesEl, secondsEl]);
      expect(out).toContain('clockTime.sec.format');
    });

    it('onPartialUpdate is omitted when only non-time elements are present alongside analog hands', () => {
      const out = generateMonkeyC([analogHour, analogMinute, stepsEl]);
      expect(out).not.toContain('onPartialUpdate');
    });

    // ── using import selection ────────────────────────────────────────────────
    it('imports Activity when heart rate field is present', () => {
      const out = generateMonkeyC([hoursEl, heartRateEl]);
      expect(out).toContain('using Toybox.Activity');
      expect(out).toContain('Activity.getActivityInfo()');
    });

    it('does NOT import Activity when no heart rate field is present', () => {
      const out = generateMonkeyC([hoursEl, stepsEl]);
      // 'using Toybox.Activity as Activity' is distinct from ActivityMonitor — check the full alias
      expect(out).not.toContain('using Toybox.Activity as Activity');
    });

    it('imports ActivityMonitor when steps field is present', () => {
      const out = generateMonkeyC([hoursEl, stepsEl]);
      expect(out).toContain('using Toybox.ActivityMonitor');
      expect(out).toContain('ActivityMonitor.getInfo()');
    });

    it('imports SensorHistory when bodyBattery field is present', () => {
      const out = generateMonkeyC([hoursEl, bodyBattery]);
      expect(out).toContain('using Toybox.SensorHistory');
    });

    it('imports Positioning and emits sun-calc method when sunrise field is present', () => {
      const out = generateMonkeyC([hoursEl, sunriseEl]);
      // Garmin's location module is Toybox.Position (not Toybox.Positioning)
      expect(out).toContain('using Toybox.Position');
      expect(out).toContain('calcSunTimeMin');
    });

    it('does NOT import unused namespaces for a minimal digital face', () => {
      const out = generateMonkeyC([hoursEl, minutesEl]);
      expect(out).not.toContain('using Toybox.Activity as Activity');    // heart rate
      expect(out).not.toContain('using Toybox.ActivityMonitor');          // steps/calories
      expect(out).not.toContain('using Toybox.SensorHistory');            // body battery etc.
      expect(out).not.toContain('using Toybox.Position');                 // solar/weather
    });

    // ── data-fetch deduplication ──────────────────────────────────────────────
    it('deduplicates data fetches when two elements share the same fieldId', () => {
      // Two heart-rate elements (e.g. in different positions) should not duplicate _ai fetch
      const hr1 = { ...heartRateEl, id: 10, x: 80, y: 300 };
      const hr2 = { ...heartRateEl, id: 11, x: 310, y: 300 };
      const out = generateMonkeyC([hoursEl, hr1, hr2]);
      const fetchCount = (out.match(/Activity\.getActivityInfo\(\)/g) || []).length;
      expect(fetchCount).toBe(1);
    });

    // ── draw calls reference only declared variables ──────────────────────────
    it('draw call for heartRate references the variable declared by the data fetch', () => {
      const out = generateMonkeyC([hoursEl, heartRateEl]);
      // Data fetch declares: var heartRate = ...
      // Draw call must use that variable, not an undeclared one
      expect(out).toMatch(/var heartRate\s*=/);
      expect(out).toContain('heartRate');
    });

    it('draw call for steps references the variable declared by the data fetch', () => {
      const out = generateMonkeyC([hoursEl, stepsEl]);
      expect(out).toMatch(/var steps\s*=/);
    });

    // ── empty design ─────────────────────────────────────────────────────────
    it('generates valid skeleton output for an empty elements array', () => {
      const out = generateMonkeyC([]);
      expect(out).toContain('class WatchFaceView');
      expect(out).toContain('function onUpdate(dc)');
      expect(out).not.toContain('onPartialUpdate');
      expect(out).not.toContain('undefined');
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
