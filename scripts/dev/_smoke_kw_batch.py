# -*- coding: utf-8 -*-
"""词池批次手风琴冒烟（2026-10-02 改版）：
一批一卡、点卡头展开、回车加词落当前批、卡头＋关键词弹窗、删批退回默认。
只测界面联动，不碰扫描链路。跑法：python3 scripts/dev/_smoke_kw_batch.py"""
import pathlib
import tempfile

from playwright.sync_api import expect, sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'


def pool(worker):
    return worker.evaluate('''async () => {
        const c = (await chrome.storage.local.get('drain_scan_cfg')).drain_scan_cfg || {};
        return { batches: c.batches || [], plan: c.batchPlan || {},
                 kw: (c.keywords || []).map(e => e.k + '@' + ((e.batch || '默认'))) };
    }''')


with tempfile.TemporaryDirectory(prefix='xhs-kwbatch-') as profile, sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        profile, headless=False, channel='msedge',
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    try:
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        sw.evaluate('''async () => {
            await Storage.initializeDefaults(DEFAULT_PROMPTS);
            await ensureTenantInit();
            await chrome.storage.local.set({ drain_scan_cfg: {
                v: 5,
                keywords: [
                    { k: '词A', on: true, src: 'manual', batch: '默认', types: {} },
                    { k: '词B', on: true, src: 'manual', batch: 'B批', types: {} }
                ],
                batches: ['B批'],
            } });
        }''')
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        dialogs = []
        page.on('dialog', lambda d: (dialogs.append(d.message), d.accept()))
        page.set_default_timeout(15000)
        page.goto(sw.url.replace('background.js', 'popup.html?mode=big'))
        page.wait_for_function('typeof switchMainTab === "function"')
        if page.locator('#fsClose').is_visible():
            page.locator('#fsClose').click()
        page.locator('#tabHuoke').click()
        page.locator('#tabTaskCfg').click()
        cfg = page.locator('#drainCfgContent')
        expect(cfg.locator('#sxKwAdd')).to_be_visible()

        # 1) 两个批次卡；多批次首进＝都收起，词表不铺出来
        heads = cfg.locator('.sx-kwgrp-head')
        expect(heads).to_have_count(2)
        expect(heads.nth(0)).to_contain_text('默认')
        expect(heads.nth(1)).to_contain_text('B批')
        assert cfg.locator('select[data-poolbatch]').count() == 0, '没点卡头不该铺出词表'

        # 2) 点 B批 卡头 → 展开词表，该行成为当前批
        heads.nth(1).click()
        expect(cfg.locator('.sx-kwgrp').nth(1).locator('.sx-word')).to_have_text('词B')
        assert '当前' in cfg.locator('.sx-kwgrp').nth(1).inner_text(), '展开的批该标「当前」'

        # 3) 顶部回车加词 → 落到当前批（B批）并展开可见
        cfg.locator('#sxKwAdd').fill('词C')
        cfg.locator('#sxKwAdd').press('Enter')
        expect(cfg.locator('.sx-kwgrp').nth(1).locator('.sx-word')).to_have_count(2)
        assert '词C@B批' in ';'.join(pool(sw)['kw']), pool(sw)

        # 4) 默认批卡头「＋ 关键词」→ 弹窗预挑默认批，保存后落默认且展开
        cfg.locator('.sx-kwgrp-head').nth(0).locator('[data-kwgrpadd]').click()
        modal = page.locator('#kwAddModal')
        expect(modal).to_be_visible()
        assert modal.locator('#kwamBatch').input_value() == '默认'
        modal.locator('#kwamKw').fill('词D')
        modal.locator('#kwamSave').click()
        expect(cfg.locator('.sx-kwgrp').nth(0).locator('.sx-word')).to_have_count(2)
        assert '词D@默认' in ';'.join(pool(sw)['kw']), pool(sw)

        # 4b) 卡头全选：取消＝默认批整批停用，再勾回＝整批启用
        box = cfg.locator('.sx-kwgrp').nth(0).locator('[data-kwgroupsel]')
        assert box.is_checked(), '默认批词全启用时全选勾该是选中态'
        box.click()
        expect(cfg.locator('.sx-kwgrp').nth(0).locator('.sx-kwgrp-head')).to_contain_text('启用 0')
        box.click()
        expect(cfg.locator('.sx-kwgrp').nth(0).locator('.sx-kwgrp-head')).to_contain_text('启用 2')

        # 5) 行末小下拉把 词A 划去 B批 → 词离开默认组、进 B批 组
        cfg.locator('.sx-kwgrp').nth(0).locator('select[data-poolbatch]').first.select_option('B批')
        expect(cfg.locator('.sx-kwgrp').nth(1).locator('.sx-word')).to_have_count(3)
        assert '词A@B批' in ';'.join(pool(sw)['kw']), pool(sw)

        # 5b) 拖拽换批：把默认组剩下的 词D 拖到 B批 卡头上
        cfg.locator('.sx-kwgrp').nth(0).locator('[data-poolrow]').first.drag_to(
            cfg.locator('.sx-kwgrp').nth(1).locator('.sx-kwgrp-head'))
        expect(cfg.locator('.sx-kwgrp').nth(1).locator('.sx-word')).to_have_count(4, timeout=8000)
        assert '词D@B批' in ';'.join(pool(sw)['kw']), pool(sw)

        # 6) 删 B批：确认框 → 词退回默认，批次表里没 B批
        cfg.locator('.sx-kwgrp-head').nth(1).locator('[data-kwgrpdel]').click()
        expect(cfg.locator('.sx-kwgrp-head')).to_have_count(1, timeout=8000)
        assert any('删掉批次' in m for m in dialogs), dialogs
        got = pool(sw)
        assert got['batches'] == [], got
        assert all('@B批' not in x for x in got['kw']) and len(got['kw']) == 4, got

        # 7) 「＋ 批次」新弹窗：名字 + 词（实时计数）+ 周几片 → 建批即配排期，建完自动展开
        cfg.locator('#sxKwBatchAdd').click()
        kbm = page.locator('#kwBatchModal')
        expect(kbm).to_be_visible()
        kbm.locator('#kbmName').fill('装修批')
        kbm.locator('#kbmKw').fill('词E, 词F')
        expect(kbm.locator('#kbmCount')).to_have_text('已 2 个')
        kbm.locator('.kbm-day[data-kbmd="3"]').click()   # 周三
        kbm.locator('#kbmSave').click()
        expect(cfg.locator('.sx-kwgrp-head')).to_have_count(2, timeout=8000)
        got = pool(sw)
        assert got['batches'] == ['装修批'], got
        assert got['plan'].get('装修批') == [3], got
        assert '词E@装修批' in ';'.join(got['kw']) and '词F@装修批' in ';'.join(got['kw']), got
        head2 = cfg.locator('.sx-kwgrp-head').nth(1)
        expect(head2).to_contain_text('装修批')
        expect(head2).to_contain_text('周三')
        expect(cfg.locator('.sx-kwgrp').nth(1).locator('.sx-word')).to_have_count(2)

        assert not errors, errors
        print('PASS: 词池批次手风琴（展开/当前批/回车落批/弹窗预挑/行内划批/拖拽换批/删批退回默认/新弹窗建批配排期）全通过')
    finally:
        ctx.close()
