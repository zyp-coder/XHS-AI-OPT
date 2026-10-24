/* 执行器 · 启动器（服务器正式版 A 期）
 *
 * 顺序：干活窗口（自己的外壳）→ 扩展内核（exec-core.js，字节复制、一个字没改）→ 本包外壳。
 * 为什么这么摆：内核自带 importScripts('lib/…')，脚本基准就是本包根目录 → 把 lib/ 摆在根上即可。
 * 外壳整个包在 IIFE 里，避免和内核顶层 const 撞名（一撞整个后台起不来）。 */

importScripts('exec-workwin.js');
importScripts('exec-acct-check.js');
importScripts('exec-core.js');
importScripts('exec-shell.js');
