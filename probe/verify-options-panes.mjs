// 验证新版设置页：7 个分区都能渲染、无报错、日志页能取到数据。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);

const errors = [];
page.on(msg => {
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push('console.error: ' + msg.params.args.map(a => a.value ?? a.description).join(' '));
  }
});
await page.send('Runtime.enable');
await page.send('Page.enable');
await sleep(3500);

console.log('=== 导航分区 ===');
const navs = await page.eval(`[...document.querySelectorAll('.nav button[data-pane]')].map(b => ({
  pane: b.dataset.pane,
  label: b.textContent.trim(),
  hasSvg: !!b.querySelector('svg')
}))`);
console.log(JSON.stringify(navs, null, 2));

console.log('\n=== 逐个点开检查 ===');
for (const nav of JSON.parse(JSON.stringify(navs))) {
  await page.eval(`document.querySelector('.nav button[data-pane="${nav.pane}"]').click()`);
  await sleep(nav.pane === 'logs' ? 2500 : 600);
  const info = await page.eval(`(() => {
    const pane = document.querySelector('.pane[data-pane="${nav.pane}"]');
    if (!pane) return { error: '分区不存在' };
    const inputs = pane.querySelectorAll('input,select,textarea').length;
    const buttons = pane.querySelectorAll('button').length;
    return {
      hidden: pane.hidden,
      title: pane.querySelector('h2')?.textContent,
      inputs,
      buttons,
      // 检查有没有引用不存在的元素（渲染时如果缺 id 会抛错，这里看关键节点）
      hasContent: pane.textContent.trim().length > 50
    };
  })()`);
  console.log(`  ${nav.label.padEnd(8)} ${JSON.stringify(info)}`);
}

// ---------------------------------------------------------------- 日志页实测
console.log('\n=== 日志页取数 ===');
await page.eval(`document.querySelector('.nav button[data-pane="logs"]').click()`);
await sleep(3000);
console.log(await page.eval(`(() => ({
  summary: document.querySelector('#logSummary')?.textContent,
  pageInfo: document.querySelector('#logPageInfo')?.textContent,
  rows: document.querySelectorAll('#logList .log-row').length,
  firstRow: document.querySelector('#logList .log-row')?.textContent?.trim().slice(0, 80),
  prevDisabled: document.querySelector('#logPrev')?.disabled,
  nextDisabled: document.querySelector('#logNext')?.disabled
}))()`));

// ---------------------------------------------------------------- 发帖计划页
console.log('\n=== 发帖计划页 ===');
await page.eval(`document.querySelector('.nav button[data-pane="plan"]').click()`);
await sleep(800);
console.log(await page.eval(`(() => ({
  enabled: document.querySelector('#planEnabled')?.checked,
  mode: document.querySelector('#planMode')?.value,
  language: document.querySelector('#planLanguage')?.value,
  maxWeight: document.querySelector('#planMaxWeight')?.value,
  genMode: [...document.querySelectorAll('#planGenMode button')].map(b => b.classList.contains('on') ? b.textContent.trim() + '(on)' : b.textContent.trim()),
  status: document.querySelector('#planGenStatus')?.textContent,
  countLabel: document.querySelector('#planCountLabel')?.textContent
}))()`));

// 切换生成模式
await page.eval(`document.querySelector('#planGenMode button[data-mode="topics"]').click()`);
await sleep(500);
console.log('切到按主题生成:', await page.eval(`(() => ({
  translateHidden: document.querySelector('#planTranslateBlock').hidden,
  topicHidden: document.querySelector('#planTopicBlock').hidden,
  status: document.querySelector('#planGenStatus').textContent
}))()`));

console.log('\n=== 页面报错 ===');
console.log(errors.length ? errors.slice(0, 8).join('\n') : '  （无）');

process.exit(0);
