# -*- coding: utf-8 -*-
"""摸底：config 的 AI 配置（脱敏）+ 当前租户 + 各租户快照里 np_notes 数量。"""
import json
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, 'scripts/dev')
from _pubtest_swutil import connect, sw_eval  # noqa: E402

JS = r'''(async () => {
  const d = await chrome.storage.local.get(null);
  const c = d.config || {};
  const ai = c.ai || {};
  const out = {
    ai: {
      hasKey: !!ai.apiKey, keyLen: String(ai.apiKey || '').length,
      hasFallback: !!ai.fallbackApiKey,
      baseUrl: String(ai.baseUrl || '').slice(0, 60), model: ai.model,
      provider: ai.provider, needsHostGrant: !!ai.needsHostGrant,
    },
    current: d.current_tenant_id || null,
    tenants: (d.tenants || []).map(t => ({ id: t.id, name: t.name })),
  };
  for (const k of Object.keys(d)) {
    if (k.startsWith('tenant_data__')) {
      const snap = d[k] || {};
      out[k] = {
        npNotes: Array.isArray(snap.np_notes) ? snap.np_notes.length : 0,
        queue: snap.note_queue ? Object.keys(snap.note_queue).length : 0,
        files: snap.np_pub_files ? Object.keys(snap.np_pub_files).length : 0,
      };
    }
  }
  return out;
})()'''


def main():
    pw, b = connect()
    try:
        ctx = b.contexts[0]
        print(json.dumps(sw_eval(b, ctx, JS), ensure_ascii=False, indent=1)[:2500])
    finally:
        pw.stop()


if __name__ == '__main__':
    main()
