const { saveDesign, listDesigns, loadDesign } = require('../lib/design-store');
const fs = require('fs');
const path = require('path');

describe('Design Store Module', () => {
  const testDir = path.join(__dirname, 'test-designs');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('saveDesign', () => {
    it('creates directory if it does not exist', () => {
      expect(fs.existsSync(testDir)).toBe(false);
      saveDesign(testDir, 'TestFace', []);
      expect(fs.existsSync(testDir)).toBe(true);
    });

    it('saves design with correct structure', () => {
      const result = saveDesign(testDir, 'TestFace', []);
      expect(result.success).toBe(true);
      expect(result.projectName).toBe('TestFace');
      expect(result.elementCount).toBe(0);
      expect(result.filePath).toContain('TestFace');
    });

    it('rejects empty projectName', () => {
      expect(() => saveDesign(testDir, '', [])).toThrow();
    });

    it('rejects invalid elements', () => {
      expect(() => saveDesign(testDir, 'TestFace', [{ invalid: 'elem' }])).toThrow();
    });
  });

  describe('listDesigns', () => {
    it('returns empty array when directory does not exist', () => {
      const designs = listDesigns(testDir);
      expect(designs).toEqual([]);
    });

    it('returns saved designs', () => {
      saveDesign(testDir, 'Face1', []);
      saveDesign(testDir, 'Face2', []);
      const designs = listDesigns(testDir);
      expect(designs).toHaveLength(2);
      expect(designs.map(d => d.name)).toContain('Face1');
      expect(designs.map(d => d.name)).toContain('Face2');
    });

    it('includes metadata for each design', () => {
      saveDesign(testDir, 'TestFace', []);
      const designs = listDesigns(testDir);
      expect(designs[0]).toHaveProperty('name');
      expect(designs[0]).toHaveProperty('file');
      expect(designs[0]).toHaveProperty('savedAt');
      expect(designs[0]).toHaveProperty('elementCount');
    });
  });

  describe('loadDesign', () => {
    it('loads a saved design', () => {
      const elem = {
        id: 1,
        fieldId: 'hours',
        label: 'Hours',
        x: 100,
        y: 100,
        width: 50,
        height: 50,
        zIndex: 0
      };
      saveDesign(testDir, 'TestFace', [elem]);
      const design = loadDesign(testDir, 'TestFace.json');
      expect(design.projectName).toBe('TestFace');
      expect(design.elements[0].id).toBe(1);
      expect(design.elements[0].fieldId).toBe('hours');
    });

    it('throws on missing file', () => {
      expect(() => loadDesign(testDir, 'nonexistent.json')).toThrow();
    });

    it('sanitizes filename to prevent path traversal', () => {
      // Should reject paths with ..
      expect(() => loadDesign(testDir, '../../../etc/passwd')).toThrow();
    });
  });

  describe('loadDesign validation', () => {
    it('rejects corrupted JSON', () => {
      // Create a file with invalid JSON
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'corrupted.json'), '{invalid json');

      expect(() => loadDesign(testDir, 'corrupted.json')).toThrow('corrupted');
    });

    it('rejects non-object JSON', () => {
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'array.json'), '[]');

      expect(() => loadDesign(testDir, 'array.json')).toThrow('not an object');
    });

    it('rejects non-array elements field', () => {
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'bad-elements.json'), JSON.stringify({
        projectName: 'Test',
        elements: 'not-an-array'
      }));

      expect(() => loadDesign(testDir, 'bad-elements.json')).toThrow('must be an array');
    });

    it('rejects invalid element structure', () => {
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'bad-elem.json'), JSON.stringify({
        projectName: 'Test',
        elements: [{ id: 'not-number' }]
      }));

      expect(() => loadDesign(testDir, 'bad-elem.json')).toThrow('Invalid design elements');
    });

    it('rejects negative nextId', () => {
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'bad-nextid.json'), JSON.stringify({
        projectName: 'Test',
        elements: [],
        nextId: -1
      }));

      expect(() => loadDesign(testDir, 'bad-nextid.json')).toThrow('Invalid nextId');
    });

    it('accepts valid design with proper structure', () => {
      saveDesign(testDir, 'ValidFace', []);
      const design = loadDesign(testDir, 'ValidFace.json');
      expect(design.projectName).toBe('ValidFace');
      expect(Array.isArray(design.elements)).toBe(true);
    });
  });
});
