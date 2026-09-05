using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;

// 通用安装器：把自己同级的“扩展包目录（含 manifest.json，已打过绑定的）”装到本机，
// 并读取同级的 installdef.json（可选）决定写进 install-config.json 的绑定号/产品名。
// 兼容 .NET Framework 4.x 内置 csc（C#5）：不用 local function / dynamic。
class Setup {
    static readonly string[] EXCLUDE = { "_capture", ".backup", "popup.html.backup", "__pycache__", "server.log" };

    static int Main() {
        string exeDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        string src = FindSrcDir(exeDir);
        if (src == null) {
            Msg("没找到扩展包目录。请把本 setup.exe 与「小红书评论助手-xxx」扩展包文件夹放同一目录（或同级名为 extension 的文件夹）。");
            return 1;
        }
        try {
            string install = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "XHSAssistant");
            string extDir = Path.Combine(install, "extension");

            CopyDir(src, extDir);                    // 1) 复制带绑定的扩展包
            var def = ReadDef(exeDir);               // 2) 读 installdef.json（绑定号/产品名）
            WriteConfig(extDir, def);                // 3) 写扩展目录内 install-config.json（供 runtime 预填）
            string cmd = Path.Combine(install, "load-extensions.cmd");
            WriteLauncher(cmd, extDir);              // 4) 一键加载脚本
            WriteUninstaller(install);               // 5) 卸载脚本
            MakeShortcuts(install, Path.GetFileName(cmd)); // 6) 快捷方式
            LaunchChrome();                          // 7) 打开 chrome://extensions

            string bindLine = (def != null && def.ContainsKey("boundXhsId") && def["boundXhsId"] != "")
                ? ("\n\n本安装包绑定小红书号：" + def["boundXhsId"]) : "";
            Msg("安装完成。\n\n来源扩展包：" + src + "\n已装到：" + extDir +
                "\n\n接下来只需：\n1) 在打开的 Chrome 扩展页右上角打开「开发者模式」\n2) 点「加载已解压的扩展程序」，选择上面的 extension 文件夹" +
                bindLine);
            return 0;
        } catch (Exception ex) {
            Msg("安装失败：" + ex.Message);
            return 1;
        }
    }

    // 从 exe 同级找扩展包目录：优先“名字以本 exe 去掉 -setup 为前缀且含 manifest.json”，否则名为 extension
    static string FindSrcDir(string exeDir) {
        string full = Process.GetCurrentProcess().MainModule.FileName ?? "";
        string prefix = Path.GetFileNameWithoutExtension(full);
        if (prefix.EndsWith("-setup")) prefix = prefix.Substring(0, prefix.Length - "-setup".Length);
        var exts = new List<string>();
        foreach (string d in Directory.GetDirectories(exeDir)) {
            if (File.Exists(Path.Combine(d, "manifest.json"))) exts.Add(d);
        }
        if (exts.Count == 0) return null;
        var byPrefix = exts.Where(d => Path.GetFileName(d).StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                           .OrderByDescending(d => new DirectoryInfo(d).LastWriteTime).ToList();
        if (byPrefix.Count > 0) return byPrefix[0];
        var extExt = exts.Where(d => string.Equals(Path.GetFileName(d), "extension", StringComparison.OrdinalIgnoreCase)).ToList();
        if (extExt.Count > 0) return extExt[0];
        return exts.OrderByDescending(d => new DirectoryInfo(d).LastWriteTime).First();
    }

    static Dictionary<string, string> ReadDef(string exeDir) {
        string full = Process.GetCurrentProcess().MainModule.FileName ?? "";
        string pre = Path.GetFileNameWithoutExtension(full).Replace("-setup", "");
        string[] candidates = { pre + "-installdef.json", "installdef.json" };
        foreach (string c in candidates) {
            string p = Path.Combine(exeDir, c);
            if (!File.Exists(p)) continue;
            try { return ParseDef(File.ReadAllText(p, Encoding.UTF8)); } catch { }
        }
        return null;
    }

    static Dictionary<string, string> ParseDef(string json) {
        var map = new Dictionary<string, string>();
        string v = Extract(json, "boundXhsId");
        if (v != null) map["boundXhsId"] = v;
        v = Extract(json, "licensee");
        if (v != null) map["licensee"] = v;
        v = Extract(json, "name");
        if (v != null) map["productName"] = v;
        return map;
    }
    static string Extract(string json, string key) {
        var m = System.Text.RegularExpressions.Regex.Match(json, "\"" + System.Text.RegularExpressions.Regex.Escape(key) + "\"\\s*:\\s*\"((?:\\\\.|[^\"])*)\"");
        if (!m.Success) return null;
        return m.Groups[1].Value.Replace("\\\"", "\"").Replace("\\\\", "\\");
    }

    static void CopyDir(string from, string to) {
        Directory.CreateDirectory(to);
        foreach (string d in Directory.GetDirectories(from)) {
            string name = Path.GetFileName(d);
            if (EXCLUDE.Contains(name, StringComparer.OrdinalIgnoreCase)) continue;
            CopyDir(d, Path.Combine(to, name));
        }
        foreach (string f in Directory.GetFiles(from)) {
            string name = Path.GetFileName(f);
            if (name.StartsWith("_")) continue;
            if (name.EndsWith(".backup")) continue;
            if (EXCLUDE.Contains(name, StringComparer.OrdinalIgnoreCase)) continue;
            File.Copy(f, Path.Combine(to, name), true);
        }
    }

    static void WriteConfig(string extDir, Dictionary<string, string> def) {
        string xhs = def != null && def.ContainsKey("boundXhsId") ? def["boundXhsId"] : "";
        string lc = def != null && def.ContainsKey("licensee") ? def["licensee"] : "";
        string pn = def != null && def.ContainsKey("productName") ? def["productName"] : "我的产品";
        string js = "{\r\n  \"product\": { \"name\": \"" + JsonEsc(pn) + "\", \"description\": \"\", \"guideText\": \"\", \"promoGoal\": \"tool\" },\r\n  \"licensee\": \"" + JsonEsc(lc) + "\",\r\n  \"boundXhsId\": \"" + JsonEsc(xhs) + "\"\r\n}";
        File.WriteAllText(Path.Combine(extDir, "install-config.json"), js, new UTF8Encoding(true));
    }

    static string JsonEsc(string s) {
        return (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");
    }

    static string LauncherBody(string extDir) {
        return "@chcp 65001 >nul\r\n"
            + "@echo off\r\n"
            + "setlocal\r\n"
            + "set \"EXT=" + extDir + "\"\r\n"
            + "start \"\" chrome --disable-extensions-except=\"%EXT%\" --load-extension=\"%EXT%\"\r\n"
            + "start \"\" chrome chrome://extensions\r\n"
            + "echo 已打开 Chrome 扩展页，请：\r\n"
            + "echo  1) 右上角打开「开发者模式」开关\r\n"
            + "echo  2) 点「加载已解压的扩展程序」，选择：%EXT%\r\n"
            + "echo  3) 打开小红书网页，点扩展图标，会引导你完成首次设置\r\n"
            + "pause\r\n";
    }

    static void WriteLauncher(string path, string extDir) {
        File.WriteAllText(path, LauncherBody(extDir), new UTF8Encoding(true));
    }

    static void WriteUninstaller(string install) {
        string un = "@chcp 65001 >nul\r\n@echo off\r\n"
            + "taskkill /f /im chrome.exe >nul 2>&1\r\n"
            + "set \"D=" + install + "\"\r\n"
            + "rd /s /q \"%D%\"\r\n"
            + "del /q \"%USERPROFILE%\\Desktop\\小红书评论助手·一键加载.lnk\"\r\n"
            + "del /q \"%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\小红书评论助手\\一键加载扩展.lnk\"\r\n"
            + "del /q \"%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\小红书评论助手\\卸载.lnk\"\r\n"
            + "rd \"%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\小红书评论助手\" 2>nul\r\n"
            + "echo 已卸载。\r\npause\r\n";
        File.WriteAllText(Path.Combine(install, "uninstall.cmd"), un, new UTF8Encoding(true));
    }

    static void MakeShortcuts(string install, string launcherName) {
        Type t = Type.GetTypeFromProgID("WScript.Shell");
        if (t == null) return;
        object sh = Activator.CreateInstance(t);
        string launcher = Path.Combine(install, launcherName);
        string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        MakeLink(t, sh, Path.Combine(desktop, "小红书评论助手·一键加载.lnk"), launcher, install);
        string sm = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "小红书评论助手");
        Directory.CreateDirectory(sm);
        MakeLink(t, sh, Path.Combine(sm, "一键加载扩展.lnk"), launcher, install);
        MakeLink(t, sh, Path.Combine(sm, "卸载.lnk"), Path.Combine(install, "uninstall.cmd"), install);
        Marshal.FinalReleaseComObject(sh);
    }
    static void MakeLink(Type t, object sh, string linkPath, string target, string workDir) {
        try {
            object sc = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, sh, new object[] { linkPath });
            Type ct = sc.GetType();
            ct.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { target });
            ct.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { workDir });
            ct.InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, null);
            Marshal.FinalReleaseComObject(sc);
        } catch { }
    }

    static void LaunchChrome() {
        try { Process.Start(new ProcessStartInfo("chrome", "chrome://extensions") { UseShellExecute = true }); } catch { }
    }

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    static extern int MessageBox(IntPtr h, string text, string caption, uint type);
    static void Msg(string text) {
        MessageBox(IntPtr.Zero, text, "小红书评论助手 · 安装", 0x00000040);
    }
}