# Smoke Tests for Packaged App

This document describes the automated smoke tests executed in the GitHub Actions CI workflow after building packaged artifacts.

## Overview

Smoke tests verify that packaged executables **launch successfully** and **initialize correctly** without crashing immediately. These are minimal, fast tests designed to catch obvious build failures before release.

---

## What Gets Tested

Each platform runs a platform-specific smoke test immediately after `npm run make`:

| Platform | Test | Purpose | Timeout |
|----------|------|---------|---------|
| **Windows** | PowerShell launch via Start-Process | Verify .exe launches and doesn't crash | 8 seconds |
| **macOS** | `open` command with app bundle | Verify .app launches and doesn't crash | 10 seconds |
| **Linux** | xvfb-run headless launch | Verify binary launches in virtual display | 10 seconds |

---

## Test Details

### Windows Smoke Test

**Location**: `.github/workflows/build.yml` → `Smoke test - Windows (Launch app)`

**Steps**:
1. Find the .exe file in `dist-final/` (excluding Setup installers)
2. Launch with PowerShell `Start-Process`
3. Wait 8 seconds
4. Check if process exited abnormally
5. If still running, terminate gracefully

**Success Criteria**:
- ✅ .exe file exists and is readable
- ✅ App launches without immediate crash
- ✅ No error exit codes (0 or running after 8s)

**Failure Scenarios**:
- ❌ Executable not found
- ❌ App crashes immediately (exit code ≠ 0)
- ❌ Electron initialization fails

---

### macOS Smoke Test

**Location**: `.github/workflows/build.yml` → `Smoke test - macOS (Launch app)`

**Steps**:
1. Find the .app bundle in `dist-final/`
2. Launch via `open` command (native macOS app launcher)
3. Wait 8 seconds for initialization
4. Terminate via `pkill` if still running
5. Verify process can be found and killed

**Success Criteria**:
- ✅ .app bundle exists and is readable
- ✅ App launches via `open` command
- ✅ Process spawns and can be terminated

**Failure Scenarios**:
- ❌ App bundle not found
- ❌ `open` command fails (bad bundle structure)
- ❌ Process crashes before timeout

---

### Linux Smoke Test

**Location**: `.github/workflows/build.yml` → `Smoke test - Linux (Launch app)`

**Steps**:
1. Install xvfb (virtual X display) for headless testing
2. Find the .deb file in `dist-final/`
3. Install package via `dpkg`
4. Launch binary with `xvfb-run` (provides virtual X11 display)
5. Wait 10 seconds for initialization
6. Verify user config directory was created (sign of successful init)

**Success Criteria**:
- ✅ .deb package exists and is readable
- ✅ Package installs without errors
- ✅ Binary runs in virtual display environment
- ✅ App creates `~/.config/WatchFace Builder/` directory

**Failure Scenarios**:
- ❌ .deb file not found
- ❌ Package installation fails (missing deps, conflicts)
- ❌ Binary crashes in virtual display
- ❌ App fails to initialize (missing preload, CSP errors, etc.)

---

## Why These Tests?

### Coverage
- **Quick validation** that packaged app is usable (not corrupted binaries, missing resources, bad ASAR)
- **Cross-platform proof** that packaging works on all three supported operating systems
- **Early failure detection** catches issues before release (breaking main.js changes, missing preload, etc.)

### Limitations
- **Headless only**: No full UI testing (can't verify window contents, buttons, etc.)
- **Short duration**: 8-10 seconds is enough to detect startup crashes but not thorough feature testing
- **No IPC testing**: Don't call renderer methods; only verify app launches
- **No network**: Server may not start within timeout (that's OK for MVP)

### Not Tested
- ❌ Full renderer initialization
- ❌ IPC round-trips (get-session-token, settings, etc.)
- ❌ Server health check
- ❌ Design save/load
- ❌ Build or preview functionality

These are reserved for **manual smoke testing** after release or **post-MVP integration tests**.

---

## Running Smoke Tests Locally

To simulate the CI smoke tests on your machine:

### Windows
```powershell
# Launch the portable executable
.\dist-final\WatchFace\ Builder\ 1.0.0.exe
# Wait ~8 seconds, observe if it launches and doesn't crash
# Close the window when done
```

### macOS
```bash
# Launch the app bundle
open dist-final/WatchFace\ Builder-1.0.0.app
# Wait ~8 seconds, observe app window
# Close the app when done
```

### Linux
```bash
# Install the package
sudo dpkg -i dist-final/watchface-builder_1.0.0.deb

# Launch the binary (with or without xvfb)
watchface-builder

# Or with virtual display (if no X11):
xvfb-run -a watchface-builder
```

---

## Interpreting CI Results

### ✅ All Smoke Tests Pass
- Packaged app is buildable and launches successfully on all platforms
- Ready to publish to GitHub Releases
- Safe to tag as release candidate

### ❌ Smoke Test Fails on One Platform
- Investigate platform-specific issue (e.g., missing dependencies on Linux)
- Check logs for crash messages, missing files, CSP errors
- Fix root cause and rebuild

### ❌ Smoke Test Fails on All Platforms
- Breaking change in main.js or preload.js
- Missing or corrupted resource file (index.html, icon, etc.)
- ASAR archive corruption
- Build process issue

---

## Example CI Output

**Windows Success**:
```
Launching: C:\actions-runner\_work\watchface-builder\watchface-builder\dist-final\WatchFace Builder 1.0.0.exe
App still running - terminating
✅ Smoke test passed
```

**Linux Success**:
```
Installing: /home/runner/work/watchface-builder/watchface-builder/dist-final/watchface-builder_1.0.0.deb
Launching app via xvfb (virtual display)
✅ App created user config directory
✅ Smoke test passed
```

**Failure Example**:
```
App exited with code: 127
Write-Error "App crashed immediately"
At line:1 char:1
❌ Smoke test failed
```

---

## Future Enhancements

**Post-MVP smoke test improvements**:
1. **IPC validation**: Call `get-session-token` and verify preload initialized
2. **Health check**: POST to /health endpoint (if server starts in time)
3. **Artifact inspection**: Verify ASAR structure, check for required files
4. **Performance baseline**: Record startup time to detect regressions
5. **Log parsing**: Grep for ERROR/FATAL in startup logs and fail if found

---

## Maintenance

### When to Update Smoke Tests

- **Platform dependency changes**: If we drop Linux support or add Windows ARM64
- **Startup requirements change**: If app now requires SDK or dev key to initialize
- **Timeout tuning**: If startup takes longer (increase timeout, but investigate why first)
- **New test requirements**: Post-MVP feature testing (IPC, health, etc.)

### Disabled or Skipped Tests

If a smoke test is failing due to environment issues (e.g., xvfb not available on a custom runner), add `continue-on-error: true` to the step and file a follow-up issue.

**Current status**: All three platform tests are **required to pass** for CI success.

---

