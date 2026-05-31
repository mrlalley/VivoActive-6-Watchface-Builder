# Code Signing Configuration for GitHub Actions

This document explains how to configure code signing certificates and credentials for automated builds via GitHub Actions.

## Overview

The CI/CD workflow (`.github/workflows/build.yml`) supports code signing on all three platforms:
- **Windows**: Signtool.exe with `.pfx` certificate
- **macOS**: Codesign with `.p12` certificate and notarization
- **Linux**: GPG signing (optional; deferred to post-MVP)

All credentials are stored as GitHub Secrets and injected at build time — **never committed to the repository**.

---

## Windows Code Signing

### Prerequisites
1. Obtain a **code signing certificate** (`.pfx` file) from a trusted CA
   - EV (Extended Validation) certificates recommended for publisher trust
   - Or use a self-signed certificate for internal/development builds
   
2. Certificate must contain:
   - Private key (used by Signtool.exe)
   - Subject CN matching your publisher name

### Setup in GitHub

#### Step 1: Convert certificate to base64

```powershell
# On your local machine (NOT in the repo)
$certPath = "C:\path\to\certificate.pfx"
$base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($certPath))
$base64 | Set-Clipboard
```

#### Step 2: Create GitHub Secrets

Go to **Settings → Secrets and variables → Actions → New repository secret**:

1. **Secret Name**: `WIN_CSC_LINK`  
   **Value**: The base64-encoded `.pfx` file (paste from clipboard)

2. **Secret Name**: `WIN_CSC_KEY_PASSWORD`  
   **Value**: The password for the `.pfx` certificate (if password-protected)

### Activation in Workflow

Uncomment in `.github/workflows/build.yml` under the **Build application** step:

```yaml
WIN_CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
```

---

## macOS Code Signing & Notarization

### Prerequisites
1. Apple Developer account with signing certificates
2. Obtain a **development or distribution certificate** (`.p12` file)
3. Create an **App Password** for notarization (not your regular Apple ID password)

### Setup in GitHub

#### Step 1: Export certificate to base64

```bash
# On your local machine (NOT in the repo)
openssl base64 < certificate.p12 | tr -d '\n' | pbcopy
```

#### Step 2: Create GitHub Secrets

Go to **Settings → Secrets and variables → Actions → New repository secret**:

1. **Secret Name**: `MAC_CSC_LINK`  
   **Value**: The base64-encoded `.p12` file

2. **Secret Name**: `MAC_CSC_KEY_PASSWORD`  
   **Value**: The password for the `.p12` certificate

3. **Secret Name**: `APPLE_ID`  
   **Value**: Your Apple ID email address

4. **Secret Name**: `APPLE_ID_PASSWORD`  
   **Value**: Your App-specific password (NOT your main Apple ID password)

### Activation in Workflow

Uncomment in `.github/workflows/build.yml` under the **Build application** step:

```yaml
MAC_CSC_LINK: ${{ secrets.MAC_CSC_LINK }}
MAC_CSC_KEY_PASSWORD: ${{ secrets.MAC_CSC_KEY_PASSWORD }}
APPLE_ID: ${{ secrets.APPLE_ID }}
APPLE_ID_PASSWORD: ${{ secrets.APPLE_ID_PASSWORD }}
```

---

## Linux (GPG Signing)

**Deferred to post-MVP**. For now, Linux builds are unsigned. Plan for future:
1. Generate GPG key: `gpg --gen-key`
2. Export public key and distribute via package repositories
3. Wire GPG_SIGN_KEY and passphrase as secrets

---

## Testing Unsigned Builds

The workflow supports unsigned builds by default:
1. Code signing secrets are **optional**
2. If secrets are not set, electron-builder produces unsigned artifacts
3. This is suitable for internal/development releases

**Test unsigned builds**:
1. Push a tag (e.g., `git tag v1.0.0-test && git push origin v1.0.0-test`)
2. Workflow triggers automatically
3. Artifacts appear in GitHub Release without signatures

---

## Artifact Locations in GitHub Release

Once the workflow completes, artifacts are published to the GitHub Release:

| Platform | Artifact | Size | Notes |
|----------|----------|------|-------|
| Windows | `WatchFaceBuilder-1.0.0.exe` | ~100M | Signed if WIN_CSC_LINK is set |
| macOS | `WatchFaceBuilder-1.0.0.dmg` | ~150M | Signed & notarized if MAC_CSC_LINK is set |
| Linux | `watchface-builder_1.0.0.deb` | ~80M | Unsigned (GPG optional) |

---

## Security Best Practices

1. **Never commit certificates or passwords** — Use GitHub Secrets exclusively
2. **Rotate credentials regularly** — Change passphrases annually
3. **Restrict secret access** — Only workflows that need them should read them
4. **Use app-specific passwords** — Never use your main Apple ID password
5. **Audit secret usage** — Check GitHub Actions run logs for secret leakage
6. **Monitor releases** — Review artifacts before publishing to users

---

## Troubleshooting

### "Signing tool not found" (Windows)
- Check that Signtool.exe is in PATH on Windows runner
- electron-builder assumes Signtool.exe is installed (part of Windows SDK)
- Verify with: `where signtool.exe`

### "Certificate not trusted" (macOS)
- Verify certificate is installed in Keychain: `security find-identity -v -p codesigning`
- Check that certificate Common Name (CN) matches the app name
- Ensure certificate is not expired: `openssl x509 -in cert.p12 -noout -dates`

### "Notarization failed" (macOS)
- Check App Password is correct (not your main Apple ID password)
- Verify Apple ID account has Developer Program access
- Check build logs for notarization errors: `xcrun stapler validate signed.dmg`

### Build timeout
- Default timeout is 60 minutes per platform
- If build times out, increase in workflow:
  ```yaml
  timeout-minutes: 90
  ```

---

## Manual Build (Local)

To build locally without CI/CD:

```bash
# Windows
npm run make

# macOS (requires codesign to be configured)
# Set environment variables before running:
# export MAC_CSC_LINK=/path/to/cert.p12
# export MAC_CSC_KEY_PASSWORD=password
npm run make

# Linux
npm run make
```

---

## Next Steps

1. **Obtain signing certificates** (Windows or macOS)
2. **Create GitHub Secrets** following the steps above
3. **Test with unsigned build** first (no secrets required)
4. **Enable signing** by uncommenting environment variables in workflow
5. **Trigger test release** via tag or manual workflow dispatch
6. **Verify artifacts** are signed and ready for distribution

---

## References

- [Electron Builder Code Signing](https://www.electron.build/code-signing)
- [GitHub Secrets Documentation](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [macOS Notarization Guide](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [Windows Authenticode Signing](https://docs.microsoft.com/en-us/windows/win32/seccrypto/authenticode)
