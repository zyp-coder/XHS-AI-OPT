; 小红书评论助手 · 安装包（NSIS）
; 作用：把扩展文件夹装到用户目录、写一份预填配置、生成一键启动 Chrome 加载扩展的快捷方式。
; 说明：Chrome 不允许普通用户“免开发者模式”静默装第三方扩展，所以安装完仍需在 chrome://extensions 开一次“开发者模式”并加载文件夹（或用配套的“一键加载”快捷方式）。

!include "MUI2.nsh"

Name "小红书评论助手"
OutFile "小红书评论助手-setup.exe"
InstallDir "$LOCALAPPDATA\小红书评论助手"
RequestExecutionLevel user
Unicode true

!define MUI_ICON "..\extension\icons\icon128.png"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "安装 (必选)" SecMain
  SetOutPath "$INSTDIR"
  ; 扩展本体
  File /r "..\extension\*.*"
  ; 预填配置（装完由扩展首次运行时读取，帮你把产品名/绑定号填好）
  File "install-config.json"
  ; 一键启动脚本
  File "load-extensions.cmd"
  File "启动说明.txt"
  ; 图标小圆标
  WriteUninstaller "$INSTDIR\uninstall.exe"
  CreateDirectory "$SMPROGRAMS\小红书评论助手"
  CreateShortcut "$SMPROGRAMS\小红书评论助手\一键加载扩展.lnk" "$INSTDIR\load-extensions.cmd" "" "$INSTDIR\extension\icons\icon128.png"
  CreateShortcut "$SMPROGRAMS\小红书评论助手\启动说明.lnk" "$INSTDIR\启动说明.txt"
  CreateShortcut "$SMPROGRAMS\小红书评论助手\卸载.lnk" "$INSTDIR\uninstall.exe"
  CreateShortcut "$DESKTOP\小红书评论助手·一键加载.lnk" "$INSTDIR\load-extensions.cmd" "" "$INSTDIR\extension\icons\icon128.png"
SectionEnd

Section "卸载"
  Delete "$INSTDIR\uninstall.exe"
  RMDir /r "$INSTDIR\extension"
  Delete "$INSTDIR\install-config.json"
  Delete "$INSTDIR\load-extensions.cmd"
  Delete "$INSTDIR\启动说明.txt"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\小红书评论助手\一键加载扩展.lnk"
  Delete "$SMPROGRAMS\小红书评论助手\启动说明.lnk"
  Delete "$SMPROGRAMS\小红书评论助手\卸载.lnk"
  RMDir "$SMPROGRAMS\小红书评论助手"
  Delete "$DESKTOP\小红书评论助手·一键加载.lnk"
SectionEnd