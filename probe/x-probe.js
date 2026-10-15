/* ============================================================
   X (Twitter) DOM 探针  v1
   用法:
   1. 打开 https://x.com ,登录,停留在首页时间线
   2. F12 -> Console -> 粘贴本文件全部内容 -> 回车
   3. 复制打印出来的 JSON,发回给我
   只读,不改页面,不发任何网络请求。
   ============================================================ */
(() => {
  const out = { url: location.href, ts: new Date().toISOString() };

  const uniq = (a) => [...new Set(a)];

  // 1) 全站 data-testid 清单
  out.allTestIds = uniq([...document.querySelectorAll('[data-testid]')]
    .map(e => e.getAttribute('data-testid'))).sort();

  // 2) 关键元素是否存在 + 数量
  const key = [
    'tweet', 'cellInnerDiv', 'primaryColumn', 'SideNav_AccountSwitcher_Button',
    'SideNav_NewTweet_Button', 'tweetTextarea_0', 'tweetButton', 'tweetButtonInline',
    'reply', 'retweet', 'like', 'bookmark', 'caret', 'app-bar-back',
    'UserAvatar-Container', 'User-Name', 'follow', 'unfollow',
    'searchBoxOverflowButton', 'trend', 'placementTracking'
  ];
  out.keyCounts = {};
  for (const t of key) out.keyCounts[t] = document.querySelectorAll(`[data-testid="${t}"]`).length;

  // 3) 第一条推文的详细结构
  const first = document.querySelector('[data-testid="tweet"]');
  if (first) {
    const cell = first.closest('[data-testid="cellInnerDiv"]') || first;
    out.firstTweet = {
      articleTag: first.tagName,
      role: first.getAttribute('role'),
      testIdsInside: uniq([...first.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid'))).sort(),
      // 作者链接
      authorLinks: uniq([...first.querySelectorAll('a[href^="/"]')].map(a => a.getAttribute('href'))).slice(0, 12),
      // 正文
      textNode: first.querySelector('[data-testid="tweetText"]')?.innerText || null,
      // 时间
      time: first.querySelector('time')?.getAttribute('datetime') || null,
      timeParentHref: first.querySelector('time')?.closest('a')?.getAttribute('href') || null,
      // 回复框(如果有)
      hasReplyBox: !!first.querySelector('[data-testid="tweetTextarea_0"]'),
      // 操作栏按钮顺序
      actionBarOrder: [...first.querySelectorAll('[role="group"] [data-testid]')].map(e => e.getAttribute('data-testid')),
    };
  }

  // 4) 侧边栏导航项(判断是否登录)
  const nav = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
  out.loggedIn = !!nav;
  if (nav) {
    out.accountButtonAria = nav.getAttribute('aria-label');
  }

  // 5) 回复/发帖弹窗的输入框
  const editor = document.querySelector('[data-testid="tweetTextarea_0"]');
  if (editor) {
    out.editor = {
      tag: editor.tagName,
      role: editor.getAttribute('role'),
      contentEditable: editor.getAttribute('contenteditable'),
      ariaLabel: editor.getAttribute('aria-label'),
      parentChain: (() => { let p = editor, chain = []; for (let i=0;i<5&&p;i++){ chain.push(p.tagName + (p.getAttribute('data-testid')?`[${p.getAttribute('data-testid')}]`:'')); p = p.parentElement; } return chain; })(),
    };
  }

  // 6) 关注按钮的文本形态
  const followBtns = [...document.querySelectorAll('[data-testid$="follow"]')].slice(0,5);
  out.followSamples = followBtns.map(b => ({ tid: b.getAttribute('data-testid'), text: b.innerText, aria: b.getAttribute('aria-label') }));

  // 7) 页面语言 / 布局模式
  out.htmlLang = document.documentElement.lang;
  out.bodyClasses = document.body.className;

  console.log('%c=== X PROBE RESULT (copy below) ===', 'color:#1d9bf0;font-weight:bold');
  const json = JSON.stringify(out, null, 2);
  console.log(json);
  try { copy(json); console.log('%c(已复制到剪贴板)','color:#00ba7c'); } catch(e){}
  return out;
})();
