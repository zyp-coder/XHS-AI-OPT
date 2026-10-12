# Rebuild the demo .bat for Windows cmd.
#   input : UTF-8 + LF endings (as written by the editor)
#   output: GBK (cp936) + CRLF endings, in place
# Why: cmd.exe parses batch files with the OEM/ANSI codepage (936 on zh-CN Windows),
# and LF-only files with multi-byte CJK text get misparsed (line boundaries break).
# Run this after EVERY edit of the .bat (always re-write it as UTF-8 first).
$f = (Get-Item *.bat).FullName
$c = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)
$c = $c.Replace("`r`n", "`n").Replace("`n", "`r`n")
[System.IO.File]::WriteAllText($f, $c, [System.Text.Encoding]::GetEncoding(936))
Write-Host ("bat fixed: " + $f)
