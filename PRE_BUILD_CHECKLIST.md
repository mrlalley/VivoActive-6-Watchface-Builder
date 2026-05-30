# Pre-Build Checklist for Windows Packaging

## Icon Assets
- [ ] `assets/icon.ico` exists and is NOT 68 bytes
  - Test: `ls -l assets/icon.ico` should show >10KB
  - If broken: Download or create a 256x256 PNG, convert to .ico, replace

- [ ] `assets/icon.png` exists (optional, but good to have)

## Code Review
- [ ] `electron/main.js` does NOT open DevTools in production
  - Check: Line ~46 checks `if (process.env.ELECTRON_IS_DEV)`
  - DevTools blocked in production? ✓

- [ ] No hardcoded NODE_ENV or ELECTRON_IS_DEV in source code
  - `grep -r "NODE_ENV=production\|ELECTRON_IS_DEV=false" --include="*.js" .`
  - Should return NOTHING

- [ ] IPC handlers properly error-caught
  - Look for try/catch in `electron/main.js` IPC listeners

## Configuration Files
- [ ] `forge.config.js` exists with BOTH maker-squirrel AND maker-zip
  - `grep "maker-squirrel\|maker-zip" forge.config.js`

- [ ] `package.json` has `"build": "electron-forge make"` script
  - `grep '"build":' package.json`

## Dependencies
- [ ] `node_modules/` up to date
  - Run: `npm install` (should be fast if already installed)

## Environment
- [ ] `.env` file is NOT in repository
  - `ls -a | grep "^\.env"` should return nothing

- [ ] No ELECTRON_IS_DEV environment variable set in PowerShell
  - Run: `$env:ELECTRON_IS_DEV` should be empty

## File Cleanliness
- [ ] Previous build artifacts removed
  - Run: `Remove-Item -Recurse -Force out/,dist/ -ErrorAction SilentlyContinue`

- [ ] No stale log files in project root
  - `rm -f *.log`

## Final Check
- [ ] App runs in development mode
  - Run: `npm start` → window opens → no console errors
  - Kill with Ctrl+C

✅ All checks passed? Proceed to build!
