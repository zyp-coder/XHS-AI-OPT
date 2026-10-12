/**
 * visual-motif.js — 画面流派（出图工作流的第一个节点）
 *
 * 纯数据 + 纯函数：不发请求、不碰 DOM。background（importScripts）与 popup（script）两侧共用。
 *
 * 口径（2026-10-02 老板定：撤掉「清单卡片式 / 对比测评式」那一层「什么式」）：
 * 那一层一件东西在干三份活，拆开各归各位——
 *   画面上摆什么   → 本文件这一轴。只有它进 AI 那几发（挑每屏那句 / 重出分镜 / 写封面），决定「分镜」往哪儿取材；
 *                    它不进提示词尾巴（尾巴只带「怎么画」那四轴，两边各走一条通道，别互相盖）
 *   这一段话图要替你说多少 → 配文方式四档（说一次 / 辅助标注 / 整段上屏 / 只一句大字），也在本文件那张表里
 *                    （旧的那一轴叫「字量档：少字 / 中字 / 整段上屏」，问的是「往图上搬多少稿子」，问错了——2026-10-03 六十二改换轴）
 *   这一派要什么料 → 每条的 need（空串＝不用备图，字和版式本身就是画面）；缺口那一列与素材清单读它
 * 账号可以自己加流派（config.imgMotifs = [{k, take, cast, forbid, need}]）：加进来跟内置的同一张表、同一发提示词、同一排旋钮。
 *
 * 每条三句，一句管一件事（2026-10-02 五十六改：老板指出「图描述只是给文案的字配的」，根子在这三句缺一后两句）：
 *   take   长什么样——这一派的画面摆成什么样子（旧的一句，只管这个）
 *   cast   转译配方——这段文案要变成这一派里的什么具体东西（没有这句，模型一定走最省力的路：把文字排上屏）
 *   forbid 不合格的样子——这一派最常见的偷懒反例（反例比正例管用，喂给 AI 当检查）
 *   need   给人看的备料要求（不进 AI 那一发）
 */

