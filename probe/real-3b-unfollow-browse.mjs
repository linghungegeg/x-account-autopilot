// 还原 @X 的关注状态 + 重新验证浏览滚动修复。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);

const tabId = await ext.eval(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(t => t[0]?.id ?? null)`);

const run = (fn, args = '') => ext.eval(`
  chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: ${fn} })
    .then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
`);

const followState = `() => {
  const scope = document.querySelector('[data-testid="primaryColumn"]') || document;
  const un = scope.querySelector('[data-testid$="-unfollow"]');
  const fo = scope.querySelector('[data-testid$="-follow"]');
  return { following: !!un, tid: (un || fo)?.getAttribute('data-testid') || null, aria: (un || fo)?.getAttribute('aria-label') || null };
}`;

// ---------------------------------------------------------------- 取关 @X
console.log('=== 还原 @X 的关注状态 ===');
await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com/X' })`);
await sleep(11000);
console.log('当前:', await run(followState));

console.log('\n>>> 点击 unfollow 按钮');
console.log(await run(`() => {
  const scope = document.querySelector('[data-testid="primaryColumn"]') || document;
  const btn = scope.querySelector('[data-testid$="-unfollow"]');
  if (!btn) return 'no-button';
  btn.click();
  return 'clicked';
}`));

await sleep(2500);
console.log('弹出的菜单:', await run(`() => {
  const items = [...document.querySelectorAll('[role="menuitem"],[data-testid="confirmationSheetConfirm"],[data-testid="confirmationSheetCancel"]')];
  return items.map(i => ({ tid: i.getAttribute('data-testid'), text: (i.innerText || '').trim().slice(0, 30) }));
}`));

console.log('\n>>> 确认取关');
console.log(await run(`() => {
  const btn = document.querySelector('[data-testid="confirmationSheetConfirm"]')
    || [...document.querySelectorAll('[role="menuitem"]')].find(i => /unfollow|取消关注/i.test(i.innerText || ''));
  if (!btn) return 'no-confirm';
  btn.click();
  return 'confirmed';
}`));

await sleep(4000);
console.log('取关后:', await run(followState));

// ---------------------------------------------------------------- 重新验证浏览
console.log('\n=== 重新验证浏览（滚动修复）===');
await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com/search?q=AI&src=typed_query&f=live' })`);
await sleep(11000);

const scrollState = `() => ({ y: Math.round(window.scrollY), tweets: document.querySelectorAll('[data-testid="tweet"]').length })`;
console.log('浏览前:', await run(scrollState));

const started = Date.now();
const browse = await ext.eval(`
  chrome.tabs.sendMessage(${tabId}, { type: 'X_BROWSE', scrolls: 3, pauseMinMs: 600, pauseMaxMs: 1200 })
    .then(r => JSON.stringify(r)).catch(e => 'ERR: ' + e.message)
`);
console.log(`耗时 ${Math.round((Date.now() - started) / 1000)}s`);
console.log('X_BROWSE:', browse);

const after = await run(scrollState);
console.log('浏览后:', after);

const parsed = (() => { try { return JSON.parse(after); } catch { return null; } })();
console.log('\n=== 结论 ===');
console.log(parsed?.y > 0 ? `✅ 页面真的滚动了（scrollY=${parsed.y}）` : '❌ 仍然没滚动');

process.exit(0);
