// 实测发帖计划：批量生成（翻译 + 加权字数卡上限）→ 检查条目。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);

const errors = [];
page.on(msg => {
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push('console.error: ' + msg.params.args.map(a => a.value ?? a.description).join(' '));
});
await page.send('Runtime.enable');
await page.send('Page.enable');
await sleep(3500);

// 切到发帖计划
await page.eval(`document.querySelector('.nav button[data-pane="plan"]').click()`);
await sleep(800);

// 设成英文，填两条原文
await page.eval(`(() => {
  document.querySelector('#planLanguage').value = 'en';
  document.querySelector('#planMaxWeight').value = '280';
  document.querySelector('#planSources').value = [
    '今天把项目里那个拖了很久的缓存层重写了，代码少了三分之一，跑得还更快。有时候删代码比写代码更值。',
    '调试了三个小时，最后发现是配置文件里多了一个空格。'
  ].join('\\n');
  document.querySelector('#planSources').dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await sleep(500);
console.log('生成前提示:', await page.eval(`document.querySelector('#planGenStatus').textContent`));

console.log('\n>>> 点「批量生成」（会调中转站，可能要 10-30 秒）');
const started = Date.now();
await page.eval(`document.querySelector('#generatePlan').click()`);

for (let i = 1; i <= 40; i += 1) {
  await sleep(3000);
  const status = await page.eval(`document.querySelector('#planGenStatus').textContent`);
  const items = await page.eval(`document.querySelectorAll('#planItems .plan-item').length`);
  if (i % 3 === 0) console.log(`  ${i * 3}s  条目=${items}  ${status.slice(0, 60)}`);
  if (!/正在调用/.test(status)) break;
}
console.log(`总耗时 ${Math.round((Date.now() - started) / 1000)}s`);

console.log('\n=== 生成结果 ===');
console.log('提示:', await page.eval(`document.querySelector('#planGenStatus').textContent`));
console.log('计数:', await page.eval(`document.querySelector('#planCountLabel').textContent`));

const items = await page.eval(`[...document.querySelectorAll('#planItems .plan-item')].map(el => ({
  head: el.querySelector('.plan-head b')?.textContent,
  pill: el.querySelector('.pill')?.textContent,
  text: el.querySelector('.plan-text')?.textContent,
  meta: el.querySelector('.plan-meta')?.textContent?.slice(0, 70)
}))`);
JSON.parse(JSON.stringify(items)).forEach((item, i) => {
  console.log(`\n[${i + 1}] ${item.head}  ${item.pill}`);
  console.log(`    ${item.text}`);
  console.log(`    原文：${item.meta}`);
});

// ---------------------------------------------------------------- 顺便验证加权字数
console.log('\n=== 加权字数校验 ===');
const { weightedLength } = await import('../src/lib/guardrails.js');
for (const item of JSON.parse(JSON.stringify(items))) {
  const weight = weightedLength(item.text);
  const shown = item.head.split('·')[1]?.trim();
  console.log(`  实际 ${weight} / 显示 ${shown}  ${weight <= 280 ? '✅ 未超限' : '❌ 超限'}`);
}

console.log('\n=== 页面报错 ===');
console.log(errors.length ? errors.slice(0, 6).join('\n') : '  （无）');

process.exit(0);
