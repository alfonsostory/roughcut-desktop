$ErrorActionPreference = "Stop"

$releaseDirectory = Join-Path $PSScriptRoot "..\release"
$installers = @(
  Get-ChildItem -Path $releaseDirectory -File -Filter "Roughcut-*-win-x64.exe"
)

if ($installers.Count -ne 1) {
  throw "Expected exactly one Windows NSIS installer, found $($installers.Count)."
}

$windowsZipFiles = @(
  Get-ChildItem -Path $releaseDirectory -File -Filter "*win*x64*.zip"
)
if ($windowsZipFiles.Count -ne 0) {
  throw "Windows packaging must produce an installer, not a ZIP archive."
}

$updateManifest = Join-Path $releaseDirectory "latest.yml"
if (-not (Test-Path $updateManifest)) {
  throw "Windows update manifest latest.yml was not generated."
}
if ((Get-Content $updateManifest -Raw) -notmatch [regex]::Escape($installers[0].Name)) {
  throw "latest.yml does not reference the generated NSIS installer."
}

$installerProcess = Start-Process -FilePath $installers[0].FullName -ArgumentList "/S" -PassThru -Wait
if ($installerProcess.ExitCode -ne 0) {
  throw "The Windows installer exited with code $($installerProcess.ExitCode)."
}

$expectedExecutable = Join-Path $env:LOCALAPPDATA "Programs\Roughcut\Roughcut.exe"
if (-not (Test-Path $expectedExecutable)) {
  $expectedExecutable = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "Programs") -Recurse -File -Filter "Roughcut.exe" |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $expectedExecutable -or -not (Test-Path $expectedExecutable)) {
  throw "The installer completed but Roughcut.exe was not installed."
}

$smokeResultPath = Join-Path $env:RUNNER_TEMP "roughcut-windows-smoke.json"
$env:ROUGHCUT_DESKTOP_SMOKE_TEST_PATH = $smokeResultPath
$appProcess = Start-Process -FilePath $expectedExecutable -PassThru
if (-not $appProcess.WaitForExit(30000)) {
  $appProcess.Kill()
  throw "The installed Roughcut app did not finish its smoke test within 30 seconds."
}
if ($appProcess.ExitCode -ne 0) {
  throw "The installed Roughcut app exited with code $($appProcess.ExitCode)."
}
if (-not (Test-Path $smokeResultPath)) {
  throw "The installed Roughcut app did not write its smoke-test result."
}

$smokeResult = Get-Content $smokeResultPath -Raw | ConvertFrom-Json
if (-not $smokeResult.packaged) { throw "Smoke test did not run from a packaged app." }
if ($smokeResult.platform -ne "win32") { throw "Smoke test did not run on Windows." }
if ($smokeResult.arch -ne "x64") { throw "Smoke test did not run as Windows x64." }
if (-not $smokeResult.mediaServiceReady) { throw "The local media service did not start." }

Write-Host "Verified installer: $($installers[0].Name)"
Write-Host "Verified installed executable: $expectedExecutable"
Write-Host "Verified packaged app startup and local media service."
