// 清空 chrome://extensions 的错误列表，然后重新走一遍「运行中」分支，确认不再产生新错误。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9224;
const EXT_ID = process.env.EXT_ID || 'beoeccdkmifoakblkibgmedccfknhfbi';

const cdp = await connect({ port: PORT });

// 在 chrome://extensions 里找到错误面板，读内容 / 点「全部清除」
// 注意：错误页是挂在 document 下的 <extensions-error-page>，不在 extensions-manager 的 shadow root 里。
const READ_ERRORS = `(() => {
  const found = [];
  const roots = [document];
  const manager = document.querySelector('extensions-manager');
  if (manager?.shadowRoot) roots.push(manager.shadowRoot);
  for (const root of roots) {
    for (const el of root.querySelectorAll('*')) {
      if (el.tagName === 'EXTENSIONS-ERROR-PAGE' && el.shadowRoot) {
        found.push(el.shadowRoot.textContent.replace(/\\s+/g, ' ').trim().slice(0, 900));
      }
    }
  }
  return JSON.stringify(found);
})()`;

const CLEAR_ERRORS = `(() => {
  let clicked = false;
  const roots = [document];
  const manager = document.querySelector('extensions-manager');
  if (manager?.shadowRoot) roots.push(manager.shadowRoot);
  for (const root of roots) {
    for (const el of root.querySelectorAll('*')) {
      if (el.tagName === 'EXTENSIONS-ERROR-PAGE' && el.shadowRoot) {
        const btn = [...el.shadowRoot.querySelectorAll('button, a, cr-button')]
          .find(b => (b.textContent || '').trim() === '全部清除');
        if (btn) { btn.click(); clicked = true; }
      }
    }
  }
  return clicked;
})()`;

// 错误页只有导航到 ?errors=<id> 才会渲染出来
async function openErrorPage() {
  const page = await cdp.newPage(`chrome://extensions/?errors=${EXT_ID}`);
  await page.send('Page.enable');
  await sleep(4000);
  return page;
}

// ---------------------------------------------------------- 1. 清空错误列表
console.log('>>> 1. 清空 chrome://extensions 的错误列表');
const extPage = await openErrorPage();
// 页面框架本身永远有「错误 全部清除」这几个字，只有出现 Uncaught/上下文 才是真的错误条目
const hasError = list => list.some(t => /Uncaught|上下文|stack|ReferenceError|TypeError/i.test(t));

console.log('  清空前:', await extPage.eval(READ_ERRORS));
console.log('  点击「全部清除」:', await extPage.eval(CLEAR_ERRORS));
await sleep(2500);

const freshPage = await openErrorPage();
const afterClear = JSON.parse(await freshPage.eval(READ_ERRORS));
console.log('  清空后:', afterClear, hasError(afterClear) ? '（仍有错误）' : '（已无错误条目）');

// ---------------------------------------------------------- 2. 重新触发「运行中」分支
console.log('\n>>> 2. 重新走一遍 popup 的「运行中」分支');
const opts = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await opts.send('Page.enable');
await sleep(3000);
const ev = (expr, timeoutMs = 60000) => opts.eval(expr, { timeoutMs });
const call = (msg) => ev(`chrome.runtime.sendMessage(${JSON.stringify(msg)}).then(r => JSON.stringify({ ok: r.ok })).catch(e => 'ERR: ' + e.message)`);

await call({ type: 'CLEAR_QUEUE' });
await call({ type: 'SAVE_KEYWORDS', keywords: [] });
await call({ type: 'SAVE_BEHAVIOR', behavior: { dryRun: true } });
await call({ type: 'SET_ENABLED', enabled: true });
await sleep(5000);

const state = JSON.parse(await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    enabled: r.state.behavior.enabled,
    blockReason: r.state.blockReason || '',
    current: r.state.current || null,
    challenge: r.state.challenge || null
  }))
`));
console.log('  状态:', JSON.stringify(state));
console.log(state.enabled && !state.blockReason && !state.current && !state.challenge
  ? '  ✅ 命中「运行中」分支'
  : '  ⚠️ 未命中目标分支');

const popup = await cdp.newPage(`chrome-extension://${EXT_ID}/src/popup/popup.html`);
await popup.send('Page.enable');
await sleep(6000);
console.log('  弹窗状态栏:', await popup.eval(`document.querySelector('#status')?.textContent`));

// ---------------------------------------------------------- 3. 再看错误列表
console.log('\n>>> 3. 再次检查错误列表');
await call({ type: 'SET_ENABLED', enabled: false });
const afterPage = await openErrorPage();
const errors = JSON.parse(await afterPage.eval(READ_ERRORS));
console.log('  错误列表:', errors.length ? errors : '（空）');
console.log(!hasError(errors)
  ? '\n✅ 清空后重新触发「运行中」分支，没有再产生任何扩展错误'
  : '\n❌ 仍然有错误');
process.exit(0);
