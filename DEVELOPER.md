# Developer Guide

Welcome! This guide helps new contributors understand the codebase, set up a development environment, and make changes confidently.

---

## Quick Start

### Prerequisites
- **Node.js 18+** — check with `node -v`
- **Garmin Connect IQ SDK 9.1.0+** — required only for testing exports; not needed for UI/backend work
- **VS Code** (optional, but recommended)

### Local Development

```powershell
# Install dependencies
npm install

# Start Electron app + Express backend
npm start

# (In another terminal) Run backend only for rapid iteration
npm run server

# Run all tests
npm test

# Watch mode (auto-run on file changes)
npm test:watch

# Generate coverage report
npm test:coverage
```

The app opens at `http://127.0.0.1:<random-port>` in an Electron window.

---

## Project Structure

```
WatchFace Builder/
│
├── electron/                    Electron main process + IPC bridge
│   ├── main.js                 Window lifecycle, menu, IPC handlers
│   └── preload.js              Secure IPC API exposed to renderer
│
├── builder/                     Frontend (canvas editor + UI, ~600 lines)
│   ├── index.html              HTML shell
│   ├── style.css               Dark theme, responsive layout
│   ├── app.js                  Main orchestrator (state, undo/redo, event handlers)
│   └── modules/                Reusable components
│       ├── canvas.js           390×390 round editor, drag/resize, safe area enforcement
│       ├── elements.js         Element data model, undo/redo history (10 steps)
│       ├── properties.js       Right-panel editor (font, color, position, visibility)
│       ├── export.js           POST design to /api/export, display build log
│       └── data-fields.js      Field definitions (extensible array)
│
├── lib/                         Backend utilities (Node.js)
│   ├── build.js                Orchestrates project generation + monkeyc compilation
│   ├── preview.js              Simulator lifecycle, monkeydo loading (fire-and-forget)
│   ├── design-store.js         Save/load/list designs from disk (JSON files)
│   ├── validation.js           Input validation, element schema checking
│   ├── naming.js               Safe filename generation, path traversal prevention
│   ├── logger.js               Structured logging with categories
│   ├── config.js               Detects SDK paths, dev key, temp dirs at startup
│   ├── simulator.js            Windows tasklist-based simulator detection
│   └── generators/             Code generation (Monkey C, manifest, jungle, etc.)
│       ├── manifest.js         Generate manifest.xml with dynamic permissions
│       ├── jungle.js           Generate monkey.jungle
│       ├── strings.js          Generate strings.xml
│       ├── monkeyc.js          Generate WatchFaceView.mc with draw calls
│       └── layout.js           Generate layout.xml (fallback structure)
│
├── garmin-project-template/    Reference template files (not directly used)
│   ├── manifest.xml            Template manifest structure
│   ├── monkey.jungle           Template jungle file
│   └── resources/              Template resources
│
├── __tests__/                   Jest unit tests
│   ├── build.test.js           Test build orchestration + error handling
│   ├── preview.test.js         Test simulator lifecycle
│   ├── design-store.test.js    Test design persistence + validation
│   ├── validation.test.js      Test input validation
│   ├── manifest.test.js        Test manifest generation
│   ├── monkeyc.test.js         Test Monkey C code generation
│   └── *.test.js               (other modules)
│
├── server.js                    Express routes (thin HTTP wrapper, 99 lines)
│   ├── POST /api/export        → buildProject() + saveDesign()
│   ├── POST /api/preview       → buildProject() + previewInSimulator()
│   ├── GET /api/designs        → listDesigns()
│   ├── GET /api/designs/:file  → loadDesign()
│   └── GET /                   → serve builder/ static files
│
├── README.md                    User guide (features, simulator, deploy)
├── CLAUDE.md                    AI assistant context (meta)
├── DEVELOPER.md                 This file
├── package.json
└── jest.config.js
```

---

## Architecture Overview

### Data Flow: Canvas → Export → Compilation

