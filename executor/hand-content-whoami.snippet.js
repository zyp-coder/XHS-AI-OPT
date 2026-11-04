// 执行器专属补丁：认号（whoAmI）。主本 extension/content.js 里没有这段、也不该有；
// sync-executor.js 每次搬完主本的 content.js 后，把本片段补回 executor/content.js。
// 两段以 SPLIT-MARK 那行分隔：前半插在「串行执行包装」注释前，后半插进消息监听开头。
// 前半里的 _isSelfProfile 是「后声明覆盖主本旧版」——必须和 whoAmI 一起放，靠声明顺序生效；
// 少了这段＝认号读不出自己，所有发笔记/获客都会停在「认号没读出来」（10-30 就是这么丢的）。

  /** 页面上的「编辑资料」按钮——只有本人在自己的主页才会出现 */
  function _hasEditBtn() {
    try {
      const t = document.body ? document.body.innerText : '';
      return t.includes('编辑资料') || t.includes('编辑个人资料');
    } catch (_) { return false; }
  }

  /** 别人的主页有「关注 / 私信」按钮，自己的主页没有（只认按钮，避开统计里的「关注 12」） */
  function _hasFollowBtn() {
    try {
      for (const el of document.querySelectorAll('button')) {
        const t = String(el.textContent || '').replace(/\s+/g, '');
        if (t === '关注' || t === '已关注' || t === '互相关注' || t === '私信' || t === '发消息') return true;
      }
    } catch (_) {}
    return false;
  }

  /** 这一页看起来是不是本人的：有「编辑资料」，或者没有关注/私信按钮又写着小红书号。
   *  新版主页不一定渲染「编辑资料」，所以留这条旁证；给不给绑还要看页面 id 对不对得上（见 exec-acct-check）。 */
  function _looksOwnPage() {
    if (!_isProfileUrl()) return false;
    if (_hasEditBtn()) return true;
    try {
      const text = document.body ? document.body.innerText : '';
      return /小红书号\s*[:：]?\s*[A-Za-z0-9_-]{4,}/.test(text) && !_hasFollowBtn();
    } catch (_) { return false; }
  }

  /** 站内「我」入口指向的 id（站点按当前登录会话渲染，最可信） */
  function _mineLinkUid() {
    try {
      const anchors = [...document.querySelectorAll('a[href*="/user/profile/"]')];
      for (const a of anchors) {
        const t = String(a.textContent || '').replace(/\s+/g, '');
        if (t === '我' || t === '我的') {
          const href = String(a.getAttribute('href') || '');
          const m = href.match(/\/user\/profile\/([^/?#]+)/);
          if (m) return m[1];
        }
      }
    } catch (_) {}
    return '';
  }

  /** 登录缓存里的本人 id */
  function _cachedUid() {
    try {
      const u = localStorage.getItem('xhsu');
      if (!u) return '';
      const o = JSON.parse(u);
      return o && o.id ? String(o.id) : '';
    } catch (_) { return ''; }
  }

  /** 认自己：站内「我」入口 → 当前本人主页 → 登录缓存。
   *  三处都拿不到就返回空串——绝不拿推荐流里别人的主页链接顶替。
   *  src 说明这个 id 有多硬：nav（站点给当前登录画的入口）/ edit（本人主页上的编辑按钮）/ cache（登录缓存）。 */
  function _selfUidInfo() {
    const mine = _mineLinkUid();
    if (mine) return { uid: mine, src: 'nav' };
    if (_isProfileUrl() && _hasEditBtn()) {
      const m = location.pathname.match(/\/user\/profile\/([^/?#]+)/);
      if (m) return { uid: m[1], src: 'edit' };
    }
    const cached = _cachedUid();
    if (cached) return { uid: cached, src: 'cache' };
    return { uid: '', src: '' };
  }
  function _selfUid() { return _selfUidInfo().uid; }

  /** 是否为本人主页：页面像本人的，且 uid 与站内「我」入口/登录缓存一致（缓存可缺）。
   *  （主本旧版只要页面上出现「小红书号」就算本人——那会把别人的主页认成自己，2026-10-25 已撤；
   *   这里后声明同名函数把它覆盖掉，sync 后务必确认文件里有两处声明、后一处是本段。） */
  function _isSelfProfile() {
    if (!_looksOwnPage()) return false;
    const m = location.pathname.match(/\/user\/profile\/([^/?#]+)/);
    const uid = m ? m[1] : '';
    const mine = _mineLinkUid() || _cachedUid();
    if (!mine) return _hasEditBtn();       // 只有硬标记时，没有旁证可对
    return !!uid && uid === mine;
  }

  /** 本人主页链接：只由 _selfUid 推出来；认不出就是空串，由执行器提示手动开主页 */
  function _ownProfileUrl() {
    const uid = _selfUid();
    return uid ? 'https://www.xiaohongshu.com/user/profile/' + uid : '';
  }

  /** 认号：当前页是不是本人主页 / 读到的小红书号与内部 id / 本人 id / 是否被送到登录页 */
  function whoAmI() {
    const onOwn = _isSelfProfile();
    const prof = extractUserProfile();
    const m = location.pathname.match(/\/user\/profile\/([^/?#]+)/);
    const text = document.body ? document.body.innerText : '';
    const needLogin = /\/login/.test(location.pathname) || (!onOwn && /扫码登录/.test(text));
    return {
      ok: true,
      onOwn,
      needLogin,
      editBtn: _hasEditBtn(),
      followBtn: _hasFollowBtn(),
      looksOwn: _looksOwnPage(),
      selfUid: _selfUidInfo().uid,
      selfSrc: _selfUidInfo().src,
      xhsId: prof.xhsId || '',
      uid: m ? m[1] : '',
      name: prof.name || '',
      ownUrl: _ownProfileUrl(),
      url: location.href,
    };
  }

// [[SPLIT-MARK]]

    // ── 认号（平台绑定 2026-10-23）：返回本人主页 / 小红书号 / 内部 id / 本人 id / 是否被送到登录页 ──
    if (request.action === 'whoAmI') {
      try { sendResponse(whoAmI()); } catch (e) { sendResponse({ ok: false, error: e.message }); }
      return true;
    }
