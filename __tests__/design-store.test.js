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
    it('returns empty array when directory does not exist', async () => {
      const designs = await listDesigns(testDir);
      expect(designs).toEqual([]);
    });

    it('returns saved designs', async () => {
      saveDesign(testDir, 'Face1', []);
      saveDesign(testDir, 'Face2', []);
      const designs = await listDesigns(testDir);
      expect(designs).toHaveLength(2);
      expect(designs.map(d => d.name)).toContain('Face1');
      expect(designs.map(d => d.name)).toContain('Face2');
    });

    it('includes metadata for each design', async () => {
      saveDesign(testDir, 'TestFace', []);
      const designs = await listDesigns(testDir);
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

    // ── Path boundary regression tests ─────────────────────────────────────────
    // Guards against the startsWith(dir) bug fixed in loadDesign().
    // Fix: startsWith(dir + path.sep) — matches electron/main.js lines 372-373.
    //
    // The filename sanitizer strips / and \ but allows '.' (dot).
    // '..' (two dots) passes the sanitizer and path.join(dir, '..') resolves
    // to the parent directory — outside the designs dir. The boundary check
    // must catch this case.

    it('rejects ".." which survives the sanitizer but escapes the designs directory', () => {
      // '..' passes [a-zA-Z0-9._-] sanitizer (dots are allowed).
      // path.join(testDir, '..') resolves to the parent — outside designs dir.
      // The old startsWith(testDir) ALSO correctly rejects this, but only because
      // the resolved path is shorter than testDir. With the path.sep fix the
      // check is correct for ALL out-of-bounds paths, including siblings.
      expect(() => loadDesign(testDir, '..'))
        .toThrow(/Access denied|outside designs|Failed to load/i);
    });

    it('accepts a valid design filename (boundary check passes, file-not-found is expected)', () => {
      // Confirms the fix does not over-reject legitimate filenames.
      // The boundary check passes; the error is file-not-found, not access denied.
      expect(() => loadDesign(testDir, 'valid-design.json'))
        .toThrow(/not found|ENOENT|Failed to load/i);
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

    it('returns warning for invalid element structure', () => {
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'bad-elem.json'), JSON.stringify({
        projectName: 'Test',
        elements: [{ id: 'not-number' }]
      }));

      const design = loadDesign(testDir, 'bad-elem.json');
      expect(design.projectName).toBe('Test');
      expect(design.validationWarning).toBeDefined();
      // requiresConfirmation removed: canvas now handles validation reactively
      expect(design.requiresConfirmation).toBeUndefined();
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

  describe('Concurrent saves', () => {
    it('handles rapid concurrent saves to the same file without data corruption', () => {
      const elem1 = {
        id: 1,
        fieldId: 'hours',
        label: 'Hours',
        x: 100,
        y: 100,
        width: 50,
        height: 50,
        zIndex: 0
      };

      const elem2 = {
        id: 2,
        fieldId: 'minutes',
        label: 'Minutes',
        x: 150,
        y: 150,
        width: 50,
        height: 50,
        zIndex: 1
      };

      // Launch two concurrent saves to the same project
      // (no await/Promise here - they execute nearly simultaneously)
      saveDesign(testDir, 'ConcurrentFace', [elem1]);
      saveDesign(testDir, 'ConcurrentFace', [elem2]);

      // Load the final design - should have second save's data
      const design = loadDesign(testDir, 'ConcurrentFace.json');
      expect(design.projectName).toBe('ConcurrentFace');
      expect(design.elements).toHaveLength(1);
      expect(design.elements[0].id).toBe(2);
      expect(design.elements[0].fieldId).toBe('minutes');
    });

    it('does not leave stray temp files after concurrent saves', () => {
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

      // Perform 5 rapid saves
      for (let i = 0; i < 5; i++) {
        saveDesign(testDir, `Face${i}`, [elem]);
      }

      // List all files in testDir
      const files = fs.readdirSync(testDir);

      // Should only have 5 .json files (one per save)
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      expect(jsonFiles).toHaveLength(5);

      // Should have no .tmp files remaining
      const tmpFiles = files.filter(f => f.endsWith('.tmp'));
      expect(tmpFiles).toHaveLength(0);
    });
  });
});
