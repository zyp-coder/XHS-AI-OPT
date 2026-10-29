# XhsHand executor self-check / repair (ASCII only on purpose: no encoding traps)
# Does three things for Edge/Chrome, with the browser CLOSED:
#   1) delete Variations* seed files (they cause "extension disabled after restart")
#   2) make sure developer mode stays on
#   3) flip our own unpacked extension back to enabled (state=1, drop disable_reasons)
# Never touches bookmarks / passwords / history. Backs up Preferences before writing.
# Exit: 0 = ok, 3 = no browser profile found, 4 = unexpected error

param([switch]$Boot)

$ErrorActionPreference = 'Stop'

try {
  $ours = if ($env:XHS_INSTALL_DIR) { $env:XHS_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'XhsHand' }
  $oursLower = $ours.ToLowerInvariant()

  $testRoot = $env:XHS_TEST_ROOT
  if ($testRoot) {
    $roots = @(
      (Join-Path $testRoot 'Microsoft\Edge\User Data'),
      (Join-Path $testRoot 'Google\Chrome\User Data')
    )
  } else {
    $roots = @(
      (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data'),
      (Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data')
    )
  }

  $seen = 0
  $touched = 0
  $browserFound = ''

  $i = 0
  foreach ($root in $roots) {
    $i++
    $which = if ($i -eq 1) { 'edge' } else { 'chrome' }
    if (-not (Test-Path -LiteralPath $root)) { continue }
    $seen++

    Get-ChildItem -LiteralPath $root -Filter 'Variations*' -File -ErrorAction SilentlyContinue | ForEach-Object {
      try { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop } catch { }
    }

    $profiles = @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' })

    foreach ($p in $profiles) {
      $prefPath = Join-Path $p.FullName 'Preferences'
      if (-not (Test-Path -LiteralPath $prefPath)) { continue }

      $raw = ''
      try { $raw = [IO.File]::ReadAllText($prefPath) } catch { continue }
      if (-not $raw) { continue }

      $obj = $null
      try { $obj = $raw | ConvertFrom-Json } catch { continue }
      if ($null -eq $obj) { continue }

      $dirty = $false

      if (-not $obj.PSObject.Properties['extensions']) {
        $obj | Add-Member -NotePropertyName extensions -NotePropertyValue (New-Object psobject)
        $dirty = $true
      }
      $ext = $obj.extensions
      if (-not $ext.PSObject.Properties['ui']) {
        $ext | Add-Member -NotePropertyName ui -NotePropertyValue (New-Object psobject)
        $dirty = $true
      }
      if ($ext.ui.developer_mode -ne $true) {
        $ext.ui | Add-Member -NotePropertyName developer_mode -NotePropertyValue $true -Force
        $dirty = $true
      }

      if ($ext.PSObject.Properties['settings']) {
        foreach ($prop in @($ext.settings.PSObject.Properties)) {
          $s = $prop.Value
          if ($null -eq $s) { continue }
          $sp = ''
          if ($s.PSObject.Properties['path']) { $sp = [string]$s.path }
          if (-not $sp) { continue }
          if (-not $sp.ToLowerInvariant().StartsWith($oursLower)) { continue }
          $browserFound = $which
          if ($s.state -ne 1) {
            $s | Add-Member -NotePropertyName state -NotePropertyValue 1 -Force
            $dirty = $true
          }
          if ($s.PSObject.Properties['disable_reasons']) {
            $s.PSObject.Properties.Remove('disable_reasons')
            $dirty = $true
          }
        }
      }

      if ($dirty) {
        $bak = $prefPath + '.xhs-bak'
        if (-not (Test-Path -LiteralPath $bak)) {
          Copy-Item -LiteralPath $prefPath -Destination $bak -Force -ErrorAction SilentlyContinue
        }
        $json = $obj | ConvertTo-Json -Depth 100 -Compress
        [IO.File]::WriteAllText($prefPath, $json, (New-Object Text.UTF8Encoding($false)))
        $touched++
      }
    }
  }

  try {
    [IO.File]::WriteAllText((Join-Path $env:TEMP 'xhs-browser.txt'), $browserFound, (New-Object Text.UTF8Encoding($false)))
  } catch { }

  if ($seen -eq 0) { exit 3 }
  exit 0
} catch {
  try {
    [IO.File]::WriteAllText((Join-Path $env:TEMP 'xhs-repair-error.txt'), ($_.Exception.Message), (New-Object Text.UTF8Encoding($false)))
  } catch { }
  exit 4
}