// 内置十条：名字要短（它是列表那一行的身份），三句都是写给 AI 的，need 是给人看的
const VISUAL_MOTIFS = [
  {
    k: '真人工作场景',
    take: '画面上有一个真人在干这件事（手、屏幕、桌面同框），像随手拍的工作照；别画成产品海报，也别只摆图标。',
    cast: '先在这段里揪出一个正在发生的动作（谁在干什么、干到一半手上有什么），把它摆成那一帧：人＋手＋他操作的东西同框；旁边再放两三件这段没写、干这事一定会有的小东西（半杯水、便签、揉皱的纸、充电线）。',
    forbid: '偷懒：把这段的字排在画面中间，人缩在角落当装饰；或者只画一张空桌子和一台电脑，看不到人。',
    need: '要人物画面：让 AI 画一张，或用自己工位 / 店里的实拍',
  },
  {
    k: '界面·软件拼贴',
    take: '画面主体是软件界面（对话框、后台、编辑区）跟散落的内容拼在一起；界面上的字糊成示意，不许编真实数据与人名。',
    cast: '把这段说的操作落成界面上看得见的一屏：说清是哪个面板、点了哪个按钮、弹出什么；界面旁边贴上这段真正涉及的那份内容（一串对话、一张列表、一格表格），再圈出要看的那一处。',
    forbid: '偷懒：把这段文案原句塞进界面的输入框当内容；或者只画一个通用 App 外壳，看不出这段在讲哪个操作。',
    need: '要自己的真实截图（先想好截哪个界面、圈哪一处）',
  },
  {
    k: '方案页',
    take: '画面做成一页方案：一句标题 + 分点 / 表格 / 框，像拿给客户看的那一页；信息全在字和格子里，别塞装饰图。',
    cast: '把这段拆成一页给客户看的方案：顶上那句结论用这段的主张（不是抄首句），下面开 2~4 个格子装这段的实际内容——是步骤就编号、是对照就上表、提到东西就列名目；字怎么分格照这段的逻辑走，不是照句子顺序切。',
    forbid: '偷懒：把这段原文一行一行排在标题底下加个底色——那还是正文，不是方案页。',
    need: '',
  },
  {
    k: '抽象图形符号',
    take: '只用图形符号讲这件事（圆、箭头、色块、比例、图标），不出现人脸和具体场景；一张只讲一个关系。',
    cast: '先在这段里找出一个关系（谁多谁少、谁先谁后、谁包含谁、此消彼长），只用图形把这一个关系画出来：块的大小、箭头的方向、位置的远近都要对应这段说的事实，一格配一句短话。',
    forbid: '偷懒：随手摆几个圆和箭头当氛围，跟这段的关系对不上号；或者退回去又排成文字清单。',
    need: '',
  },
  {
    k: '剧情梗·前后对比',
    take: '画成一幕有冲突的小剧情（两个人 / 两次对话 / 改前改后），左右或上下对照，一眼看出差别。',
    cast: '给这段找一个对手：老办法对新办法、用前对用后、客户对同事、上次的你对这次的你；一边演这段说的麻烦，另一边演这段说的那个转折，两边的差别要正好落在这段真正讲的那一点上。',
    forbid: '偷懒：左右两块内容其实一样、只是复制了两遍；或者只画一个状态、根本没有对照。',
    need: '',
  },
  {
    k: '数据·截图实证',
    take: '画面就是一张实证：数字、清单、后台截图、前后数值。只放已经真实存在的数据，拿不到就写「缺这张的实证」，绝不许编数字。',
    cast: '把这段里每一个说得出口、能核的东西都落成一张实证：提到数量就单独立一块大字、提到清单就摆成后台里的那一列、提到效果就画前后两条数值对着；这段没给的具体数值，就在描述里明写「缺：要客户自己补的那一样」，等人补料。',
    forbid: '偷懒：编一个看着合理的数字或假截图；或者把这段文字排成"数据风"的样子的，其实一个真数都没有。',
    need: '必须有真截图 / 真数据；拿不到就这一张明说缺料，别编',
  },
  {
    k: '手写笔记·纸感',
    take: '像手写在本子或便利贴上的那一页：手抄标题、划线、圈重点，纸感底；别排得太整齐，太整齐就不像手写的。',
    cast: '当成你自己在笔记本上记这段：手抄那一句要写这段的结论（不是首句），关键那个词圈出来、那句话划一道线；页边留一条竖着的小批注，写这段没写但干过这行的人都会补的那一句。',
    forbid: '偷懒：印刷体排得整整齐齐再压一层纸纹；或者把整段原文照抄满一页。',
    need: '',
  },
  {
    k: '实物摆拍·俯拍平铺',
    take: '俯拍一张摊开的实物场面（东西、材料、工具摆全），留出放字的位置；别拍成单品广告图。',
    cast: '把这段涉及的东西一件件摊开俯拍：每一件都得是这段点到的、或干这事一定用得上的实物，摆成有主有次的一堆（主角占一处、配角散开），边角留一块空白放那句话。',
    forbid: '偷懒：只把一件产品居中打光当广告图，这段说的过程、材料、搭配全看不见。',
    need: '要有实物可拍（实体类目才走这一派）',
  },
  {
    k: '流程·结构示意',
    take: '画成流程或结构：几步、箭头、时间轴或分支，每格一句话，顺序要一眼读完；别配无关的氛围图。',
    cast: '把这段拆成几步、每格一个动作＋一句短说明，箭头按这段真正的先后走；有分支或有回头就把分支画出来，各格分别对应这段里的哪句话要指得回来。',
    forbid: '偷懒：三个格子写着"第一步 / 第二步 / 第三步"里面全是空话；或者把整段原文塞进一格。',
    need: '',
  },
  {
    k: '条漫·多格',
    take: '画成两三格漫画演这一段（同一角色、连续动作或一句对话），格子里的字要短；别画成一格说明图。',
    cast: '给这段编 2~3 格连着的画面：头一格演这段说的麻烦，中间一格演这段真正讲的那个动作或那句话，最后一格给结果；同一个角色从头到尾，每格只留一句短台词或一个气泡。',
    forbid: '偷懒：画一格说明图旁边配三个标题；或者三格画的是三件不相干的事，连不起来。',
    need: '',
  },
];

const MOTIF_TEXT_LIMITS = { take: 200, cast: 220, forbid: 140, need: 120 };