```
┌─ User adds element to canvas (builder/app.js)
│
└─→ Properties change (click, drag, edit panel)
    ↓
    canvas.js renders updated state
    ↓
    (No save to disk yet)
    ↓
┌─ User clicks "Export"
│
└─→ export.js serializes: { projectName, elements }
    ↓
    POST /api/export (server.js)
    ↓
    lib/build.js:
      1. Validate projectName and elements schema
      2. Check SDK paths (monkeyc, devKey)
      3. Generate files via lib/generators/*
         • manifest.xml (with required permissions)
         • monkey.jungle
         • strings.xml
         • WatchFaceView.mc (with dc.drawText() for each element)
         • layout.xml
      4. Execute: monkeyc -o WatchFace.prg -f monkey.jungle -y key.der -d vivoactive6
      5. Capture stdout/stderr as build log
      6. Save design.json with timestamp
    ↓
    Return: { success, log, prgPath, error? }
    ↓
    export.js displays log (green if success, red if error)
    ↓
    User clicks "Preview" (optional)
    ↓
    previewInSimulator():
      1. Check if simulator running (tasklist.exe on Windows)
      2. Launch if needed (detached process)
      3. Wait for readiness (8 seconds)
      4. Copy .prg to temp directory
      5. Execute: monkeydo WatchFace.prg vivoactive6
    ↓
    Simulator loads .prg and renders watch face
```

### Module Responsibilities

