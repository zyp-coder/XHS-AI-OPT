param([long]$Hwnd)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
$h = [IntPtr]$Hwnd
if ([WinFocus]::IsIconic($h)) { [void][WinFocus]::ShowWindow($h, 9) }
[void][WinFocus]::ShowWindow($h, 5)
$ok = [WinFocus]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 700
Write-Output ("set=" + $ok + " now=" + [WinFocus]::GetForegroundWindow().ToInt64() + " want=" + $Hwnd)
