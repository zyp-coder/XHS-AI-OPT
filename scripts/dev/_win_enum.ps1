Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinEnum {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  public static IntPtr Found = IntPtr.Zero;
}
"@
$procs = @{}
Get-Process msedge -ErrorAction SilentlyContinue | ForEach-Object { $procs[$_.Id] = $true }
$found = New-Object System.Collections.ArrayList
$cb = [WinEnum+EnumWindowsProc]{
  param($hWnd, $lParam)
  $pid2 = 0
  [void][WinEnum]::GetWindowThreadProcessId($hWnd, [ref]$pid2)
  if ($procs.ContainsKey([int]$pid2)) {
    $sb = New-Object System.Text.StringBuilder 512
    [void][WinEnum]::GetWindowText($hWnd, $sb, 512)
    $t = $sb.ToString()
    if ($t.Length -gt 0) {
      [void]$found.Add([pscustomobject]@{ hwnd = $hWnd.ToInt64(); title = $t; visible = [WinEnum]::IsWindowVisible($hWnd); iconic = [WinEnum]::IsIconic($hWnd) })
    }
  }
  return $true
}
[void][WinEnum]::EnumWindows($cb, [IntPtr]::Zero)
$fg = [WinEnum]::GetForegroundWindow().ToInt64()
Write-Output ("FOCUSED hwnd=" + $fg)
$found | ForEach-Object { Write-Output ($_.hwnd.ToString() + " | vis=" + $_.visible + " min=" + $_.iconic + " | " + $_.title) } | Out-String