| Module | Responsibility | Key Files |
|--------|----------------|-----------|
| **builder/app.js** | Orchestrate UI state, undo/redo, routing | import all modules |
| **builder/canvas.js** | Render and edit canvas (drag, resize, safe area) | uses elements.js state |
| **builder/elements.js** | Element data model, history | {id, fieldId, x, y, width, height, zIndex, ...} |
| **builder/properties.js** | Right-panel editor for selected element | reads/writes elements.js state |
| **builder/data-fields.js** | Field definitions (extensible) | {id, label, icon, apiCall, ...} |
| **lib/build.js** | Orchestrate generation + compilation | calls generators/*, execFile(monkeyc) |
| **lib/generators/monkeyc.js** | Translate elements → Monkey C draw calls | reads element data, outputs code |
| **lib/design-store.js** | Persist/retrieve designs from disk | JSON files in designs/ directory |
| **lib/validation.js** | Check input schemas | element validation rules |
| **server.js** | HTTP routing only | calls build.js, preview.js, design-store.js |

---

## Common Tasks

### Task 1: Add a New Data Field

**Goal**: Add "Altitude" field to the builder.

#### Step 1: Define the field
Edit [builder/modules/data-fields.js](builder/modules/data-fields.js) — append to the array:

```javascript
{
  id: 'altitude',
  label: 'Altitude',
  icon: '⛰',
  apiCall: 'Activity.getAltitude()',
  defaultFont: 'FONT_MEDIUM',
  defaultColor: '#00CCFF',
  preview: '1234m'
}
```

**What each property means**:
- `id` — unique identifier (alphanumeric, camelCase)
- `label` — display name in palette
- `icon` — emoji or symbol
- `apiCall` — Toybox method to call at runtime (in onUpdate)
- `defaultFont` — Garmin font constant (FONT_XTINY, FONT_TINY, FONT_SMALL, FONT_MEDIUM, FONT_LARGE)
- `defaultColor` — hex color (converted to 0xRRGGBB by export.js)
- `preview` — sample text for canvas preview

#### Step 2: Declare required permissions
Edit [lib/generators/manifest.js](lib/generators/manifest.js) — add a case in the permission-checking logic:

```javascript
// Around line 45, in the permissions loop:
if (elements.some(e => e.fieldId === 'altitude')) {
  permissions.push('<iq:uses-permission id="Sensor"/>');
}
```

(Check the Garmin SDK docs for which permissions your API call needs.)

#### Step 3: Add code generation
Edit [lib/generators/monkeyc.js](lib/generators/monkeyc.js) — add a case for the new field:

```javascript
case 'altitude':
  return `
var alt = Activity.getAltitude();
var altStr = (alt == null) ? "--" : alt.toString();
dc.drawText(${x}, ${y}, font, altStr, color);`;
```

**Guidelines**:
- Always handle null/undefined (sensor data not available)
- Return a Monkey C code string (multi-line OK)
- Use the provided `${x}`, `${y}`, `font`, `color` variables

#### Step 4: Test

```bash
# Unit test the generator
npm test -- generators.test.js

# Manual test
npm start
# Add "Altitude" field to canvas
# Click "Export"
# Check the generated WatchFaceView.mc for your code
```

#### Step 5: Verify the .prg builds
```bash
npm start
# Add element → Click Export
# Check build log (should be green)
# If error, read compiler output — it's specific
```

---

### Task 2: Modify the Canvas Editor

**Goal**: Change the safe area from 370×370 to 360×360 pixels.

#### Where to edit
[builder/modules/canvas.js](builder/modules/canvas.js) — search for "SAFE_AREA" or "370":

```javascript
// Current (line ~40)
const SAFE_AREA_RADIUS = 185; // 370 / 2

// Change to:
const SAFE_AREA_RADIUS = 180; // 360 / 2
```

Also update the comment in [README.md](README.md):
```markdown
- **Safe area:** 360 px inner circle (15 px inset from the 390 px display edge).
```

#### Test
```bash
npm test -- canvas.test.js
npm start
# Drag element near edge → verify it clamps at new boundary
```

---

### Task 3: Add a New Properties Panel Option

**Goal**: Add a "Rotation" property for decorative elements.

#### Step 1: Update the element schema
Edit [lib/validation.js](lib/validation.js) — modify the validation rules:

```javascript
// In validateElements(), add:
if (el.rotation !== undefined && !Number.isInteger(el.rotation)) {
  throw new Error(`Element ${idx}: rotation must be an integer (degrees)`);
}
```

#### Step 2: Update the properties panel
Edit [builder/modules/properties.js](builder/modules/properties.js) — add an input:

```javascript
// Add a rotation slider in the properties form
rotation: {
  type: 'number',
  label: 'Rotation (degrees)',
  min: 0,
  max: 360,
  default: 0
}
```

#### Step 3: Pass to code generator
[lib/generators/monkeyc.js](lib/generators/monkeyc.js):

```javascript
// In the dc.drawText() call, add rotation via Graphics context:
if (element.rotation) {
  return `dc.setClip(...);\ndc.drawText(...);`; // Rotation requires clip context
}
```

#### Step 4: Test
```bash
npm test -- validation.test.js properties.test.js
npm start
# Select element → rotate via panel → export → verify .prg includes rotation
```

---

## Testing

### Test Strategy

**Goal**: Ensure reliability without running real monkeyc (slow, requires SDK).

#### What we test
✅ **Input validation** — reject invalid elements, project names  
✅ **Code generation** — manifest, jungle, monkeyc source  
✅ **File I/O** — save/load designs, handle corrupted JSON  
✅ **Error handling** — distinguish ENOENT, EACCES, SIGTERM, etc.  
✅ **Undo/redo** — history correctness  

#### What we mock
✅ **execFile()** — never run real monkeyc; mock success/error responses  
✅ **spawn()** — simulator detection/launch; use fake timers  
✅ **fs operations** — use temp directories, clean up after tests  

#### Running Tests

```bash
# Run all tests (no simulator, no SDK required)
npm test

# Run specific test file
npm test -- build.test.js

# Watch mode (re-run on file change)
npm test:watch

# Coverage report
npm test:coverage
```

#### Test File Structure

Example: [__tests__/design-store.test.js](__tests__/design-store.test.js)

```javascript
describe('Design Store', () => {
  // Group related tests
  describe('saveDesign()', () => {
    it('saves design to disk with timestamp', () => {
      // Arrange: set up inputs
      const design = { projectName: 'Test', elements: [] };
      
      // Act: call function
      const result = saveDesign(tmpDir, design);
      
      // Assert: verify output
      expect(result).toHaveProperty('filePath');
      expect(fs.existsSync(result.filePath)).toBe(true);
    });
    
    it('rejects invalid element structure', () => {
      // Test error paths, not just happy path
      expect(() => {
        saveDesign(tmpDir, { elements: [{ invalid: 'el' }] });
      }).toThrow('validation failed');
    });
  });
});
```

#### Coverage Expectations

| Module | Expected Coverage |
|--------|-------------------|
| lib/validation.js | >95% (core logic) |
| lib/build.js | >90% (includes error paths) |
| lib/generators/* | >85% (code generation) |
| builder/modules | >70% (DOM/UI is harder to test) |

---

## Code Review Practices

### Refactoring Expectations

When reviewing your own code or others' code, follow these guidelines (from [CLAUDE.md](CLAUDE.md)):

#### ✅ DO
- **Preserve existing behavior** unless explicitly approved for feature changes
- **Prefer small, reviewable edits** over large rewrites
- **Use clear, consistent names** (e.g., `validateElements()`, not `check()`)
- **Break long functions into helpers** when they exceed ~50 lines
- **Keep modules loosely coupled** (minimal cross-file dependencies)
- **Document non-obvious logic** with comments explaining WHY, not WHAT
- **Include assumptions and constraints** in function docstrings

#### ❌ DON'T
- **Add error handling for impossible cases** (trust framework guarantees)
- **Write defensive comments** like "// used by export flow" (that goes in git log)
- **Create premature abstractions** (wait for 3 similar uses)
- **Silently swallow errors** — log and propagate, or fail fast

### Error Handling Standard

When execFile or spawn fails, distinguish error types:

```javascript
if (err.code === 'ENOENT') {
  // Executable not found
  logError('build:monkeyc-not-found', { path });
  return `monkeyc not found at: ${path}\n...`;
} else if (err.code === 'EACCES') {
  // Permission denied
  logError('build:permission-denied', { path });
  return `Permission denied executing monkeyc at: ${path}\n...`;
} else if (err.signal === 'SIGTERM') {
  // Timeout
  logError('build:timeout', { signal });
  return `Build timed out after 60 seconds.\n...`;
} else {
  // Generic error with log details
  logError('build:failed', { code: err.code, message: err.message });
  return `Build failed: ${err.message}\nFull log:\n${log}`;
}
```

**Why**: Users can't diagnose "Build failed" — they need "monkeyc not found on PATH" to fix it.

### Documentation Standards

**Document these**:
- Public functions (exported from lib modules)
- Non-obvious algorithms or state transitions
- Assumptions (e.g., "assumes monkeyc on PATH")
- Side effects (file writes, network I/O)
- Error cases

**Don't document**:
- Obvious variable names (`elements` is clear)
- One-liners in simple functions
- Loop internals (write clearer code instead)

**Example good docstring**:
```javascript
/**
 * Wait for simulator to become ready (up to 20 seconds).
 * Polls tasklist.exe every second on Windows.
 * 
 * TODO: Implement cross-platform detection (macOS/Linux)
 * 
 * @param {Function} callback - Called when simulator is ready (or timeout)
 */
