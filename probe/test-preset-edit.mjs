// 实测"三个模式里面改不了参数"：点预设 → 读值 → 手改 → 保存 → 回读。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9224;
const EXT_ID = process.env.EXT_ID || 'beoeccdkmifoakblkibgmedccfknhfbi';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);

const errors = [];
page.on(msg => {
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push('console.error: ' + msg.params.args.map(a => a.value ?? a.description).join(' '));
});
await page.send('Runtime.enable');
await page.send('Page.enable');
await sleep(4000);

const ev = (expr, timeoutMs = 60000) => page.eval(expr, { timeoutMs });

const readFields = () => ev(`
  JSON.stringify({
    delayMin: document.querySelector('#delayMinSec')?.value,
    delayMax: document.querySelector('#delayMaxSec')?.value,
    maxPerHour: document.querySelector('#maxPerHour')?.value,
    activeStart: document.querySelector('#activeStart')?.value,
    browseHour: document.querySelector('#browseHour')?.value,
    hint: document.querySelector('#presetHint')?.textContent?.slice(0, 50),
    activePreset: [...document.querySelectorAll('#presetSeg button')].filter(b => b.classList.contains('on')).map(b => b.textContent.trim())
  })
`);

// 切到行为参数
await ev(`document.querySelector('.nav button[data-pane="behavior"]').click()`);
await sleep(1200);

console.log('=== 初始状态 ===');
console.log(await readFields());

console.log('\n=== 点「保守」 ===');
const clickResult = await ev(`
  (() => {
    const btn = document.querySelector('#presetSeg button[data-preset="conservative"]');
    if (!btn) return 'no-button';
    btn.click();
    return 'clicked';
  })()
`);
console.log('点击结果:', clickResult);
await sleep(800);
console.log(await readFields());

console.log('\n=== 点「激进」 ===');
console.log(await ev(`(() => { const b = document.querySelector('#presetSeg button[data-preset="aggressive"]'); if (!b) return 'no-button'; b.click(); return 'clicked'; })()`));
await sleep(800);
console.log(await readFields());

console.log('\n=== 手动改「最小间隔」为 123 ===');
await ev(`
  (() => {
    const input = document.querySelector('#delayMinSec');
    input.value = '123';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()
`);
await sleep(800);
console.log(await readFields());

console.log('\n=== 点「保存行为设置」 ===');
console.log(await ev(`(() => { const b = document.querySelector('#saveBehavior'); if (!b) return 'no-button'; b.click(); return 'clicked'; })()`));
await sleep(3000);
console.log('保存后:', await readFields());
console.log('状态栏:', await ev(`document.querySelector('#status')?.textContent`));

console.log('\n=== 回读后台真实存储 ===');
console.log(await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    delayMinSec: r.state.behavior.delayMinSec,
    delayMaxSec: r.state.behavior.delayMaxSec,
    maxPerHour: r.state.behavior.maxPerHour,
    activeHours: r.state.behavior.activeHours,
    preset: r.state.presetLabel
  }))
`));

console.log('\n=== 页面报错 ===');
console.log(errors.length ? errors.slice(0, 8).join('\n') : '  （无）');

process.exit(0);
