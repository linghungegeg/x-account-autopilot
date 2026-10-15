// 直接调内容脚本的 X_REPLY（走扩展自己的消息通道），精确验证评论流程修复。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';
const STATUS = process.env.STATUS_HREF || '/Manorgw/status/2102099037067587597';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(2500);

// 找到 x.com 的工作标签页
const findTab = `
  chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] })
    .then(tabs => JSON.stringify(tabs.map(t => ({ id: t.id, url: t.url, active: t.active }))))
`;
console.log('=== 当前 x.com 标签页 ===');
console.log(await page.eval(findTab));

// 用第一个标签页当工作页
const setup = await page.eval(`
  chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] })
    .then(async tabs => {
      if (!tabs.length) return 'ERR: 没有 x.com 标签页';
      const tab = tabs[0];
      await chrome.tabs.update(tab.id, { url: 'https://x.com${STATUS}' });
      return '已导航 tab ' + tab.id + ' 到 ' + '${STATUS}';
    })
`);
console.log(setup);
await sleep(9000);

// 确认内容脚本已注入
const ping = await page.eval(`
  chrome.tabs.query({ url: ['https://x.com/*'] }).then(async tabs => {
    try {
      const r = await chrome.tabs.sendMessage(tabs[0].id, { type: 'X_PING' });
      return JSON.stringify(r);
    } catch (e) { return 'ERR: ' + e.message; }
  })
`);
console.log('\nX_PING:', ping);

// ---------------------------------------------------------------- 调 X_REPLY
console.log(`\n>>> 发送 X_REPLY（dryRun=true，不会真提交）`);
const started = Date.now();
const result = await page.eval(`
  chrome.tabs.query({ url: ['https://x.com/*'] }).then(tabs =>
    chrome.tabs.sendMessage(tabs[0].id, {
      type: 'X_REPLY',
      statusHref: '${STATUS}',
      text: '这是一条演练用的测试评论，不会真的提交。',
      dryRun: true,
      humanize: { humanize: false }
    })
  ).then(r => JSON.stringify(r)).catch(e => 'ERR: ' + e.message)
`);
const elapsed = Math.round((Date.now() - started) / 1000);
console.log(`耗时 ${elapsed}s`);
console.log(result);

// ---------------------------------------------------------------- 页面状态
const dom = await page.eval(`
  chrome.tabs.query({ url: ['https://x.com/*'] }).then(tabs => tabs[0].id)
`);
console.log('\n工作标签页 id:', dom);

const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const xTarget = targets.find(t => t.type === 'page' && t.url.includes('x.com'));
if (xTarget) {
  const xPage = await cdp.attach(xTarget);
  const state = await xPage.eval(`(() => {
    const e = document.querySelector('[data-testid="tweetTextarea_0"]');
    return {
      url: location.pathname,
      editorText: (e?.innerText || '').trim().slice(0, 60),
      attachments: !!document.querySelector('[data-testid="attachments"]')
    };
  })()`);
  console.log('页面状态:', JSON.stringify(state, null, 2));
}

const parsed = (() => { try { return JSON.parse(result); } catch { return null; } })();
console.log('\n=== 结论 ===');
console.log(parsed?.ok ? '✅ 评论流程跑通了（演练模式，未提交）' : '❌ 仍然失败: ' + (parsed?.error || result));

process.exit(0);
