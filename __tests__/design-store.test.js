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
      saveDesign(testDir, 'TestFace', [{ id: 'test' }]);
      const design = loadDesign(testDir, 'TestFace.json');
      expect(design.projectName).toBe('TestFace');
      expect(design.elements).toEqual([{ id: 'test' }]);
    });

    it('throws on missing file', () => {
      expect(() => loadDesign(testDir, 'nonexistent.json')).toThrow();
    });

    it('sanitizes filename to prevent path traversal', () => {
      // Should reject paths with ..
      expect(() => loadDesign(testDir, '../../../etc/passwd')).toThrow();
    });
  });
});
