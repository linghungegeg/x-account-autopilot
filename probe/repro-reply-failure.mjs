// 逐步复现失败的评论流程，定位 assertFilled 为什么失败。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const STATUS = process.env.STATUS_HREF || '/im3mortal/status/2102099893733249041';

const cdp = await connect({ port: PORT });
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const xTarget = targets.find(t => t.type === 'page' && t.url.includes('x.com'));
const page = await cdp.attach(xTarget);
await page.send('Page.enable');

console.log(`>>> 导航到 https://x.com${STATUS}`);
await page.send('Page.navigate', { url: `https://x.com${STATUS}` });

// 等推文渲染
for (let i = 0; i < 12; i += 1) {
  await sleep(1500);
  const n = await page.eval(`document.querySelectorAll('[data-testid="tweet"]').length`);
  if (n > 0) { console.log(`  ${(i + 1) * 1.5}s 渲染出 ${n} 条推文`); break; }
}

const inspect = `(() => {
  const articles = [...document.querySelectorAll('[data-testid="tweet"]')];
  const first = articles[0];
  const editors = [...document.querySelectorAll('[data-testid="tweetTextarea_0"]')];
  return {
    url: location.pathname,
    articles: articles.length,
    firstArticleLinks: first ? [...first.querySelectorAll('a[href*="/status/"]')].map(a => a.getAttribute('href')).slice(0, 2) : [],
    firstHasReplyBtn: !!first?.querySelector('[data-testid="reply"]'),
    editors: editors.length,
    editorTexts: editors.map(e => (e.innerText || '').trim().slice(0, 30)),
    editorVisible: editors.map(e => e.getClientRects().length > 0)
  };
})()`;

console.log('\n=== 点 reply 之前 ===');
const before = await page.eval(inspect);
console.log(JSON.stringify(before, null, 2));

console.log('\n>>> 点第一条推文的 reply 按钮');
await page.eval(`(() => {
  const a = document.querySelector('[data-testid="tweet"]');
  const b = a?.querySelector('[data-testid="reply"]');
  if (b) b.click();
  return !!b;
})()`);
await sleep(2500);

console.log('\n=== 点 reply 之后 ===');
const after = await page.eval(inspect);
console.log(JSON.stringify(after, null, 2));

// 尝试写入
console.log('\n>>> 尝试用扩展的 fillEditor 逻辑写入');
const filled = await page.eval(`(() => {
  const editor = document.querySelector('[data-testid="tweetTextarea_0"]');
  if (!editor) return '找不到编辑器';
  editor.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editor);
  selection.removeAllRanges();
  selection.addRange(range);
  document.execCommand('delete', false);
  const ok = document.execCommand('insertText', false, '这是复现测试的评论内容');
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '这是复现测试的评论内容' }));
  return 'execCommand=' + ok;
})()`);
console.log(filled);
await sleep(1500);

const result = await page.eval(`(() => {
  const e = document.querySelector('[data-testid="tweetTextarea_0"]');
  return { text: (e?.innerText || '').trim(), length: (e?.innerText || '').trim().length, url: location.pathname };
})()`);
console.log('写入结果:', JSON.stringify(result));

// 清理
await page.eval(`(() => {
  const e = document.querySelector('[data-testid="tweetTextarea_0"]');
  if (!e) return;
  e.focus();
  const s = window.getSelection(); const r = document.createRange();
  r.selectNodeContents(e); s.removeAllRanges(); s.addRange(r);
  document.execCommand('delete', false);
})()`);

console.log('\n=== 结论 ===');
console.log(result.length > 0
  ? '✅ 这一步能写入 —— 说明失败不是 fillEditor 本身的问题'
  : '❌ 这一步写不进去，找到了复现路径');

process.exit(0);
