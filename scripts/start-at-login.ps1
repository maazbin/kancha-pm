param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Kancha Personal PM.lnk'
if ($Remove) {
  if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath }
  return
}
$repo = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$runner = Join-Path $PSScriptRoot 'background.vbs'
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32/wscript.exe'
$shortcut.Arguments = '"{0}" "{1}" "{2}"' -f $runner,$node,(Join-Path $repo 'src/cli.js')
$shortcut.WorkingDirectory = $repo
$shortcut.Save()
Write-Host 'Kancha will start at next sign-in. Open http://127.0.0.1:4317 for the dashboard.'
