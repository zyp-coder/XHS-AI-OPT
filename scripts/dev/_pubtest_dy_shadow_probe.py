# -*- coding: utf-8 -*-
"""抖音：(1) 合成 DragEvent 的 dataTransfer 是否被保留；(2) CDP 穿透 shadow 找 input[type=file]。"""
import sys, json, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from playwright.sync_api import sync_playwright

JS_DRAG_KEEP = r'''(() => {
  const dt = new DataTransfer();
  dt.items.add(new File(['x'], 'a.png', {type: 'image/png'}));
  const ev = new DragEvent('drop', {dataTransfer: dt, bubbles: true});
  const files = ev.dataTransfer ? ev.dataTransfer.files.length : -1;
  const types = ev.dataTransfer ? [...ev.dataTransfer.types] : [];
  return {filesAfterConstruct: files, types};
})()'''


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        for p in ctx.pages:
            if 'creator.douyin.com' in p.url and 'post' in p.url:
                p.bring_to_front()
                time.sleep(0.4)
                print('E1 drag keep:', json.dumps(p.evaluate(JS_DRAG_KEEP)))

                cdp = ctx.new_cdp_session(p)
                doc = cdp.send('DOM.getDocument', {'depth': -1, 'pierce': True})
                root_id = doc['root']['nodeId']
                try:
                    nodes = cdp.send('DOM.querySelectorAll', {'nodeId': root_id, 'selector': 'input[type=file]'})
                    print('E2 pierced input[type=file] count:', len(nodes.get('nodeIds', [])))
                    for nid in nodes.get('nodeIds', [])[:4]:
                        info = cdp.send('DOM.describeNode', {'nodeId': nid})
                        n = info['node']
                        print('  node:', n.get('nodeName'), 'attrs:', {a['name']: a['value'] for a in n.get('attributes', [])},
                              'shadowRoots:', len(n.get('shadowRoots', [])) if n.get('shadowRoots') else 0)
                except Exception as ex:
                    print('E2 err:', ex)
                cdp.detach()
                return


if __name__ == '__main__':
    main()
