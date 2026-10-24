  /* 执行器派单打开：等一次性通行证验完；验过就跳过新手引导（执行器包里没有引导页），
     验不过就原地不动——hand-mode 会把整页挡掉，绝不往 guide 跳。 */
  if (window.__XHS_HAND_BLOCKED__) return false;
  if (window.__XHS_HAND_PENDING__ || window.__XHS_HAND__) {
    for (let i = 0; i < 60 && !window.__XHS_HAND__; i++) {
      if (window.__XHS_HAND_BLOCKED__) return false;
      await new Promise((r) => setTimeout(r, 100));
    }
    return !!window.__XHS_HAND__;
  }
