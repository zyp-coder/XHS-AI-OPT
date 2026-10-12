"""备份开关「不含素材缩略图」回归自检。

跑法：python3 scripts/dev/check_backup_nothumb.py
在临时 profile 里加载真扩展（msedge），灌两条素材（本机图带 ≤160px 缩略图 + 链接），检查：
  1) 后台导出默认仍带缩略图（别的字段一个不少）
  2) 传 noThumb: true 时只剥掉本机图那张小图，文件名 / 引用 / 挂在哪条需求上都还在，
     链接素材不受影响，需求清单等其他数据也不动，备份摘要两边一致
  3) 弹窗左栏「设置 → 备份 / 恢复」进来，页面真的会渲染出导出 / 导入按钮（曾经是空 body）
  4) 勾上「不含素材缩略图」再点导出：发给后台的确实是 noThumb: true，
     真实下载下来的加密文件解开头像也确实没有缩略图，成功文案标明「素材缩略图未含」；
     不勾时导出照旧带缩略图
"""
import json
import pathlib
import sys
import tempfile

from playwright.sync_api import expect, sync_playwright

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'

PNG_1PX = ('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'
           'AAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==')

ASSETS = [
    {'id': 'as_local_1', 'kind': 'local', 'ref': '', 'name': '门店实拍.jpg', 'thumb': PNG_1PX,
     'w': 120, 'h': 160, 'needId': 'nd_1', 'addedAt': 1758700000000},
    {'id': 'as_link_1', 'kind': 'link', 'ref': 'https://example.com/todo.png', 'name': '待办清单',
     'thumb': '', 'w': 0, 'h': 0, 'needId': 'nd_2', 'addedAt': 1758700001000},
]
NEEDS = {'sig': 'sig-fixture', 'genAt': 1758700000000, 'needs': [
    {'id': 'nd_1', 'title': '门店实拍 ×2', 'spec': '门头 + 柜台', 'source': '卖点「到店体验」',
     'manual': False, 'mark': '', 'createdAt': 1758700000000},
    {'id': 'nd_2', 'title': '同一天的待办清单实拍', 'spec': '', 'source': '知识库「时间管理」',
     'manual': False, 'mark': '', 'createdAt': 1758700000000},
]}
PW = 'nothumb-pass'