/** 一条流派的字段收口（内置与账号自加走同一份，别两处各写一套限长） */
function motifEntry(x) {
  if (!x || typeof x !== 'object') return null;
  const k = String(x.k || x.name || '').trim().slice(0, 16);
  if (!k) return null;
  const lim = MOTIF_TEXT_LIMITS;
  return {
    k: k,
    take: String(x.take || x.desc || '').trim().slice(0, lim.take),
    cast: String(x.cast || '').trim().slice(0, lim.cast),
    forbid: String(x.forbid || x.bad || '').trim().slice(0, lim.forbid),
    need: String(x.need || '').trim().slice(0, lim.need),
  };
}

/** 内置 ＋ 账号自己加的（同名以账号那条为准，方便把内置那三句改掉） */
function visualMotifAll(custom) {
  const out = VISUAL_MOTIFS.map(motifEntry);
  const idx = {};
  out.forEach((x, i) => { idx[x.k] = i; });
  (Array.isArray(custom) ? custom : []).forEach(x => {
    const one = motifEntry(x);
    if (!one) return;
    if (idx[one.k] >= 0) out[idx[one.k]] = one; else { idx[one.k] = out.length; out.push(one); }
  });
  return out;
}

function visualMotifOf(k, custom) {
  const s = String(k || '').trim();
  if (!s) return null;
  return visualMotifAll(custom).filter(x => x.k === s)[0] || null;
}

/** 喂 AI 的那一句只出取材规则本身：后台把它拼在「【这一套图的取材路子】」后面，
 *  名字另有「【本次画面流派】X」那一行带，别在这儿再复述一遍。没选流派＝空串。
 *  三句各带一个小标题（长什么样 / 这段要变成什么 / 这样算不合格）：五十六改之前只出 take 那一句，
 *  结果 AI 一定把分镜写成「这段文字的配图」——缺的是转译动作与反例，不是再描述一遍长相。
 *  六十改：cast 里凡涉及字，只说画面上哪一处放什么角色的字（结论／台词／标注），具体那几个字不进分镜，由本地拼提示词时接原文。 */
function visualMotifRule(k, custom) {
  const m = visualMotifOf(k, custom);
  if (!m) return '';
  const lines = [];
  if (m.take) lines.push('· 长什么样：' + m.take);
  if (m.cast) lines.push('· 这段文案要变成这一派的什么料：' + m.cast);
  if (m.forbid) lines.push('· 这样算不合格（这一派最常见的偷懒）：' + m.forbid);
  return lines.join('\n');
}

/** 给人看的那一句：这一派要备什么料（空串＝不用备图） */
function visualMotifNeed(k, custom) {
  const m = visualMotifOf(k, custom);
  return m ? m.need : '';
}

/** 那一排旋钮上的可选值（含「跟账号默认」由调用方自己加） */
function visualMotifKeys(custom) { return visualMotifAll(custom).map(x => x.k); }

/* 分镜一段回三条候选（2026-10-02 五十八改③：老板「图描述你可以多出几个，让用户选好了再出提示词」）。
   一份名字两边用：后台 🔁 那一发按它要三条、界面那三颗挑条按它标——顺序就是候选的顺序，别两边各写一套。 */
const VISUAL_DESC_ANGLES = [
  { k: '主推', d: '最贴这一段、也最贴这一派长相的那一种摆法' },
  { k: '换视角', d: '还是说这一段，换一个看得见的主体／场景（换人、换实物、换界面另一头、换前／后对照）' },
  { k: '极简', d: '画面只留一个主体、一句字，靠留白站住' },
];

/* 🖼 字位九宫格（2026-10-04 本波「字后压」，替掉旧的那格自由话「字排哪儿」）：这一屏的字块压在画面哪一格。
   它是给程序读的枚举，不是给人写的一句话——① 三处都读它，所以只此一份：
     · 生图那一发的提示词按它要求那一块留干净的底（AI 交的是不含任何可读文字的干净背景图）；
     · ⑤ 合成视图与导出按它的 x/y 把字层压上去；
     · ④ 那一行的「字位」那颗九宫格就是它。
   老档案里那句「压在右边暗角，别盖住握着笔的那只手」由 captionZoneOf 关键词映射到最接近的一格，映射完就是枚举，不再有两处说同一件事。 */
