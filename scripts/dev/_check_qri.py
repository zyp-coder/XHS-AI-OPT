import asyncio, json, pathlib
from playwright.async_api import async_playwright

R = pathlib.Path(__file__).resolve().parents[2]
MM = 25.4 / 96


async def main():
    uri = (R / "资料/推广物料/A4传单.html").as_uri()
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        for cls, label in [(None, "黑白"), ("color", "彩色")]:
            pg = await b.new_page(viewport={"width": 900, "height": 1200})
            await pg.goto(uri)
            await pg.emulate_media(media="print")
            if cls:
                await pg.evaluate("document.body.classList.add('color')")
            await pg.wait_for_timeout(250)
            out = {}
            for sel in [".qrbox", ".qri", ".qri img", ".qri .qt", ".qri .qt span", ".contact"]:
                el = await pg.query_selector(sel)
                bb = await el.bounding_box()
                out[sel] = {k: round(v / MM, 2) for k, v in bb.items()}
            lines = await pg.evaluate(
                "()=>{const s=document.querySelector('.qri .qt span');"
                "const lh=parseFloat(getComputedStyle(s).lineHeight);"
                "return Math.round(s.getBoundingClientRect().height/lh);}"
            )
            print(label, json.dumps(out, ensure_ascii=False), "spanLines=", lines)
            await pg.close()
        await b.close()


asyncio.run(main())
