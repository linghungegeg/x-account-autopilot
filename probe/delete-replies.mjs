// 删除指定的回复（按永久链接精确匹配，不碰其它内容）。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const TARGETS = (process.env.TARGETS || [
  '/linghungg/status/2102125360964157541',
  '/linghungg/status/2102124463286600102',
  '/linghungg/status/2102123699818336290'
].join(',')).split(',').map(s => s.trim()).filter(Boolean);

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);
const tabId = await ext.eval(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(l => l[0]?.id ?? null)`);

const ev = (fn, args = '[]', timeoutMs = 60000) => ext.eval(`
  chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: ${fn}, args: ${args} })
    .then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
`, { timeoutMs });

for (const href of TARGETS) {
  console.log(`\n>>> ${href}`);
  await ext.eval(`chrome.tabs.update(${tabId}, { url: ${JSON.stringify(`https://x.com${href}`)} })`);
  await sleep(13000);

  // 注意：ev 已经 JSON.stringify 过一次，页面函数直接返回对象即可，别再 stringify
  const found = JSON.parse(await ev(`(h) => {
    const a = document.querySelector('[data-testid="tweet"]');
    const link = [...(a?.querySelectorAll('a[href*="/status/"]') || [])].map(x => x.getAttribute('href')).find(x => /\\/status\\/\\d+$/.test(x));
    return { onPage: location.pathname, firstTweetLink: link, matches: link === h };
  }`, `[${JSON.stringify(href)}]`));
  console.log('  页面检查:', JSON.stringify(found));
  if (!found.matches) { console.log('  ⚠️ 链接不匹配，跳过以免误删'); continue; }

  // 点 caret -> 删除 -> 确认
  const opened = JSON.parse(await ev(`() => {
    const caret = document.querySelector('[data-testid="tweet"]')?.querySelector('[data-testid="caret"]');
    if (!caret) return 'no-caret';
    caret.click();
    return 'opened';
  }`));
  if (opened !== 'opened') { console.log('  打不开菜单:', opened); continue; }
  await sleep(1800);

  const clicked = JSON.parse(await ev(`() => {
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(i => /^delete|删除/i.test((i.innerText || '').trim()));
    if (!item) return 'no-delete-item';
    item.click();
    return 'clicked';
  }`));
  console.log('  删除菜单:', clicked);
  await sleep(1800);

  const confirmed = JSON.parse(await ev(`() => {
    const b = document.querySelector('[data-testid="confirmationSheetConfirm"]');
    if (!b) return 'no-confirm';
    b.click();
    return 'deleted';
  }`));
  console.log('  确认:', confirmed);
  await sleep(4000);
}

// 复查
console.log('\n=== 复查 /with_replies ===');
await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com/linghungg/with_replies' })`);
await sleep(15000);
const left = await ev(`() => [...document.querySelectorAll('[data-testid="tweet"]')].map(a => {
  const link = [...a.querySelectorAll('a[href*="/status/"]')].map(x => x.getAttribute('href')).find(h => /\\/status\\/\\d+$/.test(h)) || '';
  return link.startsWith('/linghungg/') ? link + '  ' + (a.querySelector('[data-testid="tweetText"]')?.innerText || '').replace(/\\n/g, ' ').slice(0, 40) : null;
}).filter(Boolean)`);
JSON.parse(left).forEach(l => console.log('  ' + l));

process.exit(0);
