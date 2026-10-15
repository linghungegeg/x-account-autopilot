// X 页面内容脚本：负责所有真实 DOM 操作，并在操作后做结果验证。
// 关键原则：
//   1. 点完按钮必须确认状态真的变了，否则一律当失败上报，绝不假装成功。
//   2. 检测到验证码/风控就立刻上报，由后台停机，绝不硬闯。

(() => {
  if (window.__xHelperInjected) return;
  window.__xHelperInjected = true;

  // ------------------------------------------------------------ 消息入口

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message?.type) {
      case 'X_PING':
        sendResponse({
          ok: true,
          url: location.href,
          ready: true,
          account: readAccount(),
          challenge: detectChallenge()
        });
        return;
      case 'X_GET_STATE':
        sendResponse(getState());
        return;
      case 'X_SCAN_SEARCH':
        scanSearchResults(message)
          .then(sendResponse)
          .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
        return true;
      case 'X_SCAN_INTENT':
        scanIntentSearch(message)
          .then(sendResponse)
          .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
        return true;
      case 'X_CHECK_CHALLENGE':
        sendResponse({ ok: true, challenge: detectChallenge() });
        return;
      case 'X_CLEAR_DRAFT':
        clearDraft();
        sendResponse({ ok: true });
        return;
      case 'X_PANEL':
        renderPanel(message.payload);
        sendResponse({ ok: true });
        return;
      case 'X_PANEL_OPEN':
        ensurePanel();
        setDrawerOpen(true);
        sendResponse({ ok: true });
        return;
      default:
        break;
    }

    const handlers = {
      X_REPLY: () => replyToTweet(message),
      X_LIKE: () => likeTweet(message),
      X_FOLLOW: () => followAuthor(message),
      X_POST: () => postToX(message),
      X_BROWSE: () => browseTimeline(message)
    };
    const handler = handlers[message?.type];
    if (!handler) {
      sendResponse({ ok: false, error: `内容脚本不支持 ${message?.type}` });
      return;
    }
    handler()
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  });

  // ------------------------------------------------------------ 账号与风控

  // 实测结论（probe/live-account.mjs）：SideNav_AccountSwitcher_Button 是个纯头像按钮，
  // innerText / textContent 都是空字符串，取不到昵称和 handle。
  // 可靠来源有两个：AppTabBar_Profile_Link 的 href，以及头像容器的 testid 后缀。
  function readAccount() {
    const profileLink = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
    const button = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    const avatarContainer = button?.querySelector('[data-testid^="UserAvatar-Container-"]');
    const image = button?.querySelector('img');

    const handle = (profileLink?.getAttribute('href') || '').replace(/^\//, '')
      || (avatarContainer?.getAttribute('data-testid') || '').replace('UserAvatar-Container-', '');

    if (!handle) return null;
    return {
      handle,
      name: image?.getAttribute('alt') || handle,
      avatar: image?.getAttribute('src') || ''
    };
  }

  // 只在强信号上判定风控，避免把普通推文里的词误判成验证码而白白停机
  function detectChallenge() {
    if (/^\/i\/flow\//.test(location.pathname)) {
      return `X 跳转到验证流程（${location.pathname}）`;
    }

    const frame = [...document.querySelectorAll('iframe')]
      .find(item => /arkose|captcha|hcaptcha|recaptcha/i.test(item.getAttribute('src') || ''));
    if (frame) return '页面出现人机验证';

    if (document.querySelector('[data-testid="ocfEnterTextTextInput"]')) return 'X 要求输入验证码';

    const loggedIn = !!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    if (!loggedIn && document.querySelector('[data-testid="loginButton"]')) return '登录态已失效';

    for (const node of document.querySelectorAll('[role="alert"],[role="dialog"],[data-testid="toast"]')) {
      const text = (node.innerText || '').trim();
      const hit = text.match(/unusual activity|verify your identity|确认你的身份|异常活动|账号已被锁定|暂时受限|temporarily limited|已被限制/i);
      if (hit) return `X 风控提示：${hit[0]}`;
    }

    return '';
  }

  function assertNoChallenge() {
    const reason = detectChallenge();
    if (reason) throw new Error(`风控拦截：${reason}`);
  }

  // ------------------------------------------------------------ 页面状态

  function getState() {
    const editor = document.querySelector('[data-testid="tweetTextarea_0"]');
    return {
      ok: true,
      url: location.href,
      loggedIn: !!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]'),
      account: readAccount(),
      challenge: detectChallenge(),
      editor: !!editor,
      postButton: !!document.querySelector('[data-testid="tweetButtonInline"]'),
      fileInput: !!document.querySelector('[data-testid="fileInput"]'),
      counts: {
        tweets: document.querySelectorAll('[data-testid="tweet"]').length,
        replies: document.querySelectorAll('[data-testid="reply"]').length,
        likes: document.querySelectorAll('[data-testid="like"]').length
      }
    };
  }

  // 实测（probe/check-search-render.mjs）：导航到搜索页后，页面 status 立刻是 complete，
  // 但推文列表要第 6 秒左右才渲染出来。X 是 SPA，页内路由不触发重新加载，
  // 所以不能靠 tab.status 判断"可以扫了"，必须等元素真的出现。
  async function scanSearchResults({ waitMs = 15000 } = {}) {
    if (!location.pathname.startsWith('/search')) return { ok: false, error: '请先打开关键词搜索页' };

    const started = Date.now();
    while (Date.now() - started < waitMs && !document.querySelector('[data-testid="tweet"]')) {
      await wait(400);
    }

    const results = [...document.querySelectorAll('[data-testid="tweet"]')]
      .map(article => {
        const statusLink = [...article.querySelectorAll('a[href*="/status/"]')]
          .find(link => /\/status\/\d+/.test(link.getAttribute('href') || ''));
        const text = article.querySelector('[data-testid="tweetText"]')?.innerText?.trim() || '';
        const authorLink = [...article.querySelectorAll('a[href^="/"]')]
          .find(link => /^\/[^/]+$/.test(link.getAttribute('href') || ''));
        if (!statusLink || !text) return null;
        return {
          text,
          statusHref: (statusLink.getAttribute('href') || '').split('?')[0],
          author: authorLink?.getAttribute('href')?.slice(1) || ''
        };
      })
      .filter(Boolean)
      .slice(0, 20);

    if (!results.length) {
      return { ok: false, error: '搜索页等了 15 秒仍然没有推文，可能是关键词没有结果' };
    }
    return { ok: true, results };
  }

  // 意向采集专用扫描。和 scanSearchResults 的关键区别是【边滚边取】。
  //
  // 实测：X 的时间线是虚拟化的，划出屏幕的推文会被从 DOM 移除。
  // 同一个搜索页，初始渲染 5 条，滚到底之后 DOM 里只剩 3 条——滚完再抓会丢数据。
  // 另外不滚动时首屏只渲染约 8 条，所以旧的 scanSearchResults 里 slice(0, 20)
  // 和 scanLimit 配 12/20 永远吃不满。这里每滚一次就收一次，用 Map 按 statusHref 去重。
  async function scanIntentSearch({ scrollRounds = 3, waitMs = 15000 } = {}) {
    if (!location.pathname.startsWith('/search')) return { ok: false, error: '请先打开关键词搜索页' };

    const started = Date.now();
    while (Date.now() - started < waitMs && !document.querySelector('[data-testid="tweet"]')) {
      await wait(400);
    }

    const collected = new Map();

    const harvest = () => {
      for (const article of document.querySelectorAll('[data-testid="tweet"]')) {
        const statusLink = [...article.querySelectorAll('a[href*="/status/"]')]
          .find(link => /\/status\/\d+/.test(link.getAttribute('href') || ''));
        const text = article.querySelector('[data-testid="tweetText"]')?.innerText?.trim() || '';
        if (!statusLink || !text) continue;
        const href = (statusLink.getAttribute('href') || '').split('?')[0];
        if (!href || collected.has(href)) continue;
        const authorLink = [...article.querySelectorAll('a[href^="/"]')]
          .find(link => /^\/[^/]+$/.test(link.getAttribute('href') || ''));
        collected.set(href, {
          text,
          statusHref: href,
          author: authorLink?.getAttribute('href')?.slice(1) || '',
          // 发布时间是硬过滤依据：Latest 在结果稀少时会退化成全时段召回，
          // 实测搜出过 2022 年的帖子。没有时间戳就没法判断新旧。
          postedAt: article.querySelector('time')?.getAttribute('datetime') || ''
        });
      }
    };

    // 先回到顶部，避免上一轮的滚动位置影响本轮首屏
    window.scrollTo(0, 0);
    await wait(600);
    harvest();

    // 逐屏下滚而不是直接跳到底：跳到底会让中间那些从未渲染过的推文被整个跳过
    for (let round = 0; round < scrollRounds; round += 1) {
      window.scrollBy(0, Math.round(window.innerHeight * 0.9));
      await wait(1600);
      harvest();
    }

    return { ok: true, results: [...collected.values()] };
  }

  // 帖子详情页同样是异步渲染，findArticle 需要轮询等待
  async function waitForArticle(statusHref, timeout = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const article = findArticle(statusHref);
      if (article) return article;
      await wait(400);
    }
    return null;
  }

  // ------------------------------------------------------------ 定位工具

  function findArticle(statusHref) {
    const articles = [...document.querySelectorAll('[data-testid="tweet"]')];
    if (!articles.length) return null;

    const wanted = String(statusHref || '').split('?')[0];
    if (wanted) {
      const exact = articles.find(article => [...article.querySelectorAll('a[href*="/status/"]')]
        .some(link => (link.getAttribute('href') || '').split('?')[0] === wanted));
      if (exact) return exact;

      const id = wanted.match(/\/status\/(\d+)/)?.[1];
      if (id) {
        const byId = articles.find(article => [...article.querySelectorAll('a[href*="/status/"]')]
          .some(link => (link.getAttribute('href') || '').includes(`/status/${id}`)));
        if (byId) return byId;
      }
    }

    if (/\/status\/\d+/.test(location.pathname)) return articles[0];
    return null;
  }

  function profileScope() {
    return document.querySelector('[data-testid="primaryColumn"]') || document;
  }

  // 实测（probe/diag-offscreen.mjs）：在帖子详情页点 reply 之后，页面上有
  // 两个 composer——X 会维护一个离屏的内联回复框副本（inline_reply_offscreen）。
  // 用 document.querySelector 拿到的可能不是同一个，于是出现
  // "文字填进 A、图挂到 B、提交点的是 C"。所有 composer 查询都必须排除离屏副本。
  function isOffscreen(node) {
    return !!node?.closest('[data-testid="inline_reply_offscreen"]');
  }

  function findComposerEditor() {
    const editors = [...document.querySelectorAll('[data-testid="tweetTextarea_0"]')];
    return editors.find(node => !isOffscreen(node)) || editors[0] || null;
  }

  function findSubmitButton() {
    const candidates = [...document.querySelectorAll('[data-testid="tweetButtonInline"],[data-testid="tweetButton"]')];
    return candidates.find(node => isVisible(node) && !isOffscreen(node))
      || candidates.find(isVisible)
      || null;
  }

  function findFileInput() {
    const inputs = [...document.querySelectorAll('[data-testid="fileInput"]')];
    return inputs.find(node => !isOffscreen(node) && isVisible(node))
      || inputs.find(node => !isOffscreen(node))
      || inputs[0]
      || null;
  }

  // 实测（probe/diag-reply-focus.mjs）：回复框的媒体工具栏是"首次输入后才渲染"的，
  // 输入前 fileInput 数=0、toolbar=false；输入一个字符后 fileInput 和媒体按钮才出现。
  // 所以不能假设控件一开始就在，要等。
  async function waitForFileInput(timeout = 20000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const input = findFileInput();
      if (input) return input;
      await wait(400);
    }
    return null;
  }

  function findFollowButton(handle) {
    const scope = profileScope();
    const lower = String(handle).toLowerCase();
    return [...scope.querySelectorAll('[data-testid$="-follow"],[role="button"],button')].find(element => {
      if ((element.getAttribute('data-testid') || '').endsWith('-unfollow')) return false;
      const label = `${element.getAttribute('aria-label') || ''} ${element.innerText || ''}`.trim().toLowerCase();
      if (!label) return false;
      return label.includes(`follow @${lower}`)
        || label.includes(`关注 @${lower}`)
        || label === 'follow'
        || label === '关注';
    }) || null;
  }

  function isFollowing(handle) {
    const scope = profileScope();
    const lower = String(handle).toLowerCase();
    const unfollow = scope.querySelector('[data-testid$="-unfollow"]');
    if (!unfollow) return false;
    const label = `${unfollow.getAttribute('aria-label') || ''} ${unfollow.innerText || ''}`.toLowerCase();
    if (!label.trim()) return true;
    return label.includes(`@${lower}`) || /following|正在关注|取消关注|unfollow/.test(label);
  }

  function isVisible(element) {
    if (!element) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  }

  function isDisabled(element) {
    return !!element.disabled || element.getAttribute('aria-disabled') === 'true';
  }

  // toast 是唯一没能实测确证的 testid（X 对这些操作不弹 toast，懒加载的 chunk 也没抓到）。
  // 所以这里不做精确匹配，任何 testid 里带 toast 的都认，降低猜错的代价。
  function findToast() {
    return document.querySelector('[data-testid="toast"]')
      || document.querySelector('[data-testid*="toast" i]')
      || null;
  }

  function readBlockingReason() {
    const text = (findToast()?.innerText || '').trim();
    if (!text) return '';
    if (/rate limit|too many requests|try again|something went wrong|操作过于频繁|稍后再试|出错了|暂时无法/i.test(text)) {
      return `X 提示：${text.slice(0, 100)}`;
    }
    return '';
  }

  // ------------------------------------------------------------ 拟人化

  function hoverRandom() {
    const targets = document.querySelectorAll('[data-testid="tweet"]');
    if (!targets.length) return;
    const node = targets[Math.floor(Math.random() * targets.length)];
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = rect.left + rect.width * (0.3 + Math.random() * 0.4);
    const y = rect.top + rect.height * (0.3 + Math.random() * 0.4);
    for (const type of ['mouseover', 'mousemove']) {
      node.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    }
  }

  // 实测（probe/test-post-timing.mjs）：后台标签页里 setTimeout 被浏览器节流到约 1 秒，
  // 把一次滚动拆成很多小步、每步等一次定时器会慢到离谱——7 步就吃掉 7 秒，
  // 整个拟人化流程能跑到 151 秒（关掉只要 2 秒）。
  // 所以改成一次滚到位，只等一次短延时。
  async function smoothScrollBy(delta) {
    window.scrollBy(0, delta);
    await wait(120 + Math.random() * 200);
  }

  // 随机滚动 + 停顿 + 偶尔悬停，降低"直达目标→点击→离开"的机械感。
  // 有总时长上限：拟人化再重要也不能把一次动作拖到几分钟。
  async function humanizeSteps({ scrolls = 3, pauseMinMs = 1000, pauseMaxMs = 4000, budgetMs = 45000 } = {}) {
    const started = Date.now();
    const count = Math.max(0, Math.min(30, Number(scrolls) || 0));
    let done = 0;

    for (let index = 0; index < count; index += 1) {
      if (Date.now() - started > budgetMs) break;
      done += 1;

      await smoothScrollBy(200 + Math.random() * 600);

      // 偶尔往回看一眼，像人在回读
      if (Math.random() < 0.25) {
        await wait(300 + Math.random() * 500);
        await smoothScrollBy(-(80 + Math.random() * 200));
      }
      if (Math.random() < 0.4) hoverRandom();

      const spread = Math.max(0, pauseMaxMs - pauseMinMs);
      const pause = pauseMinMs + Math.random() * spread;
      // 剩下的预算不够就别硬等满
      const left = budgetMs - (Date.now() - started);
      await wait(Math.max(200, Math.min(pause, left)));
    }
    return done;
  }

  function humanizeOptions(source = {}) {
    if (!source.humanize) return null;
    return {
      scrolls: source.humanizeScrollMin + Math.round(Math.random() * Math.max(0, source.humanizeScrollMax - source.humanizeScrollMin)),
      pauseMinMs: Number(source.humanizePauseMinSec || 0) * 1000,
      pauseMaxMs: Number(source.humanizePauseMaxSec || 0) * 1000
    };
  }

  // ------------------------------------------------------------ 动作：浏览

  async function browseTimeline({ scrolls, pauseMinMs, pauseMaxMs }) {
    assertNoChallenge();
    const done = await humanizeSteps({ scrolls, pauseMinMs, pauseMaxMs });
    return { ok: true, browsed: true, scrolls: done };
  }

  // ------------------------------------------------------------ 动作：评论

  // 清掉编辑器里的草稿和已挂的媒体。任务卡死被作废后，页面上可能留着半截内容。
  function clearDraft() {
    const editor = findComposerEditor();
    if (editor) {
      editor.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('delete', false);
    }

    const attachments = document.querySelector('[data-testid="attachments"]');
    if (attachments) {
      const remove = [...attachments.querySelectorAll('[role="button"],[aria-label]')]
        .find(node => /remove|删除|移除/i.test(`${node.getAttribute('aria-label') || ''} ${node.innerText || ''}`));
      if (remove) remove.click();
    }
    return true;
  }

  // 刻意不支持带图评论：几次实测都没在结果里看到图，但验证方法不可靠
  // （媒体异步附上 + tweetPhoto 懒加载容易误判），出于风控考虑先不做。
  async function replyToTweet({ statusHref, text, dryRun, humanize }) {
    const content = String(text || '').trim();
    if (!content) throw new Error('评论内容为空');

    assertNoChallenge();

    const steps = humanizeOptions(humanize);
    if (steps) await humanizeSteps(steps);

    const article = await waitForArticle(statusHref);
    if (!article) throw new Error('页面上找不到目标帖子，可能还没加载完');

    const replyButton = article.querySelector('[data-testid="reply"]');
    if (replyButton) replyButton.click();

    // 点 reply 会触发客户端路由到 /compose/post，先等路由稳定再取编辑器。
    // 顺序很重要：必须先填文字——回复框的媒体工具栏要首次输入后才渲染出来。
    await wait(1200);
    await fillComposer(content);

    if (dryRun) return { ok: true, dryRun: true, text: content };

    const button = await waitForSubmitEnabled(10000);
    if (!button) throw new Error('没有找到回复提交按钮');
    if (isDisabled(button)) throw new Error('回复提交按钮当前不可用');

    button.click();
    const verified = await verifySubmission();
    if (!verified.ok) throw new Error(verified.reason);
    return { ok: true, replied: true, verified: true, text: content };
  }

  // ------------------------------------------------------------ 动作：点赞

  async function likeTweet({ statusHref, dryRun, humanize }) {
    assertNoChallenge();

    const steps = humanizeOptions(humanize);
    if (steps) await humanizeSteps(steps);

    const article = await waitForArticle(statusHref);
    if (!article) throw new Error('页面上找不到目标帖子');

    if (article.querySelector('[data-testid="unlike"]')) return { ok: true, alreadyLiked: true };

    const likeButton = article.querySelector('[data-testid="like"]');
    if (!likeButton) throw new Error('找不到点赞按钮');
    if (dryRun) return { ok: true, dryRun: true };

    likeButton.click();
    const liked = await waitFor(() => !!article.querySelector('[data-testid="unlike"]'), 8000).catch(() => false);
    if (!liked) throw new Error(readBlockingReason() || '点赞后 8 秒内未确认状态变化');
    return { ok: true, liked: true, verified: true };
  }

  // ------------------------------------------------------------ 动作：关注

  // 个人主页也是异步渲染：导航后 primaryColumn 里还没有关注按钮
  async function waitForProfile(timeout = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const scope = document.querySelector('[data-testid="primaryColumn"]');
      if (scope && (scope.querySelector('[data-testid$="-follow"]') || scope.querySelector('[data-testid$="-unfollow"]'))) {
        return true;
      }
      await wait(400);
    }
    return false;
  }

  async function followAuthor({ username, dryRun, humanize }) {
    const handle = String(username || '').replace(/^@/, '').trim();
    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw new Error('作者账号格式不正确');
    assertNoChallenge();

    await waitForProfile();
    if (isFollowing(handle)) return { ok: true, alreadyFollowing: true };

    const steps = humanizeOptions(humanize);
    if (steps) await humanizeSteps(steps);

    const button = findFollowButton(handle);
    if (!button) throw new Error(`没有找到 @${handle} 的关注按钮`);
    if (dryRun) return { ok: true, dryRun: true };

    button.click();
    const followed = await waitFor(() => isFollowing(handle), 10000).catch(() => false);
    if (!followed) throw new Error(readBlockingReason() || '关注后 10 秒内未确认状态变化');
    return { ok: true, followed: true, verified: true, username: handle };
  }

  // ------------------------------------------------------------ 动作：发帖

  async function postToX({ text, mediaDataUrl, dryRun, humanize }) {
    const content = String(text || '').trim();
    if (!content && !mediaDataUrl) throw new Error('帖子内容为空');

    assertNoChallenge();

    const steps = humanizeOptions(humanize);
    if (steps) await humanizeSteps(steps);

    // 先填文字：媒体工具栏要首次输入后才渲染出来
    if (content) {
      await fillComposer(content);
    } else {
      const editor = await waitFor(() => findComposerEditor(), 10000).catch(() => null);
      if (!editor) throw new Error('没有找到发帖编辑器');
    }
    if (mediaDataUrl) await attachMedia(mediaDataUrl);
    await wait(600);

    if (dryRun) return { ok: true, dryRun: true };

    const button = await waitForSubmitEnabled(10000);
    if (!button) throw new Error('没有找到发帖按钮');
    if (isDisabled(button)) throw new Error('发帖按钮当前不可用');

    button.click();
    const verified = await verifySubmission();
    if (!verified.ok) throw new Error(verified.reason);
    return { ok: true, posted: true, verified: true };
  }

  // ------------------------------------------------------------ 提交验证

  // 每次都重新查当前编辑器，而不是用点击前的旧引用——X 会重渲染节点，
  // 用旧引用判断 isConnected 会把"节点被替换"误判成"提交成功"。
  //
  // 窗口给 30 秒而不是 12 秒：后台标签页里 X 自己的收尾逻辑也被节流，
  // 实测发帖确实成功了，但编辑器清空发生在 12 秒之后，导致假阴性
  // （帖子发出去了，扩展却记成失败）。
  async function verifySubmission(timeout = 30000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const toastText = (findToast()?.innerText || '').trim();

      if (toastText && /rate limit|too many|try again|something went wrong|操作过于频繁|稍后再试|出错了|暂时无法/i.test(toastText)) {
        return { ok: false, reason: `X 拒绝了本次操作：${toastText.slice(0, 100)}` };
      }
      if (toastText && /sent|已发送|已发布|your post was sent/i.test(toastText)) {
        return { ok: true };
      }

      const composer = findComposerEditor();
      const stillHasText = !!composer && (composer.innerText || '').trim().length > 0;
      if (!stillHasText) return { ok: true };

      await wait(400);
    }
    return { ok: false, reason: '提交后 30 秒内编辑器仍未清空，可能被静默限流' };
  }

  // 点 reply 之后 X 会客户端路由到 /compose/post，编辑器节点被整体替换。
  // 所以不能用"点之前拿到的引用"判断是否写入成功：写进旧节点、节点随后被丢弃，
  // 读回来就是空的。这里每次重新取节点、写、再验证，失败就重试。
  // 后台标签页被节流，X 的 React 更新会慢好几秒，所以填完之后要"轮询等它反映出来"，
  // 而不是立刻判定失败再整轮重填。
  // 实测踩过：旧的 3 次整轮重试在节流下要花 60 秒，把动作总时长顶过了超时。
  const editorHasText = () => {
    const current = findComposerEditor();
    if (!current) return null;
    const text = `${current.innerText || ''}${current.textContent || ''}`.trim();
    return text.length > 0 ? current : null;
  };

  async function fillComposer(text) {
    const editor = await waitFor(() => findComposerEditor(), 15000).catch(() => null);
    if (!editor) throw new Error('没有找到发帖编辑器');

    fillEditor(editor, text);
    const first = await waitFor(editorHasText, 8000).catch(() => null);
    if (first) return first;

    // 兜底再补一次，总共不超过约 29 秒
    fillEditor(findComposerEditor() || editor, text);
    const second = await waitFor(editorHasText, 6000).catch(() => null);
    if (!second) throw new Error('内容没有成功写入编辑器，已中止提交');
    return second;
  }

  async function waitForSubmitEnabled(timeout) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const button = findSubmitButton();
      if (button && !isDisabled(button)) return button;
      await wait(400);
    }
    return findSubmitButton();
  }

  // ------------------------------------------------------------ 编辑器与图片

  function fillEditor(editor, text) {
    // 必须先滚进视口：humanize 会把页面滚下去，而 /home 的发帖框在顶部，
    // 编辑器在视口外时 focus() + execCommand 写不进去。
    // 实测踩过：scrollY=2083 导致发帖内容一直填不上，任务卡到超时。
    try {
      editor.scrollIntoView({ block: 'center', behavior: 'instant' });
    } catch {
      editor.scrollIntoView();
    }

    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('delete', false);
    document.execCommand('insertText', false, text);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }

  // 实测（probe/live-media.mjs、live-video.mjs）：
  //   - 用 DataTransfer 直接给 fileInput 赋 File + 派发 input/change，X 确实会收下并上传
  //   - 图片上传约 1-2 秒；视频要服务端转码，实测进度条超过 80 秒
  //   - 关键：上传过程中"提交"按钮会提前变可用（实测 12 秒时就解禁了），
  //     所以不能只看按钮状态，必须等附件节点出现且进度条消失
  async function attachMedia(dataUrl, { acceptTimeout = 30000 } = {}) {
    const input = await waitForFileInput(20000);
    if (!input) throw new Error('没有找到媒体上传控件（回复框需要先输入内容才会显示工具栏）');

    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const type = blob.type || 'image/png';

    // X 的 fileInput 有 accept 白名单，格式不对会被静默拒收，这里提前拦下来给出明确报错
    const accept = (input.getAttribute('accept') || '').split(',').map(item => item.trim()).filter(Boolean);
    if (accept.length && !accept.includes(type)) {
      throw new Error(`X 不接受这种媒体格式（${type}），它只接受 ${accept.join(' / ')}`);
    }

    const isVideo = type.startsWith('video/');
    const extension = (type.split('/')[1] || 'bin').replace('quicktime', 'mov').replace('jpeg', 'jpg');
    const file = new File([blob], `x-auto-media.${extension}`, { type });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // 1) 等附件节点出现，说明 X 真的收下了这个文件
    const attached = await waitFor(() => document.querySelector('[data-testid="attachments"]'), acceptTimeout).catch(() => null);
    if (!attached) throw new Error('媒体没有被 X 接收：附件区一直没出现内容');

    // 2) 等预览真的渲染出来（有 img/video 且 src 非空），再给上传一点时间落定。
    //    注意：不能用 progressBar-bar 判断上传是否完成——实测它属于离屏内联回复框
    //    （inline_reply_offscreen），宽度一直是 0% 且始终存在，永远等不到它消失。
    await waitFor(() => {
      const node = document.querySelector('[data-testid="attachments"]');
      const media = node?.querySelector('img,video');
      return media && (media.getAttribute('src') || '').length > 0;
    }, acceptTimeout).catch(() => null);
    await wait(isVideo ? 3000 : 1200);

    return { type, isVideo, size: blob.size, stillProcessing: !!document.querySelector('[data-testid="progressBar-bar"]') };
  }

  // ------------------------------------------------------------ 控制台面板

  let panelHost = null;
  let panelNodes = null;
  let drawerOpen = false;
  let activeTab = 'queue';
  let lastPayload = null;

  const STATUS_LABELS = {
    pending: '待执行',
    running: '进行中',
    done: '成功',
    failed: '失败'
  };
  const STATUS_CLASS = {
    pending: 'blue',
    running: 'yellow',
    done: 'green',
    failed: 'red'
  };
  const TYPE_LABELS = { browse: '浏览', like: '点赞', reply: '评论', follow: '关注', post: '发帖' };
  // 内容脚本是普通脚本不能 import guardrails.js，图标表在这里单独维护一份。
  // 用内联 SVG 而不是 emoji：不依赖系统字体、可继承颜色、渲染一致。
  const ICON = path => `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`;
  const ACTION_ICONS = {
    browse: ICON('M12 5c-5 0-9 4.2-9 7s4 7 9 7 9-4.2 9-7-4-7-9-7zm0 11a4 4 0 110-8 4 4 0 010 8zm0-6a2 2 0 100 4 2 2 0 000-4z'),
    like: ICON('M12 21s-7.6-4.7-9.4-9.1A5.4 5.4 0 0112 5.6a5.4 5.4 0 019.4 6.3C19.6 16.3 12 21 12 21z'),
    reply: ICON('M4 4h16a2 2 0 012 2v9a2 2 0 01-2 2H9l-5 4V6a2 2 0 012-2z'),
    follow: ICON('M12 4a1 1 0 011 1v6h6a1 1 0 010 2h-6v6a1 1 0 01-2 0v-6H5a1 1 0 010-2h6V5a1 1 0 011-1z'),
    post: ICON('M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zm1 12h14l-4.5-6-3.5 4.5-2.5-3L5 17z')
  };

  function ensurePanel() {
    if (panelHost?.isConnected) return;

    panelHost = document.createElement('div');
    panelHost.id = 'x-helper-panel-host';
    panelHost.style.cssText = 'position:fixed;z-index:2147483647;top:0;right:0;height:100vh;pointer-events:none;';
    const shadow = panelHost.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        .root {
          font: 12px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;
          color: #e7e9ea; pointer-events: auto;
          display: flex; align-items: flex-start; height: 100%;
        }
        .handle {
          align-self: center; display: flex; align-items: center; gap: 6px;
          padding: 10px 9px; border: 0; cursor: pointer;
          border-radius: 10px 0 0 10px; background: rgba(16,18,20,.94);
          color: #e7e9ea; font: inherit; font-weight: 600;
          writing-mode: vertical-rl; letter-spacing: .12em;
          box-shadow: -4px 0 18px rgba(0,0,0,.45); border: 1px solid rgba(255,255,255,.08);
        }
        .handle[hidden] { display: none; }
        .handle .spinner { width: 10px; height: 10px; border-width: 1.5px; }
        .handle .spinner[hidden] { display: none; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #6b7280; flex: none; }
        .dot.on { background: #1d9bf0; box-shadow: 0 0 8px #1d9bf0; }
        .dot.warn { background: #f59e0b; }
        .dot.err { background: #ef4444; box-shadow: 0 0 8px #ef4444; }
        .drawer {
          width: 360px; height: 100%; display: flex; flex-direction: column;
          background: #000; border-left: 1px solid #2f3336; box-shadow: -12px 0 40px rgba(0,0,0,.6);
        }
        .drawer[hidden] { display: none; }
        .head { padding: 13px 14px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #2f3336; }
        .head .left { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 13.5px; }
        .head .right { display: flex; align-items: center; gap: 8px; }
        .pill { font-size: 10.5px; padding: 2px 8px; border-radius: 999px; font-weight: 600; }
        .pill.green { background: rgba(0,186,124,.15); color: #00ba7c; }
        .pill.blue { background: rgba(29,155,240,.15); color: #1d9bf0; }
        .pill.yellow { background: rgba(255,212,0,.15); color: #ffd400; }
        .pill.red { background: rgba(244,33,46,.15); color: #f4212e; }
        .close { background: none; border: 0; color: #71767b; font-size: 18px; cursor: pointer; line-height: 1; padding: 0 2px; }
        .close:hover { color: #e7e9ea; }
        .task { padding: 11px 14px; border-bottom: 1px solid #2f3336; }
        .task[hidden] { display: none; }
        .task .t1 { display: flex; align-items: center; gap: 7px; font-size: 12.5px; margin-bottom: 7px; }
        .task .t1 .spinner {
          width: 12px; height: 12px; flex: none; border-radius: 50%;
          border: 2px solid rgba(29,155,240,.3); border-top-color: #1d9bf0;
          animation: spin 900ms linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .bar { height: 5px; border-radius: 999px; background: #2a2d31; overflow: hidden; }
        .bar > i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg,#1d9bf0,#7856ff); transition: width .4s ease; }
        .pct { display: flex; justify-content: space-between; margin-top: 5px; color: #71767b; font-size: 10.5px; }
        .tabs { display: flex; border-bottom: 1px solid #2f3336; }
        .tab {
          flex: 1; text-align: center; padding: 10px 0; font-size: 12.5px; font-weight: 600;
          color: #71767b; cursor: pointer; border-bottom: 2px solid transparent; background: none; border-left: 0; border-right: 0; border-top: 0;
        }
        .tab.on { color: #e7e9ea; border-bottom-color: #1d9bf0; }
        .scroll { flex: 1; overflow-y: auto; padding: 5px 0; }
        .scroll[hidden] { display: none; }
        .qitem { padding: 10px 14px; display: flex; gap: 9px; align-items: flex-start; border-bottom: 1px solid #14171a; }
        .qitem .ic { width: 24px; height: 24px; border-radius: 8px; display: grid; place-items: center; flex: none; background: #16181c; color: #1d9bf0; }
        .qitem .ic svg { display: block; }
        .qitem .txt { flex: 1; min-width: 0; font-size: 12px; line-height: 1.45; }
        .qitem .txt .k { color: #1d9bf0; font-weight: 600; }
        .qitem .txt .tm { color: #71767b; font-size: 10.5px; display: block; margin-top: 2px; overflow-wrap: anywhere; }
        .log { padding: 6px 14px; font-size: 11.5px; font-family: ui-monospace,Consolas,monospace; line-height: 1.55; border-bottom: 1px solid #101214; }
        .log .tm { color: #71767b; margin-right: 6px; }
        .log .tag { margin-right: 5px; font-weight: 700; }
        .log.success .tag { color: #00ba7c; }
        .log.warn .tag { color: #ffd400; }
        .log.error .tag { color: #f4212e; }
        .log.info .tag { color: #1d9bf0; }
        .log em { font-style: normal; color: #c9d1d9; overflow-wrap: anywhere; }
        .tags { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 14px; }
        .tag-chip { padding: 4px 10px; border-radius: 999px; background: #16181c; border: 1px solid #2f3336; font-size: 11.5px; }
        .empty { padding: 18px 14px; color: #71767b; font-size: 11.5px; }
        .foot { padding: 11px 14px; border-top: 1px solid #2f3336; display: flex; gap: 8px; }
        .foot button {
          flex: 1; padding: 8px 0; border: 1px solid #2f3336; border-radius: 999px;
          background: transparent; color: #e7e9ea; font: inherit; font-weight: 600; cursor: pointer;
        }
        .foot button:hover { background: #16181c; }
        .foot button.primary { background: #1d9bf0; border-color: #1d9bf0; color: #fff; }
      </style>
      <div class="root">
        <button class="handle" hidden><span class="spinner" hidden></span><span class="dot"></span><span class="handle-text">养号助手</span></button>
        <div class="drawer" hidden>
          <div class="head">
            <div class="left"><span class="dot"></span><b class="state">连接中</b></div>
            <div class="right"><span class="pill blue count">—</span><button class="close" title="收起">×</button></div>
          </div>
          <div class="task" hidden>
            <div class="t1"><span class="spinner"></span><span class="task-label">—</span></div>
            <div class="bar"><i style="width:0%"></i></div>
            <div class="pct"><span class="stage">—</span><span class="percent">0%</span></div>
          </div>
          <div class="tabs">
            <button class="tab on" data-tab="queue">任务队列</button>
            <button class="tab" data-tab="logs">实时日志</button>
            <button class="tab" data-tab="keywords">关键词</button>
          </div>
          <div class="scroll" data-pane="queue"></div>
          <div class="scroll" data-pane="logs" hidden></div>
          <div class="scroll" data-pane="keywords" hidden></div>
          <div class="foot">
            <button class="toggle primary">暂停</button>
            <button class="clear">清空队列</button>
          </div>
        </div>
      </div>
    `;

    panelNodes = {
      handle: shadow.querySelector('.handle'),
      handleDot: shadow.querySelector('.handle .dot'),
      handleSpinner: shadow.querySelector('.handle .spinner'),
      handleText: shadow.querySelector('.handle-text'),
      drawer: shadow.querySelector('.drawer'),
      dot: shadow.querySelector('.head .dot'),
      state: shadow.querySelector('.state'),
      count: shadow.querySelector('.count'),
      close: shadow.querySelector('.close'),
      task: shadow.querySelector('.task'),
      taskLabel: shadow.querySelector('.task-label'),
      bar: shadow.querySelector('.bar > i'),
      stage: shadow.querySelector('.stage'),
      percent: shadow.querySelector('.percent'),
      tabs: [...shadow.querySelectorAll('.tab')],
      panes: {
        queue: shadow.querySelector('[data-pane="queue"]'),
        logs: shadow.querySelector('[data-pane="logs"]'),
        keywords: shadow.querySelector('[data-pane="keywords"]')
      },
      toggle: shadow.querySelector('.toggle'),
      clear: shadow.querySelector('.clear')
    };

    panelNodes.handle.addEventListener('click', () => setDrawerOpen(true));
    panelNodes.close.addEventListener('click', () => setDrawerOpen(false));
    for (const tab of panelNodes.tabs) {
      tab.addEventListener('click', () => {
        activeTab = tab.dataset.tab;
        syncTabs();
        if (lastPayload) renderPanes(lastPayload);
      });
    }
    panelNodes.toggle.addEventListener('click', async () => {
      const enabled = panelNodes.toggle.dataset.enabled !== 'true';
      await chrome.runtime.sendMessage({ type: 'SET_ENABLED', enabled }).catch(() => {});
    });
    panelNodes.clear.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'CLEAR_QUEUE' }).catch(() => {});
    });

    document.documentElement.append(panelHost);
  }

  function setDrawerOpen(open) {
    ensurePanel();
    drawerOpen = open;
    panelNodes.drawer.hidden = !open;
    panelNodes.handle.hidden = open;
  }

  function syncTabs() {
    for (const tab of panelNodes.tabs) tab.classList.toggle('on', tab.dataset.tab === activeTab);
    for (const [name, pane] of Object.entries(panelNodes.panes)) pane.hidden = name !== activeTab;
  }

  function renderPanel(payload) {
    if (!payload) return;
    ensurePanel();
    if (!panelNodes) return;
    lastPayload = payload;

    const { enabled, current, blockReason, challenge, total, maxPerDay, pendingCount } = payload;

    const dotClass = challenge || blockReason
      ? (challenge ? 'dot err' : 'dot warn')
      : (enabled ? 'dot on' : 'dot');

    panelNodes.dot.className = dotClass;
    panelNodes.handleDot.className = dotClass;
    // 折叠把手：干活时转圈并显示动作名，空闲时显示运行状态
    panelNodes.handleSpinner.hidden = !current;
    panelNodes.handleText.textContent = current
      ? (TYPE_LABELS[current.type] || '执行中')
      : (enabled ? '养号中' : '已暂停');

    const headline = challenge
      ? '风控停机'
      : current
        ? '运行中'
        : enabled
          ? (blockReason ? '已暂停' : '待机')
          : '已关闭';
    panelNodes.state.textContent = headline;

    const counts = total || { hour: 0, day: 0 };
    panelNodes.count.textContent = `队列 ${pendingCount || 0} · 今日 ${counts.day}/${maxPerDay || 0}`;
    // 整份替换 className 时要把 count 这个标识类带上，
    // 否则第一次渲染后就再也 querySelector('.count') 不到了
    panelNodes.count.className = `pill count ${challenge ? 'red' : enabled ? 'blue' : 'yellow'}`;

    if (current) {
      panelNodes.task.hidden = false;
      panelNodes.taskLabel.textContent = current.label || '执行中';
      const progress = Math.max(0, Math.min(100, Number(current.progress) || 0));
      panelNodes.bar.style.width = `${progress}%`;
      panelNodes.percent.textContent = `${progress}%`;
      panelNodes.stage.textContent = current.stage || '执行中';
    } else {
      panelNodes.task.hidden = true;
    }

    panelNodes.toggle.textContent = enabled ? '暂停' : '启动';
    panelNodes.toggle.dataset.enabled = String(!!enabled);

    syncTabs();
    renderPanes(payload);
  }

  function renderPanes(payload) {
    if (activeTab === 'queue') renderQueuePane(payload.queue || []);
    else if (activeTab === 'logs') renderLogsPane(payload.logs || []);
    else renderKeywordsPane(payload.keywords || []);
  }

  function renderQueuePane(queue) {
    const pane = panelNodes.panes.queue;
    const items = [...queue].reverse().slice(0, 40);
    if (!items.length) {
      pane.replaceChildren(emptyNode('队列为空，调度器扫描关键词后会自动补充'));
      return;
    }

    pane.replaceChildren(...items.map(task => {
      const row = document.createElement('div');
      row.className = 'qitem';

      const icon = document.createElement('div');
      icon.className = 'ic';
      icon.innerHTML = ACTION_ICONS[task.type] || '';

      const text = document.createElement('div');
      text.className = 'txt';
      const title = document.createElement('div');
      const kind = document.createElement('span');
      kind.className = 'k';
      kind.textContent = TYPE_LABELS[task.type] || task.type;
      title.append(kind, document.createTextNode(` ${taskLabel(task)}`));
      const meta = document.createElement('span');
      meta.className = 'tm';
      meta.textContent = task.status === 'failed' && task.result
        ? task.result
        : `${STATUS_LABELS[task.status] || task.status} · ${timeAgo(task.finishedAt || task.createdAt)}`;
      text.append(title, meta);

      const pill = document.createElement('span');
      pill.className = `pill ${STATUS_CLASS[task.status] || 'blue'}`;
      pill.textContent = STATUS_LABELS[task.status] || task.status;

      row.append(icon, text, pill);
      return row;
    }));
  }

  function taskLabel(task) {
    const payload = task.payload || {};
    if (payload.author) return `@${payload.author}`;
    if (payload.keyword) return `#${payload.keyword}`;
    if (payload.topic) return payload.topic;
    return '';
  }

  function renderLogsPane(logs) {
    const pane = panelNodes.panes.logs;
    if (!logs.length) {
      pane.replaceChildren(emptyNode('暂无日志'));
      return;
    }
    pane.replaceChildren(...logs.slice(0, 80).map(entry => {
      const row = document.createElement('div');
      row.className = `log ${entry.level || 'info'}`;
      const time = document.createElement('span');
      time.className = 'tm';
      time.textContent = new Date(entry.at).toLocaleTimeString('zh-CN', { hour12: false });
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = `[${entry.tag || '调度'}]`;
      const message = document.createElement('em');
      message.textContent = entry.message;
      row.append(time, tag, message);
      return row;
    }));
  }

  function renderKeywordsPane(keywords) {
    const pane = panelNodes.panes.keywords;
    if (!keywords.length) {
      pane.replaceChildren(emptyNode('还没有配置关键词，去设置页添加'));
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'tags';
    wrap.append(...keywords.map(keyword => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.textContent = keyword;
      return chip;
    }));
    pane.replaceChildren(wrap);
  }

  function emptyNode(text) {
    const node = document.createElement('div');
    node.className = 'empty';
    node.textContent = text;
    return node;
  }

  function timeAgo(at) {
    if (!at) return '排队中';
    const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (seconds < 60) return `${seconds} 秒前`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟前`;
    return `${Math.round(seconds / 3600)} 小时前`;
  }

  // ------------------------------------------------------------ 通用等待

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function waitForElement(selector, timeout) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        const element = document.querySelector(selector);
        if (element) return resolve(element);
        if (Date.now() - started >= timeout) return reject(new Error(`等待 ${selector} 超时`));
        setTimeout(check, 120);
      };
      check();
    });
  }

  function waitFor(predicate, timeout) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        let value = null;
        try {
          value = predicate();
        } catch {
          value = null;
        }
        if (value) return resolve(value);
        if (Date.now() - started >= timeout) return reject(new Error('等待页面状态变化超时'));
        setTimeout(check, 120);
      };
      check();
    });
  }

  // 初始化面板
  chrome.runtime.sendMessage({ type: 'GET_PANEL' })
    .then(response => { if (response?.ok) renderPanel(response.panel); })
    .catch(() => {});
})();
