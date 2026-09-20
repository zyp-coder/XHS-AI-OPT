"""探针：确认 CDP 抓屏帧是否带 metadata.timestamp（帧捕获时刻）。"""
import asyncio, json, time
from playwright.async_api import async_playwright


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(args=['--force-device-scale-factor=1', '--hide-scrollbars'])
        page = await browser.new_page(viewport={'width': 540, 'height': 960}, device_scale_factor=1)
        cdp = await page.context.new_cdp_session(page)
        await page.goto('about:blank')
        seen = []

        async def on_frame(p):
            seen.append((time.perf_counter(), p.get('metadata', {})))
            await cdp.send('Page.screencastFrameAck', {'sessionId': p['sessionId']})

        cdp.on('Page.screencastFrame', on_frame)
        await cdp.send('Page.startScreencast', {'format': 'jpeg', 'quality': 60,
                                                'maxWidth': 540, 'maxHeight': 960, 'everyNthFrame': 1})
        await page.set_content('<body style="background:#111"><h1 id=x style="color:#eee">t</h1></body>')
        t_end = time.time() + 15
        i = 0
        while time.time() < t_end:
            await page.evaluate(f'document.getElementById("x").textContent = "t{i}"')
            await page.wait_for_timeout(60)
            i += 1
        await cdp.send('Page.stopScreencast')
        await browser.close()
    arr0, ts0 = seen[0][0], seen[0][1]['timestamp']
    a_rel, t_rel = [], []
    for arr, md in seen:
        a_rel.append(arr - arr0)
        t_rel.append(md['timestamp'] - ts0)
    print(f'帧数 {len(seen)} · 抓屏跨度 {t_rel[-1]:.2f}s · 到达跨度 {a_rel[-1]:.2f}s')
    step = max(1, len(seen) // 12)
    for i in range(0, len(seen), step):
        print(f'  t={a_rel[i]:6.2f}s  到达={a_rel[i]:6.2f}  抓屏={t_rel[i]:6.2f}  差={a_rel[i] - t_rel[i]:+.3f}')
    print('第4帧 metadata:', json.dumps(seen[3][1]))


asyncio.run(main())