const CAPTION_ZONES = [
  { k: 'tl', t: '左上', x: 0, y: 0, d: '主体在右下、左上空着时用（斜拍桌面、人物靠右下）' },
  { k: 'tc', t: '上中', x: 1, y: 0, d: '主体站在下半屏、上面是一整片空（墙、天、留白）' },
  { k: 'tr', t: '右上', x: 2, y: 0, d: '主体在左下时用；界面截图类常把数摆在右上' },
  { k: 'ml', t: '左中', x: 0, y: 1, d: '画面右半是主体／亮屏，字竖着排左半' },
  { k: 'mc', t: '正中', x: 1, y: 1, d: '整片干净或前后对照中间那条缝；字当主角（一句金句、整段上屏）' },
  { k: 'mr', t: '右中', x: 2, y: 1, d: '主体占左半（人、手、桌上的实物在左边）' },
  { k: 'bl', t: '左下', x: 0, y: 2, d: '随手抓拍那一挂的默认：主体居中偏上，左下压暗角' },
  { k: 'bc', t: '下中', x: 1, y: 2, d: '画面上下叠、下面那条约留给字（清单、前后对照的下半）' },
  { k: 'br', t: '右下', x: 2, y: 2, d: '主体在左上时用（屏幕、纸条摆左上）' },
];
const CAPTION_ZONE_DEFAULT = { say: 'bl', label: 'tc', whole: 'mc', only: 'mc' };

/* ✨ 标识方式（老板：「要让他报哪些字重点？哪些字要加标识」）：AI 只说哪几个字、怎么标，字号颜色一律由程序按这一派推。
   『不改字的内容』——它是套在字身上的动作，所以 em 里的 w 必须是这份字里原样的一段，程序按子串找到才生效，找不到就当没报。 */
const CAPTION_EM_KINDS = [
  { k: 'hot', t: '变色', d: '这几个字用这一派的强调色，别的字全白' },
  { k: 'bold', t: '加粗', d: '这几个字重一档' },
  { k: 'tag', t: '加标识', d: '这几个字下面压一条色条／后面垫一小块色底' },
];

/* 🖋 配文方式（2026-10-03 六十二改，老板：「配文的方式也可以提炼成参数」）：这一段话，图要替你说多少。
   它替掉了旧的「字量档」（少字 / 中字 / 整段上屏）：那一轴只问「往图上搬多少稿子」，把「另写一句」「字当标注」「几乎不写字」
   全挤进「少字」一档，所以怎么拨都不对劲。四档一头一尾是两端（说一次 ↔ 几乎不写字），中间两档各有身份。
   两边共用这一份：界面画 chips 与要展开的格子读 t / d / fields，AI 那两发（🔮 切点、🔁 写字）读 capRule。
   配色与层级不在这儿（四档共用同一条规则，写在 popup 的提示词尾巴里）：换档只换字的身份，不换一整套图的长相。
   fields 是这一档有哪几格的唯一真源：界面上的格子、AI 那一发要填的字段、captionShape 收掉的残字，全读它。 */
/* 本波（2026-10-04 字后压 · 六十五改收口）：四档的 fields 里都没有『大字』——图上那句大字＝这一屏选定的那一句（④ 选句器挑的），
   稿子是真源，AI 不另写字。AI 每一档只交这一档用得上的那几样：承接／标注／小注／重点／字位。 */
