# 小红书评论助手 · 安装与发布说明

## 一、为什么不能做成"点一下装进 Chrome"？
Chrome **从系统层面禁止普通用户免开发者模式静默安装第三方扩展**。所以没有一个"正经 Windows exe"能直接塞进 Chrome 而不让你做任何操作。现实可选路线：

| 路线 | 用户体验 | 代价 |
|---|---|---|
| **Chrome 网上应用店上架** | 最好：一键安装、无开发者模式 | 一次性 $5 开发者账户费 + 过审，可做私有分发 |
| **本次的 NSIS 安装包** | 装完开一次开发者模式加载文件夹即可 | 一次开发者模式躲不掉 |
| 企业策略 GPO | 无需开发者模式 | 要域/管理员权限，只适合公司内部 |

## 二、本安装包做什么
`setup\installer.nsi` 用免费的 [NSIS](https://nsis.sourceforge.io/Download) 编译成 `小红书评论助手-setup.exe`，它会：
1. 把 `extension\` 整个装到 `%LOCALAPPDATA%\小红书评论助手\extension`
2. 落一份 `install-config.json`（**发版前可按每个顾客改**：绑定小红书号、产品名等），扩展首次运行会自动读取预填
3. 在桌面/开始菜单生成"一键加载扩展"快捷方式

**安装完成后用户仍需一次"开发者模式"**（Chrome 强制，无法绕过）：
1. 双击"Ohi一键加载扩展"（自动打开 chrome://extensions）
2. 打开右上角"开发者模式"
3. 点"加载已解压的扩展程序"→ 选 `extension` 文件夹
4. 之后每次点扩展图标 → 进"首次设置"向导：填 AI → 产品 → 目标 → 验证小红书号 → 开用

## 三、怎么打出 setup.exe
安装免费 NSIS（https://nsis.sourceforge.io/Download 安装版），然后：
```
双击 setup\build.bat
```
或命令行手动：
```
"C:\Program Files (x86)\NSIS\makensis.exe" setup\installer.nsi
```
生成 `setup\小红书评论助手-setup.exe` 即安装包。

## 四、要不要预填更多
想给不同顾客预填不同产品/绑定号：直接改 `setup\install-config.json` 再打包即可（Key 等私密字段不预填，让用户在向导里填）。

## 五、想要"免开发者模式"
把扩展上架 Chrome 网上应用店。这是唯一真正免开发者模式的方式，如需我配合整理上架清单/截图可再说。