// 验证假设：后台标签页里 execCommand('insertText') 是否失效。
// 对比「后台」与「切到前台」两种情况下往发帖框写内容的结果。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const cdp = await connect({ port: PORT });

const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const xPages = targets.filter(t => t.type === 'page' && t.url.includes('x.com'));
console.log('x.com 标签页:');
xPages.forEach((t, i) => console.log(`  [${i}] ${t.url}`));

// 找一个带发帖框的页面
let page = null;
for (const t of xPages) {
  const p = await cdp.attach(t);
  const has = await p.eval(`!!document.querySelector('[data-testid="tweetTextarea_0"]')`);
  if (has) { page = p; break; }
}
if (!page) { console.log('❌ 没有带发帖框的页面'); process.exit(1); }
console.log(`\n使用: ${page.target.url}`);

const READ = `(() => {
  const e = document.querySelector('[data-testid="tweetTextarea_0"]');
  return {
    hasFocus: document.hasFocus(),
    visibility: document.visibilityState,
    text: (e?.innerText || '').trim(),
    length: (e?.innerText || '').trim().length
  };
})()`;

// 用和扩展 fillEditor 完全一样的逻辑
const FILL = text => `(() => {
  const editor = document.querySelector('[data-testid="tweetTextarea_0"]');
  if (!editor) return 'no-editor';
  editor.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editor);
  selection.removeAllRanges();
  selection.addRange(range);
  document.execCommand('delete', false);
  const ok = document.execCommand('insertText', false, ${JSON.stringify(text)});
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(text)} }));
  return 'execCommand 返回: ' + ok;
})()`;

// ---------------------------------------------------------------- 后台状态
console.log('\n=== A. 后台标签页（当前状态）===');
console.log('写之前:', JSON.stringify(await page.eval(READ)));
console.log('执行 fillEditor:', await page.eval(FILL('测试文本-BACKGROUND-12345')));
await sleep(1500);
const bg = await page.eval(READ);
console.log('写之后:', JSON.stringify(bg));
console.log(bg.length > 0 ? '  ✅ 后台也能写入' : '  ❌ 后台写入失败（编辑器仍为空）');

// ---------------------------------------------------------------- 切到前台
console.log('\n=== B. 切到前台后重试 ===');
await page.send('Page.bringToFront');
await sleep(2000);
console.log('切前台后:', JSON.stringify(await page.eval(READ)));
console.log('执行 fillEditor:', await page.eval(FILL('测试文本-FOREGROUND-67890')));
await sleep(1500);
const fg = await page.eval(READ);
console.log('写之后:', JSON.stringify(fg));
console.log(fg.length > 0 ? '  ✅ 前台能写入' : '  ❌ 前台也写不进去');

// ---------------------------------------------------------------- 清理
console.log('\n=== 清理编辑器 ===');
await page.eval(`(() => {
  const e = document.querySelector('[data-testid="tweetTextarea_0"]');
  if (!e) return false;
  e.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(e);
  sel.removeAllRanges();
  sel.addRange(range);
  document.execCommand('delete', false);
  return true;
})()`);
await sleep(1000);
console.log('清理后:', JSON.stringify(await page.eval(READ)));

console.log('\n=== 结论 ===');
if (bg.length === 0 && fg.length > 0) {
  console.log('✅ 假设成立：后台标签页写不进去，切到前台就能写');
  console.log('   → 扩展必须把工作标签页切到前台才能填内容（activateTab: true）');
} else if (bg.length > 0) {
  console.log('❌ 假设不成立：后台也能写入，失败另有原因');
} else {
  console.log('⚠️ 前台也写不进去，问题在 fillEditor 的实现方式');
}

process.exit(0);