const CAPTION_MODES = [
  {
    k: 'say', t: '说一次', d: '大字一句＋承接两三行，连起来读是一句完整的话', fields: ['lines', 'note', 'em', 'zone'],
    use: '常用那一档：这段里有一句站得住的结论，就想让人滑过去一眼记住它（大字给结论，承接两三行把话说圆）',
    capRule: '这一档＝「说一次」：图上那句大字就是这一屏选定的那一句（扩展自己定，你不报字、也不许改写它）；' +
      '你要给的是『承接』两到三行——围着那句大字把话说圆，跟它连起来读是一句完整的话，别另起一件事。',
    fit: '这一档图上除了那句大字还压两三行承接（整块 ≤40 字）：所以一段装一到三句都放得下，别为了字少硬把一段说的事劈成两段。',
  },
  {
    k: 'label', t: '辅助标注', d: '大字一句＋2~4 条引线标注，每条绑一个画面里的东西', fields: ['labels', 'note', 'em', 'zone'],
    use: '这段是靠画面上那几样东西说话的（屏幕里的数、圈和叉、前后对照）：字只当标注指着它们，不搬原文',
    capRule: '这一档＝「辅助标注」：大字就是这一屏选定的那一句（扩展自己定，你不报字），你只给 2~4 条『标注』，' +
      '每条都绑一个画面上看得见的具体东西（指着它写，标注短一点）；离开这张图就不成立才算标注，不算抄文案。' +
      '标注里出现的数字，要一并写进『画面里必须出现的元素』那条清单里，让画面上那个数就是它。',
    fit: '这一档的字位很紧（2~4 条标注，标注短，这些都不是这段原文）：一段一到两句、一句只说一个意思，多了画面上指不过来。',
  },
  {
    k: 'whole', t: '整段上屏', d: '段原文一字不改、按语意分行、字号统一', fields: ['em', 'zone'],
    use: '这段原文本身就想让人逐字读下去（一句金句、一份小清单）：代价是画面只能给字让位，所以一段别写长',
    capRule: '这一档＝「整段上屏」：图上就是这段原文，扩展本地自己排，一个字不改、按语意分行、各行字号统一。' +
      '这一档不用你配字（大字／承接／标注／小注都留空），你要给的是这份原文里哪几处该被点出来。',
    fit: '这一档图上就是把这段原文整段排上屏：一段最多两句、≤60 字，再长一屏排不下（要么缩成一片要么糊字）——该切的地方要切干净。',
  },
  {
    k: 'only', t: '只一句大字', d: '全页只有那一句大字（这一屏选定的那句），凭据由画面自己扛', fields: ['em', 'zone'],
    use: '画面自己就够狠（一张强图、开头那一眼、结尾收口那句）：全页只留一处字，多了反而泄气',
    capRule: '这一档＝「只一句大字」：全页只有那一句大字，它就是这一屏选定的那一句（扩展自己定，你不报字）；' +
      '承接、标注、小注一律留空，凭据必须由画面自己扛。',
    fit: '这一档全页只有一句大字（就是这一屏选定那句，这段原文其余不上屏、凭据由画面自己扛）：所以一段装两三句也没关系，别把过场那句单独切成一段。',
  },
];
const CAPTION_LIMITS = { big: 20, onlyBig: 12, line: 26, lines: 3, labelAt: 30, labelText: 24, labels: 4, note: 18, em: 4, emWord: 16 };

function captionModeOf(k) {
  const s = String(k || '').trim();
  if (!s) return null;
  for (let i = 0; i < CAPTION_MODES.length; i++) {
    const m = CAPTION_MODES[i];
    if (m.k === s || m.t === s) return m;
  }
  return null;
}
/** 那一档的默认（没选档＝说一次） */
function captionDefault() { return CAPTION_MODES[0]; }
function captionOf(k) { const m = captionModeOf(k); return m ? m.k : ''; }
function captionDef(k) { return captionModeOf(k) || captionDefault(); }
/** 喂 AI 那一发的那句（认档名也认中文档名；不认的档回空串＝不按这一档约束）。
 *  尾巴那几样（重点／小注／字位）由这一档的 fields 现推——fields 是「这一档有哪几格」的唯一真源，界面上的格子读的也是它。 */
