#!/usr/bin/env python3
"""一次性清理：把账本里残留的「导图」数据摘掉（2026-11-02）。

清三处：
  1. books[账号].np_notes[*].mind       —— 导图结构（MD／版本／样式）
  2. books[账号].np_notes[*].imgDocs 里 kind='mind' 的行 —— 导图那张长图
  3. books[账号].note_minds             —— 按篇的导图草稿表（整表删）

另外：note.kOut=='mind'（老的知识导图身份）落回 'img'（图文笔记）；
      原本「代发」、清完一张图都不剩的图文篇，状态退回「草稿」（待发闸口径：没图不发）。

用法：
  python3 scripts/dev/_purge_mind_store.py --file tmp/store.json --dry-run
  python3 scripts/dev/_purge_mind_store.py --file tmp/store.json --write [--report tmp/report.json]

--write 会先写同目录 .tmp 再改名（与 dev-server 落盘同一套），不直接覆盖半截。
"""
import argparse
import json
import os
import sys


def purge_book(book, acc_id, report, scope=''):
    if not isinstance(book, dict):
        return False
    changed = False

    notes = book.get('np_notes')
    if isinstance(notes, list):
        for n in notes:
            if not isinstance(n, dict):
                continue
            had_mind = 'mind' in n
            if had_mind:
                n.pop('mind', None)
                changed = True

            imgs = n.get('imgDocs')
            mind_rows = []
            if isinstance(imgs, list):
                mind_rows = [r for r in imgs if isinstance(r, dict) and r.get('kind') == 'mind']
                if mind_rows:
                    n['imgDocs'] = [r for r in imgs if not (isinstance(r, dict) and r.get('kind') == 'mind')]
                    changed = True

            if had_mind or mind_rows:
                before_status = n.get('status') or ''
                before_kout = n.get('kOut') or ''
                if before_kout == 'mind':
                    n['kOut'] = 'img'
                left_imgs = n.get('imgDocs') if isinstance(n.get('imgDocs'), list) else []
                is_img_note = (n.get('form') == '图文') or (n.get('kOut') == 'img') or (before_kout == 'mind')
                dropped = False
                if before_status == '代发' and is_img_note and not left_imgs:
                    n['status'] = '草稿'
                    dropped = True
                report.append({
                    'acct': acc_id,
                    'scope': scope,
                    'id': n.get('id'),
                    'title': (n.get('title') or n.get('topic') or '')[:40],
                    'dir': n.get('dir'), 'kOut_before': before_kout, 'kOut_after': n.get('kOut'),
                    'status_before': before_status, 'status_after': n.get('status'),
                    'mind_field': bool(had_mind), 'mind_rows': len(mind_rows),
                    'back_to_draft': dropped,
                })

    if 'note_minds' in book:
        del book['note_minds']
        changed = True

    # 多租户那份是小账本里的另一份笔记副本（tenant_data__<租户id>），同一批笔记会在这里再存一遍
    for k, v in list(book.items()):
        if isinstance(k, str) and k.startswith('tenant_data__') and isinstance(v, dict):
            if purge_book(v, acc_id, report, scope=k):
                changed = True
    return changed


def walk_other_mind(o, path, hits):
    if isinstance(o, dict):
        for k, v in o.items():
            if isinstance(k, str) and 'mind' in k.lower():
                hits.append(path + '/' + k)
            walk_other_mind(v, path + '/' + str(k), hits)
    elif isinstance(o, list):
        for i, v in enumerate(o):
            walk_other_mind(v, path + f'[{i}]', hits)


def find_mind_leftovers(o, path, out):
    if isinstance(o, dict):
        for k, v in o.items():
            p = path + '/' + str(k)
            if k in ('mind', 'note_minds'):
                out.append(p)
            if k == 'kind' and v == 'mind':
                out.append(p)
            find_mind_leftovers(v, p, out)
    elif isinstance(o, list):
        for i, v in enumerate(o):
            find_mind_leftovers(v, path + f'[{i}]', out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--file', required=True)
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--report', default='')
    args = ap.parse_args()

    if args.write == args.dry_run:
        print('二选一：--dry-run 或 --write', file=sys.stderr)
        return 2

    with open(args.file, encoding='utf-8') as f:
        store = json.load(f)

    report = []
    changed_any = False
    books = store.get('books') if isinstance(store, dict) else None
    tables_before = 0
    if isinstance(books, dict):
        tables_before = sum(1 for b in books.values() if isinstance(b, dict) and 'note_minds' in b)
        for acc_id, book in books.items():
            if purge_book(book, acc_id, report):
                changed_any = True

    leftovers = []
    walk_other_mind(store, '', leftovers)
    truly_left = []
    if isinstance(books, dict):
        for acc_id, book in books.items():
            find_mind_leftovers(book, '/books/' + acc_id, truly_left)
    other_left = [p for p in leftovers if not p.startswith('/books/')]

    summary = {
        'file': os.path.abspath(args.file),
        'mode': 'write' if args.write else 'dry-run',
        'books': len(books) if isinstance(books, dict) else 0,
        'notes_affected': len(report),
        'mind_fields': sum(1 for r in report if r['mind_field']),
        'mind_img_rows': sum(r['mind_rows'] for r in report),
        'note_minds_tables': tables_before,
        'back_to_draft': [r for r in report if r['back_to_draft']],
        'changed': changed_any,
        'leftover_mind_keys': truly_left + other_left,
        'notes': report,
    }

    if args.report:
        with open(args.report, 'w', encoding='utf-8') as f:
            json.dump(summary, f, ensure_ascii=False, indent=2)

    print(json.dumps({k: v for k, v in summary.items() if k != 'notes'}, ensure_ascii=False, indent=2))
    for r in report:
        print('  -', r['acct'], ('@' + r['scope']) if r.get('scope') else '', r['id'], r['title'],
              '| mind字段' if r['mind_field'] else '',
              f"| 导图行{r['mind_rows']}" if r['mind_rows'] else '',
              f"| {r['status_before']} → {r['status_after']}" if r['status_before'] != r['status_after'] else '')

    if args.write and changed_any:
        tmp = args.file + '.tmp'
        # 老数据里有半个代理字符（残缺表情），直接 utf-8 写会炸；backslashreplace 把它还原成 JSON 的 \udXXX 转义
        data = json.dumps(store, ensure_ascii=False).encode('utf-8', 'backslashreplace')
        with open(tmp, 'wb') as f:
            f.write(data)
        os.replace(tmp, args.file)
        print('已写回', args.file)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
