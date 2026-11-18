$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$notice = New-Object System.Windows.Forms.NotifyIcon
try {
  $notice.Icon = [System.Drawing.SystemIcons]::Information
  $notice.Visible = $true
  $notice.ShowBalloonTip(5500, $env:KANCHA_NOTICE_TITLE, $env:KANCHA_NOTICE_BODY, [System.Windows.Forms.ToolTipIcon]::Info)
  Start-Sleep -Seconds 6
} finally { $notice.Dispose() }
