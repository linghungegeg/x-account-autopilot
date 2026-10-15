// 真实验证 3：关注（先测 alreadyFollowing 分支，再真实关注+取关）+ 浏览。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2000);

const tabId = await ext.eval(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(t => t[0]?.id ?? null)`);

const goto = async (url, ms = 10000) => {
  await ext.eval(`chrome.tabs.update(${tabId}, { url: ${JSON.stringify(url)} })`);
  await sleep(ms);
};
const probe = async fn => {
  const out = await ext.eval(`
    chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: ${fn} })
      .then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
  `);
  try { return JSON.parse(out); } catch { return out; }
};
const followState = `() => {
  const scope = document.querySelector('[data-testid="primaryColumn"]') || document;
  const un = scope.querySelector('[data-testid$="-unfollow"]');
  const fo = scope.querySelector('[data-testid$="-follow"]');
  return {
    url: location.pathname,
    following: !!un,
    notFollowing: !!fo,
    tid: (un || fo)?.getAttribute('data-testid') || null,
    aria: (un || fo)?.getAttribute('aria-label') || null
  };
}`;

// ---------------------------------------------------------------- A. 已关注分支
console.log('=== A. 对一个已关注的账号调 X_FOLLOW（应返回 alreadyFollowing，不产生动作）===');
await goto('https://x.com/LewisHamilton', 10000);
console.log('页面状态:', JSON.stringify(await probe(followState)));

const already = await ext.eval(`
  chrome.tabs.sendMessage(${tabId}, { type: 'X_FOLLOW', username: 'LewisHamilton', dryRun: false, humanize: { humanize: false } })
    .then(r => JSON.stringify(r)).catch(e => 'ERR: ' + e.message)
`);
console.log('X_FOLLOW 结果:', already);

// ---------------------------------------------------------------- B. 真实关注
console.log('\n=== B. 真实关注 @X（随后会取关）===');
await goto('https://x.com/X', 11000);
const before = await probe(followState);
console.log('关注前:', JSON.stringify(before));

if (before.following) {
  console.log('⚠️ 已经关注了，跳过（换一个目标）');
} else {
  const started = Date.now();
  const followed = await ext.eval(`
    chrome.tabs.sendMessage(${tabId}, { type: 'X_FOLLOW', username: 'X', dryRun: false, humanize: { humanize: false } })
      .then(r => JSON.stringify(r)).catch(e => 'ERR: ' + e.message)
  `);
  console.log(`耗时 ${Math.round((Date.now() - started) / 1000)}s`);
  console.log('X_FOLLOW 结果:', followed);

  await sleep(2500);
  const after = await probe(followState);
  console.log('关注后:', JSON.stringify(after));

  // ---------------------------------------------------------------- C. 取关还原
  console.log('\n=== C. 取关还原 ===');
  const undone = await ext.eval(`
    chrome.scripting.executeScript({
      target: { tabId: ${tabId} },
      func: () => {
        const scope = document.querySelector('[data-testid="primaryColumn"]') || document;
        const btn = scope.querySelector('[data-testid$="-unfollow"]');
        if (!btn) return 'no-unfollow-button';
        btn.click();
        return 'clicked';
      }
    }).then(r => r[0]?.result).catch(e => 'ERR: ' + e.message)
  `);
  console.log('点击取关:', undone);
  await sleep(3000);

  // 可能弹出确认菜单
  const confirmed = await ext.eval(`
    chrome.scripting.executeScript({
      target: { tabId: ${tabId} },
      func: () => {
        const item = [...document.querySelectorAll('[role="menuitem"]')]
          .find(i => /unfollow|取消关注/i.test(i.innerText || ''));
        if (!item) return 'no-confirm-item';
        item.click();
        return 'confirmed';
      }
    }).then(r => r[0]?.result).catch(e => 'ERR: ' + e.message)
  `);
  console.log('确认取关:', confirmed);
  await sleep(3000);
  console.log('还原后:', JSON.stringify(await probe(followState)));
}

// ---------------------------------------------------------------- D. 浏览
console.log('\n=== D. 真实浏览（滚动 + 停留）===');
await goto('https://x.com/search?q=AI&src=typed_query&f=live', 10000);
const scrollBefore = await probe(`() => ({ y: Math.round(window.scrollY), tweets: document.querySelectorAll('[data-testid="tweet"]').length })`);
console.log('浏览前:', JSON.stringify(scrollBefore));

const started = Date.now();
const browse = await ext.eval(`
  chrome.tabs.sendMessage(${tabId}, {
    type: 'X_BROWSE', scrolls: 3, pauseMinMs: 800, pauseMaxMs: 1500
  }).then(r => JSON.stringify(r)).catch(e => 'ERR: ' + e.message)
`);
console.log(`耗时 ${Math.round((Date.now() - started) / 1000)}s`);
console.log('X_BROWSE 结果:', browse);

const scrollAfter = await probe(`() => ({ y: Math.round(window.scrollY), tweets: document.querySelectorAll('[data-testid="tweet"]').length })`);
console.log('浏览后:', JSON.stringify(scrollAfter));

console.log('\n=== 结论 ===');
const a = (() => { try { return JSON.parse(already); } catch { return null; } })();
const b = (() => { try { return JSON.parse(browse); } catch { return null; } })();
console.log(a?.alreadyFollowing ? '✅ 已关注分支正确返回 alreadyFollowing' : '⚠️ alreadyFollowing 分支: ' + already);
console.log(b?.ok ? `✅ 浏览成功（滚动 ${b.scrolls} 次，页面从 y=${scrollBefore.y} 到 y=${scrollAfter.y}）` : '❌ 浏览失败: ' + (b?.error || browse));

process.exit(0);
