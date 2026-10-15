// 列出主页帖子，删除测试期间产生的计划帖（按内容精确匹配）。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

// 测试生成的文案（会按这个精确匹配删除）
const TEST_TEXTS = [
  'Automate repetitive tasks. The time you get back is truly yours.',
  '繰り返し作業は自動化して、浮いた時間こそ自分のために使おう。',
  '반복되는 일은 자동화하자. 그렇게 아낀 시간이야말로 진짜 내 시간이다.',
  'Automatiza las tareas repetitivas: el tiempo que recuperas vuelve a ser tuyo.',
  'Automatisiere wiederkehrende Aufgaben. Die Zeit, die du dadurch gewinnst, gehört dir.',
  'Spent three hours debugging, only to find an extra space in the config file.',
  'Finally rewrote the cache layer I’d been putting off. One-third less code, and it runs faster. Sometimes deleting code is worth more than writing it.'
];

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);
const tabId = await ext.eval(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(l => l[0]?.id ?? null)`);

const ev = (fn, args = '[]', timeoutMs = 60000) => ext.eval(`
  chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: ${fn}, args: ${args} })
    .then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
`, { timeoutMs });

// ---------------------------------------------------------------- 列出
await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com/linghungg' })`);
await sleep(16000);

const list = JSON.parse(await ev(`() => [...document.querySelectorAll('[data-testid="tweet"]')].map(a => {
  const link = [...a.querySelectorAll('a[href*="/status/"]')].map(x => x.getAttribute('href')).find(h => /\\/status\\/\\d+$/.test(h)) || '';
  return { href: link, text: (a.querySelector('[data-testid="tweetText"]')?.innerText || '').trim() };
})`));

console.log('=== 主页帖子 ===');
list.forEach((p, i) => console.log(`[${i + 1}] ${p.href}\n     ${p.text.slice(0, 60)}`));

const toDelete = list.filter(p => TEST_TEXTS.includes(p.text));
console.log(`\n=== 待删除 ${toDelete.length} 条测试帖 ===`);
toDelete.forEach(p => console.log(`  ${p.href}  ${p.text.slice(0, 40)}`));

// ---------------------------------------------------------------- 删除
for (const post of toDelete) {
  await ext.eval(`chrome.tabs.update(${tabId}, { url: ${JSON.stringify(`https://x.com${post.href}`)} })`);
  await sleep(13000);

  const ok = JSON.parse(await ev(`(h) => {
    const a = document.querySelector('[data-testid="tweet"]');
    const link = [...(a?.querySelectorAll('a[href*="/status/"]') || [])].map(x => x.getAttribute('href')).find(x => /\\/status\\/\\d+$/.test(x));
    return link === h;
  }`, `[${JSON.stringify(post.href)}]`));
  if (!ok) { console.log(`  ⚠️ ${post.href} 链接不匹配，跳过`); continue; }

  await ev(`() => { document.querySelector('[data-testid="tweet"]')?.querySelector('[data-testid="caret"]')?.click(); return true; }`);
  await sleep(1800);
  const clicked = JSON.parse(await ev(`() => {
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(i => /^delete|删除/i.test((i.innerText || '').trim()));
    if (!item) return 'no-item';
    item.click();
    return 'ok';
  }`));
  if (clicked !== 'ok') { console.log(`  ⚠️ ${post.href} 没有删除菜单项`); continue; }
  await sleep(1800);
  const confirmed = JSON.parse(await ev(`() => {
    const b = document.querySelector('[data-testid="confirmationSheetConfirm"]');
    if (!b) return 'no-confirm';
    b.click();
    return 'ok';
  }`));
  console.log(`  删除 ${post.href}: ${confirmed}`);
  await sleep(4000);
}

// ---------------------------------------------------------------- 复查
console.log('\n=== 清理后主页 ===');
await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com/linghungg' })`);
await sleep(15000);
const left = JSON.parse(await ev(`() => [...document.querySelectorAll('[data-testid="tweet"]')].map(a => (a.querySelector('[data-testid="tweetText"]')?.innerText || '').trim().slice(0, 50))`));
left.forEach(l => console.log('  ' + l));

process.exit(0);
