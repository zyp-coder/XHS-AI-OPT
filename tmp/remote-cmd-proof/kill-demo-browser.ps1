# Kill ONLY the demo browser processes (command line contains remote-cmd-proof).
# Do NOT touch the boss's own Edge windows.
# ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 without BOM as ANSI,
# and CJK comments can swallow line breaks and turn the whole script into a no-op.
Get-CimInstance Win32_Process -Filter "name='msedge.exe'" |
  Where-Object { $_.CommandLine -like '*remote-cmd-proof*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