def run():
    out = pathlib.Path(tempfile.mkdtemp(prefix='xhs-nothumb-'))
    print('Artifacts:', out, flush=True)
    errors = []
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            str(out / 'profile'), channel='msedge', headless=False, accept_downloads=True,
            viewport={'width': 1180, 'height': 1000},
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')

            # ── ① 后端口径：默认带缩略图；noThumb 只剥那张小图 ──
            r = worker.evaluate('''async (seed) => {
                await ensureTenantInit();
                await chrome.storage.local.set({ np_assets: seed.assets, np_asset_needs: seed.needs });
                // 写完立刻读有可能还没落稳（实测偶发读到旧值）→ 读到自己写的那两条再往下走
                for (let i = 0; i < 40; i++) {
                    const back = await chrome.storage.local.get('np_assets');
                    if (Array.isArray(back.np_assets) && back.np_assets.length === seed.assets.length) break;
                    await new Promise(res => setTimeout(res, 50));
                }
                const plain = (await handleExportAllData({})).backup;
                const thin = (await handleExportAllData({ noThumb: true })).backup;
                const cur = plain.currentId;
                return {
                    tenantCount: plain.tenants.length,
                    plainAssets: (plain.data[cur].np_assets || []),
                    thinAssets: (thin.data[cur].np_assets || []),
                    thinNeeds: (thin.data[cur].np_asset_needs || {}).needs || [],
                    plainSummary: plain.summary,
                    thinSummary: thin.summary,
                };
            }''', {'assets': ASSETS, 'needs': NEEDS})
            assert r['tenantCount'] == 1, r['tenantCount']
            assert r['plainAssets'] == ASSETS, ('默认导出必须原样带缩略图', r['plainAssets'])
            thin = r['thinAssets']
            assert len(thin) == 2 and thin[0]['thumb'] == '', thin
            assert thin[0]['name'] == '门店实拍.jpg' and thin[0]['needId'] == 'nd_1', ('只剥缩略图，文件名与归属照留', thin[0])
            assert thin[1] == ASSETS[1], '链接素材不该被动'
            assert [(n['id'], n['title']) for n in r['thinNeeds']] == [(n['id'], n['title']) for n in NEEDS['needs']], '需求清单不该动'
            for name, sm in r['thinSummary'].items():
                assert sm['素材数'] == 2, (name, sm)
            assert r['thinSummary'] == r['plainSummary'], (r['plainSummary'], r['thinSummary'])
            print('PASS: 后台 noThumb 只剥本机图缩略图，文件名/归属/链接/需求清单/摘要都不动')

            # ── ② 弹窗左栏「设置 → 备份 / 恢复」：页面得真渲染出按钮 ──
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(f'chrome-extension://{worker.url.split("/")[2]}/popup.html?mode=big')
            page.wait_for_load_state('domcontentloaded')
            if page.locator('#fsClose').is_visible():
                page.locator('#fsClose').click()
            page.locator('#tabSettings').click()
            page.locator('[data-stab="backup"]').click()
            frame = page.frame_locator('#settingsFrame')
            expect(frame.locator('#backupExport')).to_be_visible()
            expect(frame.locator('#backupImport')).to_be_visible()
            box = frame.locator('#backupNoThumb')
            expect(box).to_be_visible()
            expect(box).not_to_be_checked()
            expect(frame.locator('#backupBody')).to_contain_text('不含素材缩略图')
            print('PASS: 弹窗左栏进来的备份 / 恢复会渲染出导出 / 导入按钮，并且有「不含素材缩略图」勾选框（默认不勾）')

            fobj = next(f for f in page.frames if 'settings.html' in (f.url or ''))
            fobj.evaluate('''() => {
                window.__sent = [];
                const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
                chrome.runtime.sendMessage = (msg, cb) => { window.__sent.push(msg); return orig(msg, cb); };
                window.__dl = null;
                window.__blobs = [];
                const oc = HTMLAnchorElement.prototype.click;
                HTMLAnchorElement.prototype.click = function () {
                    if (this.href && String(this.href).indexOf('blob:') === 0) { window.__dl = this.download; return; }
                    return oc.apply(this, arguments);
                };
                // 导出那一下 URL 立刻就被 revoke 了，抓 Blob 本体才拿得到内容
                const ou = URL.createObjectURL.bind(URL);
                URL.createObjectURL = (b) => { window.__blobs.push(b); return ou(b); };
                window.__blobText = async () => {
                    const b = window.__blobs && window.__blobs.length ? window.__blobs[window.__blobs.length - 1] : null;
                    return b ? await b.text() : '';
                };
            }''')

            def export_once(check):
                sent_before = fobj.evaluate('() => window.__sent.length')
                frame.locator('#backupExport').click()
                frame.locator('#cbPwd').fill(PW)
                frame.locator('#cbPwd2').fill(PW)
                frame.locator('#cbOk').click()
                frame.locator('#backupMsg').filter(has_text='已加密导出').wait_for(timeout=20000)
                sent = fobj.evaluate('(n) => window.__sent.slice(n)', sent_before)
                check(sent, frame.locator('#backupMsg').inner_text())

            def unpack(sent):
                assert sent and sent[0]['action'] == 'exportAllData', sent
                name = fobj.evaluate('() => window.__dl') or ''
                assert name.startswith('xhs-ai-backup-') and name.endswith('.enc.json'), name
                blob = fobj.evaluate('() => window.__blobText()')
                assert blob, '导出没抓到 blob 文件'
                bundle = json.loads(fobj.evaluate('(payload) => CryptoBox.decryptFile(payload, "%s")' % PW, blob))
                assert bundle['version'] == 1 and len(bundle['tenants']) == 1, list(bundle.keys())
                cur = bundle['data'][bundle['currentId']]
                assert cur['np_asset_needs']['needs'], '需求清单该在包里'
                return sent[0], cur['np_assets']

            def with_thumb(sent, msg):
                msg0, arr = unpack(sent)
                assert msg0['data']['noThumb'] is True, sent
                assert '素材缩略图未含' in msg, msg
                assert arr[0]['thumb'] == '' and arr[0]['name'] == '门店实拍.jpg', arr
                assert arr[1]['ref'] == 'https://example.com/todo.png', arr[1]
                print('PASS: 勾选后导出 → 后台收到 noThumb: true，下载的加密文件解出来确实没有缩略图，文案标明未含')

            def full(sent, msg):
                msg0, arr = unpack(sent)
                assert msg0['data']['noThumb'] is False, sent
                assert '素材缩略图未含' not in msg, msg
                assert arr[0]['thumb'].startswith('data:image/'), '不勾时必须照旧带缩略图'
                print('PASS: 不勾时导出照旧带缩略图，成功文案也不说「素材缩略图未含」')

            box.check()
            export_once(with_thumb)
            box.uncheck()
            export_once(full)

            shot = out / 'backup-nothumb.png'
            page.screenshot(path=str(shot), full_page=True)
            print('SHOT 备份 / 恢复:', shot)

            assert not errors, errors
            print('PASS: 无 pageerror')
        finally:
            context.close()
    print('ALL PASS')


if __name__ == '__main__':
    run()
