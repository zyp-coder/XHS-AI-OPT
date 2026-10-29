' XhsHand executor - startup launcher (ASCII only on purpose)
' Runs silently at logon: waits a few seconds, lets repair.bat check/fix things
' while the browser is still closed, then repair.bat starts the browser minimized.
Option Explicit
Dim sh, fso, base, d, bat
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
WScript.Sleep 8000
base = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\XhsHand"
If Not fso.FolderExists(base) Then WScript.Quit
For Each d In fso.GetFolder(base).SubFolders
  If fso.FileExists(d.Path & "\manifest.json") Then
    bat = d.Path & "\repair.bat"
    If fso.FileExists(bat) Then
      sh.Run """" & bat & """ /boot", 0, True
    End If
  End If
Next