function waitForSimulator(callback) { ... }
```

---

## Troubleshooting

### Build Errors

#### Error: "monkeyc not found — Add SDK to PATH"
**Cause**: monkeyc.bat not on Windows PATH  
**Fix**: Add the SDK bin directory to PATH:
```powershell
$sdkBin = "C:\Users\...\AppData\Roaming\Garmin\ConnectIQ\Sdks\connectiq-sdk-win-9.1.0-...\bin"
[Environment]::SetEnvironmentVariable("PATH", $env:PATH + ";$sdkBin", "User")
# Restart terminal
monkeyc --version  # Should work now
```

#### Error: "Developer key not found"
**Cause**: No key at `~/.garmin/developer_key.der`  
**Fix**: Generate in VS Code:
```
Command Palette → "Monkey C: Generate Developer Key" → (save as developer_key.der)
```

#### Error: "Build timed out after 60 seconds"
**Cause**: monkeyc compilation is very slow (large project, slow disk)  
**Fix**:
- Check lib/build.js timeout (currently 60s on line 75)
- Increase if needed: `const timeout = 120000; // 120 seconds`
- Or simplify the watch face (fewer elements)

### Simulator Issues

#### Simulator won't launch
**Cause**: Simulator.exe not on PATH or not installed  
**Fix**:
1. Open VS Code
2. Command Palette → "Monkey C: Verify Installation"
3. If missing, reinstall Connect IQ SDK

#### .prg loads but shows blue triangle
**Cause**: Signature validation failed (bad developer key)  
**Fix**: Regenerate 4096-bit developer key:
```powershell
# In VS Code: Command Palette → "Monkey C: Generate Developer Key"
# Choose 4096-bit RSA (not 1024-bit)
```

### Test Failures

