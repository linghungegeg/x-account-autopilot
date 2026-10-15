// 1. 中文的加权计数规则  2. 当前"高级"参数是否等于默认值
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

const READ_COUNTER = `() => {
  const btn = document.querySelector('[data-testid="tweetButtonInline"]');
  let scope = btn;
  for (let i = 0; i < 3 && scope?.parentElement; i += 1) scope = scope.parentElement;
  const text = (scope?.innerText || '').replace(/\\n/g, ' | ');
  const m = text.match(/(\\d+)\\s*character/i) || text.match(/(-?\\d+)\\s*\\|/) || text.match(/by\\s*(\\d+)/i);
  return { text: text.slice(0, 80), number: m ? Number(m[1]) : null };
}`;

const typeText = async t => {
  await ev(`() => {
    const e = document.querySelector('[data-testid="tweetTextarea_0"]');
    e.focus();
    const s = window.getSelection(); const r = document.createRange();
    r.selectNodeContents(e); s.removeAllRanges(); s.addRange(r);
    document.execCommand('delete', false);
    return true;
  }`);
  await sleep(400);
  await ev(`(t) => {
    const e = document.querySelector('[data-testid="tweetTextarea_0"]');
    e.focus();
    document.execCommand('insertText', false, t);
    e.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: t }));
    return true;
  }`, `[${JSON.stringify(t)}]`);
  await sleep(1000);
  return JSON.parse(await ev(READ_COUNTER));
};

console.log('=== 中文加权规则 ===');
for (const n of [139, 140, 141]) {
  const r = await typeText('中'.repeat(n));
  console.log(`  ${n} 个「中」 → ${r.text}  (解析值 ${r.number})`);
}

console.log('\n=== 中英混合 ===');
for (const t of ['a'.repeat(278) + '中', 'a'.repeat(276) + '中中', '中'.repeat(140) + 'a']) {
  const r = await typeText(t);
  console.log(`  ${t.length} 字符(${[...t].filter(c => c === '中').length}个中文) → ${r.text}`);
}

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

// ---------------------------------------------------------------- 高级参数 vs 默认
console.log('\n=== 当前行为参数 vs 代码里的默认值 ===');
const state = await ext.eval(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' })
    .then(r => JSON.stringify(r.state.behavior))
`);
const behavior = JSON.parse(state);

// 从 guardrails.js 读默认值
const { DEFAULT_BEHAVIOR } = await import('../src/lib/guardrails.js');
const diffs = [];
for (const [k, v] of Object.entries(DEFAULT_BEHAVIOR)) {
  const cur = behavior[k];
  if (JSON.stringify(cur) !== JSON.stringify(v)) diffs.push(`${k}: 当前=${JSON.stringify(cur)}  默认=${JSON.stringify(v)}`);
}
if (diffs.length) {
  console.log('与默认值不同的项:');
  diffs.forEach(d => console.log('  ' + d));
} else {
  console.log('  ✅ 完全等于默认值');
}

process.exit(0);