function captionRule(k) { const m = captionModeOf(k); return m ? m.capRule + captionAiTail(m) : ''; }
/** 这一档「一屏装得下多少段原文」（🔮「AI 帮我挑每屏那句」那一发读它定每屏收几句） */
function captionFit(k) { const m = captionModeOf(k); return m ? m.fit : ''; }
const capFlat = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const capList = (v, per, max) => {
  const arr = Array.isArray(v) ? v : String(v || '').split(/[\n；;]+/);
  return arr.map(x => capFlat(per ? x.slice(0, per) : x)).filter(Boolean).slice(0, max);
};
/** 一条标注：{指着,写} ／ {at,text} 都收，别的键丢掉 */
function captionLabelShape(x) {
  if (!x || typeof x !== 'object') return null;
  const at = capFlat(x['指着'] || x.at || '').slice(0, CAPTION_LIMITS.labelAt);
  const text = capFlat(x['写'] || x.text || '').slice(0, CAPTION_LIMITS.labelText);
  return at && text ? { at: at, text: text } : null;
}
/** 认字位：枚举 key、中文名都收；收不到回 null（不猜，让调用方走这一档的默认那一格） */
function captionZone(k) {
  const s = capFlat(k);
  if (!s) return null;
  for (let i = 0; i < CAPTION_ZONES.length; i++) {
    const z = CAPTION_ZONES[i];
    if (z.k === s || z.t === s) return z;
  }
  return null;
}
function captionZoneDefault(mode) { return CAPTION_ZONE_DEFAULT[captionOf(mode)] || 'bl'; }
/** 老档案里那句自由话（「压在右边暗角，别盖住握着笔的那只手」）映射到最接近的一格：左右看「左／右」，上下看「上／下」，两个都在就当中间 */
function captionZoneGuess(s) {
  const v = String(s || '');
  const x = /左/.test(v) ? 'l' : /右/.test(v) ? 'r' : 'c';
  const up = /上|顶/.test(v), down = /下|底/.test(v);
  const y = (up && down) ? 'm' : up ? 't' : down ? 'b' : 'm';
  for (let i = 0; i < CAPTION_ZONES.length; i++) { if (CAPTION_ZONES[i].x === (x === 'l' ? 0 : x === 'r' ? 2 : 1) && CAPTION_ZONES[i].y === (y === 't' ? 0 : y === 'b' ? 2 : 1)) return CAPTION_ZONES[i].k; }
  return 'bl';
}
/** 这一屏的字块压哪儿（永远回一个合法枚举：字后压必须知道往哪儿留白，不能空着让引擎自己摆） */
function captionZoneOf(v, mode) {
  const z = captionZone(v);
  if (z) return z.k;
  const s = capFlat(v);
  return s ? captionZoneGuess(s) : captionZoneDefault(mode);
}
/** 认标识方式：枚举 key、中文名收；歪了的按关键词归一类，归不进就按「变色」（老板要的就是这几处被点出来） */
function captionEmKind(v) {
  const s = capFlat(v);
  if (!s) return 'hot';
  for (let i = 0; i < CAPTION_EM_KINDS.length; i++) { const e = CAPTION_EM_KINDS[i]; if (e.k === s || e.t === s) return e.k; }
  if (/粗|重/.test(s)) return 'bold';
  if (/标|框|条|底|贴纸|圈|号/.test(s)) return 'tag';
  return 'hot';
}
/** 重点那几处：[{字,标}] ／ [{w,k}] 都收，同一处字只留一处（后报的覆盖前报的） */
function captionEmShape(v) {
  const arr = Array.isArray(v) ? v : (v ? [v] : []);
  const out = [], seen = {};
  arr.forEach(x => {
    let w = '', k = 'hot';
    if (x && typeof x === 'object') {
      w = capFlat(x['字'] || x.w || x['重点'] || x.text);
      k = captionEmKind(x['标'] || x.k || x['怎么标']);
    } else w = capFlat(x);
    w = w.replace(/[〔〕「」『』“”]/g, '').slice(0, CAPTION_LIMITS.emWord);
    if (!w || seen[w + '|' + k]) return;
    seen[w + '|' + k] = 1;
    out.push({ w: w, k: k });
  });
  return out.slice(0, CAPTION_LIMITS.em);
}
/** 这一档「AI 那一发还要交哪几样」——由 fields 现推，别在四份 capRule 里各写一遍 */
function captionAiTail(m) {
  const f = (m && m.fields) || [];
  const bits = [];
  if (f.indexOf('em') >= 0) bits.push('『重点』＝这份字里最该被点出来的几处，每处给｛字，标｝：' +
    '「字」从这份字里原样抄出来（别改字、别加字，我按子串找到它才生效），「标」只能是「' +
    CAPTION_EM_KINDS.map(x => x.t).join(' / ') + '」里的一个，最多 ' + CAPTION_LIMITS.em + ' 处');
  if (f.indexOf('note') >= 0) bits.push('『小注』＝角落里那行小字一句（来源／口径／提醒这类，≤' + CAPTION_LIMITS.note + ' 字），没有就留空');
  if (f.indexOf('zone') >= 0) bits.push('『字位』＝这一屏的字块压在画面哪一格，只能是「' +
    CAPTION_ZONES.map(x => x.t).join(' / ') + '」里那一格，没偏好就留空（我按这一档的默认那一格补：' +
    (captionZoneTitle(captionZoneDefault(m.k))) + '）。你交的是不含任何可读文字的干净背景图，' +
    '所以那一格要留干净的底——主体与元素清单点名的凭据都别摆进那一格');
  return bits.length ? ' 这一档还要给：' + bits.join('；') + '。' : '';
}
function captionZoneTitle(k) { const z = captionZone(k); return z ? z.t : ''; }
/** 一份配文收口（AI 那一发回来的、界面上改过的、存档读回来的走同一份，别两处各写一套限长） */
function captionShape(raw) {
  const o = (raw && typeof raw === 'object') ? raw : {};
  const out = {};
  const mode = captionOf(o.mode || o['档']);
  if (mode) out.mode = mode;
  const lines = capList(o.lines || o['承接'], CAPTION_LIMITS.line, CAPTION_LIMITS.lines);
  if (lines.length) out.lines = lines;
  const labels = (Array.isArray(o.labels || o['标注']) ? (o.labels || o['标注']) : [])
    .map(captionLabelShape).filter(Boolean).slice(0, CAPTION_LIMITS.labels);
  if (labels.length) out.labels = labels;
  const note = capFlat(o.note || o['小注']).slice(0, CAPTION_LIMITS.note);
  if (note) out.note = note;
  // 老档案那份「要害」（一句自由话，≤8 字）当「重点」的一处变色收进来；新档直接给 [{字,标}]
  const emRaw = o.em || o['重点'] || o['标识'] ||
    (capFlat(o.hot || o['要害']) ? [{ w: capFlat(o.hot || o['要害']), k: 'hot' }] : null);
  const em = captionEmShape(emRaw);
  if (em.length) out.em = em;
  // 字位永远有一个合法枚举：老档那句自由话（「压在右边暗角」）映射到最接近的一格，映射完就是枚举，不再两处说同一件事
  out.zone = captionZoneOf(o.zone || o['字位'] || o.place || o['字排哪儿'], mode);
  if (mode) {                                   // 换档不留残字：这一档用不上的格子一律丢掉，界面与提示词只读 fields 里那几格
    const keep = captionModeOf(mode).fields;
    ['lines', 'labels', 'note', 'em', 'zone'].forEach(f => { if (keep.indexOf(f) < 0) delete out[f]; });
  }
  return out;
}
/** 这一格算不算写过字（🔁 只往没写过的格子里落，人写过的不顶）。
 *  字位那颗是旋钮、不是字，AI 只报了字位不算写过——不然空表一初始化就永远填不进。
 *  『大字』不算写过：图上那句就是这一屏选定的那一句，谁都没另写它。 */
function captionHas(cap) {
  const c = cap || {};
  return !!((c.lines || []).length || (c.labels || []).length || c.note || (c.em || []).length);
}

const VisualMotif = {
  VISUAL_MOTIFS,
  DESC_ANGLES: VISUAL_DESC_ANGLES,
  CAPTION_MODES,
  CAPTION_ZONES,
  CAPTION_EM_KINDS,
  CAPTION_LIMITS,
  all: visualMotifAll,
  of: visualMotifOf,
  entry: motifEntry,
  ruleOf: visualMotifRule,
  needOf: visualMotifNeed,
  keys: visualMotifKeys,
  captionOf: captionOf,
  captionDef: captionDef,
  captionDefault: captionDefault,
  captionRule: captionRule,
  captionFit: captionFit,
  captionShape: captionShape,
  captionHas: captionHas,
  zoneOf: captionZoneOf,
  zoneXY: function (k) { const z = captionZone(k); return z ? { x: z.x, y: z.y } : null; },
  zoneTitle: captionZoneTitle,
  zoneDefault: captionZoneDefault,
  emKind: captionEmKind,
  emShape: captionEmShape,
};

if (typeof module !== 'undefined') { module.exports = VisualMotif; }
