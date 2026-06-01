$ErrorActionPreference = "Stop"

$excludePattern = '\\(node_modules|\.git|dist|build|out|coverage|\.next|\.turbo)(\\|$)'

function Get-CodeFenceLanguage([string]$path) {
  switch ([System.IO.Path]::GetExtension($path).ToLower()) {
    ".json" { "json" }
    ".js"   { "javascript" }
    ".cjs"  { "javascript" }
    ".mjs"  { "javascript" }
    ".ts"   { "typescript" }
    ".jsx"  { "jsx" }
    ".tsx"  { "tsx" }
    ".md"   { "markdown" }
    ".xml"  { "xml" }
    ".html" { "html" }
    ".css"  { "css" }
    ".scss" { "scss" }
    ".sass" { "scss" }
    ".less" { "css" }
    ".yml"  { "yaml" }
    ".yaml" { "yaml" }
    ".sh"   { "bash" }
    ".ps1"  { "powershell" }
    ".java" { "java" }
    ".kt"   { "kotlin" }
    ".properties" { "properties" }
    ".env"  { "bash" }
    default { "" }
  }
}

function Write-MarkdownFileBlock([string]$bundlePath, [string]$fullPath) {
  $relative = $fullPath.Substring($PWD.Path.Length + 1)
  $lang = Get-CodeFenceLanguage $relative
  Add-Content -Path $bundlePath -Value ("# FILE: " + $relative)
  Add-Content -Path $bundlePath -Value ('```' + $lang)
  Add-Content -Path $bundlePath -Value (Get-Content -Path $fullPath -Raw)
  Add-Content -Path $bundlePath -Value '```'
  Add-Content -Path $bundlePath -Value ""
}

function Add-PathsToBundle([string]$bundlePath, [string[]]$paths) {
  if (Test-Path $bundlePath) { Remove-Item $bundlePath -Force }

  foreach ($path in $paths) {
    if (Test-Path $path) {
      $item = Get-Item $path
      if ($item.PSIsContainer) {
        Get-ChildItem -Path $path -File -Recurse -Force |
          Where-Object { $_.FullName -notmatch $excludePattern } |
          Sort-Object FullName |
          ForEach-Object { Write-MarkdownFileBlock -bundlePath $bundlePath -fullPath $_.FullName }
      } else {
        $resolved = (Resolve-Path $path).Path
        if ($resolved -notmatch $excludePattern) {
          Write-MarkdownFileBlock -bundlePath $bundlePath -fullPath $resolved
        }
      }
    }
  }
}

# 1) repo-tree.txt
Get-ChildItem -Force -Recurse |
  Where-Object { $_.FullName -notmatch $excludePattern } |
  ForEach-Object {
    $relative = $_.FullName.Substring($PWD.Path.Length + 1)
    if ($_.PSIsContainer) { "[DIR]  $relative" } else { "[FILE] $relative" }
  } |
  Set-Content -Path .\repo-tree.txt

# 2) codebase-review-bundle.md
$coreFiles = @(
  "package.json",
  "CLAUDE.md",
  "server.js",
  "electron\main.js",
  "electron\main.cjs",
  "electron\main.mjs",
  "electron\preload.js",
  "electron\preload.cjs",
  "electron\preload.mjs",
  "src\canvas-state.js",
  "src\canvas-state.ts",
  "src\canvas.js",
  "src\canvas.ts"
)
Add-PathsToBundle -bundlePath ".\codebase-review-bundle.md" -paths $coreFiles

# 3) bundle-2-renderer.md
$rendererPaths = @(
  "src",
  "renderer",
  "public"
)
Add-PathsToBundle -bundlePath ".\bundle-2-renderer.md" -paths $rendererPaths

# 4) bundle-3-builder-tests.md
$otherPaths = @(
  "builder",
  "lib",
  "tests",
  "test",
  "garmin-project-template",
  ".github",
  "README.md",
  "README.txt",
  ".env.example",
  ".env.sample",
  "electron-builder.yml",
  "electron-builder.yaml",
  "electron-builder.json",
  "vite.config.js",
  "vite.config.ts",
  "webpack.config.js",
  "webpack.config.ts",
  "eslint.config.js",
  ".eslintrc",
  ".eslintrc.json",
  ".nvmrc"
)
Add-PathsToBundle -bundlePath ".\bundle-3-builder-tests.md" -paths $otherPaths

Write-Host ""
Write-Host "Created files:"
Write-Host " - repo-tree.txt"
Write-Host " - codebase-review-bundle.md"
Write-Host " - bundle-2-renderer.md"
Write-Host " - bundle-3-builder-tests.md"
Write-Host ""
Write-Host "Upload those four files to the Space."