#### "Cannot log after tests are done"
**Cause**: setImmediate work scheduled in test continues after test completes  
**Fix**: Use `jest.useFakeTimers()` in beforeEach (see [__tests__/preview.test.js](__tests__/preview.test.js))

#### "TypeError: Cannot read property 'id' of undefined"
**Cause**: Test data missing required fields (id, fieldId, x, y, width, height)  
**Fix**: Use proper element schema in tests:
```javascript
const el = {
  id: 1,
  fieldId: 'hours',
  label: 'Hours',
  x: 100, y: 100,
  width: 50, height: 50,
  zIndex: 0
};
```

#### Test passes locally but fails in CI
**Cause**: Platform-specific code (Windows tasklist) not mocked  
**Fix**: Mock platform-specific functions; see [lib/simulator.js](lib/simulator.js) comments

---

## Performance Considerations

### Startup
- **Cold start**: ~2 seconds (Electron + Express initialization)
- **SDK detection**: ~1 second (scanning APPDATA for SDK directories)
- **Config cache**: Persisted in [lib/config.js](lib/config.js) to avoid repeated scans

### Canvas Rendering
- **Large element count**: 50+ elements → noticeable lag
- **Mitigation**: Canvas uses requestAnimationFrame; consider debouncing property updates if >100 elements needed

### Build Performance
- **Project generation**: <100ms (file writes, code generation)
- **monkeyc compilation**: 30–60 seconds (depends on SDK version, disk speed)
- **Bottleneck**: Always the monkeyc compiler, not our code

---

## Dependency Management

### Version Pinning Strategy

This project uses **tightened version ranges** to ensure reproducibility across machines and prevent silent breaking changes.

#### Version Ranges Explained

| Range | Example | Allows | Use Case |
|-------|---------|--------|----------|
| Exact | `4.22.2` | Only 4.22.2 | Critical runtime (express, electron-store, electron) |
| Tilde | `~7.11.2` | 7.11.x (patch updates) | Dev tools (jest, electron-forge) |
| Caret | `^4.22.2` | 4.x.x (minor + major) | ❌ Not used (too loose) |

#### Current Policy

**Dependencies** (runtime, pinned exactly):
```json
"electron-store": "9.0.0",    // Config storage — must be exact
"express": "~4.22.2"          // HTTP framework — patch updates OK
```

**DevDependencies** (build/test, tilde for patches):
```json
"electron": "42.3.0",                    // Desktop shell — exact
"electron-builder": "~26.8.1",          // Packaging tool — patches OK
"jest": "~29.7.0",                      // Test runner — patches OK
"@electron-forge/*": "~7.11.2"          // Build tools — patches OK
```

### Updating Dependencies Safely

#### For Patch Updates (e.g., 7.11.2 → 7.11.3)
```bash
npm update
# Allowed automatically (tilde range)
# Run: npm test
```

#### For Minor Updates (e.g., 4.22.x → 4.23.x)
```bash
npm install express@~4.23.0
# Manual: update package.json or use npm
# Then: npm test, npm start, manual testing
```

#### For Major Updates (e.g., 9.0.0 → 10.0.0)
```bash
# Creates a branch first!
git checkout -b deps/electron-store-10

# Install new version
npm install electron-store@latest

# Full testing required:
npm test
npm start
# Manual: export/preview flows

# If all pass: create PR for review
```

### `.npmrc` Configuration

This project includes `.npmrc` which:
- **`save-exact=true`** — `npm install --save pkg` adds exact versions
- **`package-lock=true`** — Always use package-lock.json
- **`audit=true`** — Report security issues on install

---

## Useful Resources

- **[README.md](README.md)** — User guide, deployment, troubleshooting
- **[CLAUDE.md](CLAUDE.md)** — AI assistant context; defines code review standards
- **Garmin SDK**: https://developer.garmin.com/connect-iq/sdk/
- **Monkey C Language**: https://developer.garmin.com/connect-iq/monkey-c/
- **Jest Testing**: https://jestjs.io/docs/getting-started
- **Semantic Versioning**: https://semver.org/

---

## Questions?

Open an issue with:
- What you were trying to do
- What went wrong
- Relevant error messages from logs (builder console, terminal)
- Steps to reproduce

Happy coding!
