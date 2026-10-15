// 找 X 的字符计数器：输入超长文本后 dump 按钮附近的 DOM。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);
const tabId = await ext.eval(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(l => l[0]?.id ?? null)`);

const ev = (fn, args = '[]') => ext.eval(`
  chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: ${fn}, args: ${args} })
    .then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
`);

await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com/home' })`);
await sleep(12000);

const type = async n => {
  await ev(`() => {
    const e = document.querySelector('[data-testid="tweetTextarea_0"]');
    e.focus();
    const s = window.getSelection(); const r = document.createRange();
    r.selectNodeContents(e); s.removeAllRanges(); s.addRange(r);
    document.execCommand('delete', false);
    return true;
  }`);
  await sleep(400);
  await ev(`(count) => {
    const e = document.querySelector('[data-testid="tweetTextarea_0"]');
    e.focus();
    const t = 'a'.repeat(count);
    document.execCommand('insertText', false, t);
    e.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: t }));
    return true;
  }`, `[${n}]`);
  await sleep(1200);
};

for (const n of [10, 279, 281]) {
  await type(n);
  console.log(`\n========== ${n} 个字符 ==========`);
  console.log(await ev(`() => {
    const btn = document.querySelector('[data-testid="tweetButtonInline"]');
    const wrap = btn?.closest('div')?.parentElement;
    // 往上两层，把按钮和计数器都包含进来
    let scope = btn;
    for (let i = 0; i < 3 && scope?.parentElement; i += 1) scope = scope.parentElement;
    return {
      scopeText: (scope?.innerText || '').replace(/\\n/g, ' | ').slice(0, 100),
      svgs: [...(scope?.querySelectorAll('svg') || [])].map(s => ({
        cls: (s.getAttribute('class') || '').slice(0, 30),
        circles: s.querySelectorAll('circle').length,
        strokeDasharray: s.querySelector('circle')?.getAttribute('stroke-dasharray'),
        strokeDashoffset: s.querySelector('circle')?.getAttribute('stroke-dashoffset'),
        stroke: s.querySelector('circle')?.getAttribute('stroke')
      })),
      spans: [...(scope?.querySelectorAll('span') || [])].map(s => (s.innerText || '').trim()).filter(Boolean).slice(0, 6)
    };
  }`));
}

// 顺便看看是不是 Premium 账号
console.log('\n=== 是否 Premium ===');
console.log(await ev(`() => ({
  premiumTab: !!document.querySelector('[data-testid="premium-signup-tab"]'),
  hasPremiumLabel: document.body.innerText.includes('Premium'),
  verified: !!document.querySelector('[data-testid="icon-verified"]')
})`));

// 清理
await ev(`() => {
  const e = document.querySelector('[data-testid="tweetTextarea_0"]');
  if (!e) return;
  e.focus();
  const s = window.getSelection(); const r = document.createRange();
  r.selectNodeContents(e); s.removeAllRanges(); s.addRange(r);
  document.execCommand('delete', false);
  return true;
}`);

process.exit(0);
