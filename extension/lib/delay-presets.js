/**
 * delay-presets.js — 拟人化挡位表（0~5）单一真源
 *
 * 设置页「🤖 拟人化与触达」与弹窗顶部「拟人化挡位」共用这一张表：
 * 挡位只决定停留/间隔区间（落 delay_config + delay_preset），**不再联动每轮篇数**——每轮篇数
 * 只有一个入口：同一页「💧 灌水频率与去重 → 每轮最多处理」（note_trend_config.maxPerRound，0=不限）。
 *
 * 注意：本文件被 popup.html / settings.html 以经典 <script> 引入，只用顶层 const 声明，
 *       不要写裸 window（后台脚本会整体不启动）。
 */
const DELAY_PRESETS = [
  { level:0, name:'极速 · 裸跑', short:'极速·裸跑', daily:'不限',
    desc:'不做停留与逐字输入延时，跑得最快。仅建议单篇测试用，不建议上量。批量点赞仍保留 300ms 保底间隔。',
    cfg:{ browseDwell:{min:0,max:0}, typingCharDelay:{min:0,max:0}, likeGap:{min:300,max:300}, lazyLoadWait:{min:300,max:300}, retryBackWait:{min:300,max:300}, retryOpenWait:{min:800,max:800}, noteOpenBuffer:{min:300,max:300}, preSendGap:{min:400,max:400}, batchItemGap:{min:0,max:0} } },
  { level:1, name:'轻装 · 单篇/少量', short:'轻装·少量', daily:'≤20',
    desc:'只留底线缓冲，适合快速试探或低量测试。',
    cfg:{ browseDwell:{min:500,max:1000}, typingCharDelay:{min:0,max:0}, likeGap:{min:300,max:500}, lazyLoadWait:{min:300,max:600}, retryBackWait:{min:300,max:500}, retryOpenWait:{min:800,max:1200}, noteOpenBuffer:{min:300,max:500}, preSendGap:{min:300,max:600}, batchItemGap:{min:1000,max:2000} } },
  { level:2, name:'标准拟人（推荐默认）', short:'标准拟人', daily:'≤10',
    desc:'自然浏览停留/逐字输入/点赞间隔/条间间隔，日常稳定，推荐使用。',
    cfg:{ browseDwell:{min:1200,max:2000}, typingCharDelay:{min:15,max:30}, likeGap:{min:300,max:600}, lazyLoadWait:{min:700,max:1100}, retryBackWait:{min:500,max:900}, retryOpenWait:{min:1100,max:2200}, noteOpenBuffer:{min:500,max:900}, preSendGap:{min:400,max:700}, batchItemGap:{min:4000,max:8000} } },
  { level:3, name:'保守拟人', short:'保守拟人', daily:'≤8',
    desc:'间隔拉长约一倍，加思考停顿，适合对量不敏感但求稳。',
    cfg:{ browseDwell:{min:2000,max:4000}, typingCharDelay:{min:20,max:40}, likeGap:{min:800,max:1500}, lazyLoadWait:{min:1200,max:2000}, retryBackWait:{min:900,max:1500}, retryOpenWait:{min:2000,max:3500}, noteOpenBuffer:{min:1000,max:1800}, preSendGap:{min:800,max:1200}, batchItemGap:{min:8000,max:15000} } },
  { level:4, name:'重度拟人 · 新号起步', short:'重度·新号', daily:'≤5',
    desc:'更长随机间隔，适合新号起步或流量不稳定期。',
    cfg:{ browseDwell:{min:4000,max:8000}, typingCharDelay:{min:30,max:50}, likeGap:{min:1500,max:3000}, lazyLoadWait:{min:2000,max:3500}, retryBackWait:{min:1500,max:2500}, retryOpenWait:{min:3000,max:5000}, noteOpenBuffer:{min:1800,max:3000}, preSendGap:{min:1200,max:2000}, batchItemGap:{min:15000,max:30000} } },
  { level:5, name:'极致从容', short:'极致从容', daily:'≤3',
    desc:'每步都留足停顿、超长随机，单篇耗时数分钟，节奏最缓。',
    cfg:{ browseDwell:{min:8000,max:15000}, typingCharDelay:{min:40,max:80}, likeGap:{min:3000,max:6000}, lazyLoadWait:{min:3500,max:6000}, retryBackWait:{min:2500,max:4000}, retryOpenWait:{min:5000,max:8000}, noteOpenBuffer:{min:3000,max:5000}, preSendGap:{min:1500,max:2500}, batchItemGap:{min:30000,max:60000} } },
];
