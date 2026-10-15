// 逐个测试行为参数里的每个输入框：能不能改、能不能存进去。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9224;
const EXT_ID = process.env.EXT_ID || 'beoeccdkmifoakblkibgmedccfknhfbi';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(4000);

const ev = (expr, timeoutMs = 60000) => page.eval(expr, { timeoutMs });
await ev(`document.querySelector('.nav button[data-pane="behavior"]').click()`);
await sleep(1200);

// 行为参数分区里所有的 number/text/select 输入框
const fields = JSON.parse(await ev(`
  JSON.stringify([...document.querySelectorAll('.pane[data-pane="behavior"] input, .pane[data-pane="behavior"] select')]
    .map(el => ({ id: el.id, type: el.type, tag: el.tagName }))
    .filter(f => f.id))
`));
console.log(`行为参数分区共 ${fields.length} 个输入框\n`);

const results = [];
for (const f of fields) {
  if (f.type === 'checkbox') {
    // 复选框：翻转看能不能存
    const before = JSON.parse(await ev(`JSON.stringify({ v: document.querySelector('#${f.id}').checked })`)).v;
    await ev(`(() => { const el = document.querySelector('#${f.id}'); el.checked = !el.checked; el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await sleep(120);
    const after = JSON.parse(await ev(`JSON.stringify({ v: document.querySelector('#${f.id}').checked })`)).v;
    results.push({ id: f.id, ok: before !== after, detail: `${before} -> ${after}` });
    continue;
  }

  // 数值/文本：设一个新值，看 DOM 是否接受
  // select 不能塞任意值（不存在的 option 会把 value 清空），改选另一个合法选项
  let testValue;
  if (f.tag === 'SELECT') {
    testValue = JSON.parse(await ev(`
      (() => {
        const el = document.querySelector('#${f.id}');
        const other = [...el.options].map(o => o.value).find(v => v !== el.value);
        return JSON.stringify(other ?? null);
      })()
    `));
    if (testValue === null) { results.push({ id: f.id, ok: false, detail: '只有一个选项，无法切换' }); continue; }
  } else {
    testValue = f.type === 'number' ? '7' : 'test-7';
  }
  const r = JSON.parse(await ev(`
    (() => {
      const el = document.querySelector('#${f.id}');
      if (!el) return JSON.stringify({ error: 'not-found' });
      const before = el.value;
      el.value = ${JSON.stringify(testValue)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return JSON.stringify({ before, after: el.value, disabled: el.disabled, readOnly: el.readOnly });
    })()
  `));
  results.push({ id: f.id, ok: r.after === testValue, detail: `${r.before} -> ${r.after}${r.disabled ? ' [disabled]' : ''}${r.readOnly ? ' [readonly]' : ''}` });
}

console.log('=== 逐个输入框测试 ===');
for (const r of results) {
  console.log(`  ${r.ok ? '✅' : '❌'} ${r.id.padEnd(28)} ${r.detail}`);
}

const failed = results.filter(r => !r.ok);
console.log(`\n可改: ${results.length - failed.length} / ${results.length}`);
if (failed.length) {
  console.log('改不了的字段:');
  failed.forEach(f => console.log(`  ${f.id}  ${f.detail}`));
}

// 再验证保存链路：改几个关键字段后保存，回读后台
console.log('\n=== 保存链路 ===');
await ev(`
  (() => {
    const set = (id, v) => { const el = document.querySelector(id); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
    set('#delayMinSec', '77');
    set('#delayMaxSec', '88');
    set('#maxPerHour', '9');
    set('#browseHour', '3');
    set('#browseDay', '4');
    set('#activeStart', '6');
    set('#activeEnd', '22');
    set('#commentLanguage', 'en');
    return true;
  })()
`);
await sleep(600);
await ev(`document.querySelector('#saveBehavior').click()`);
await sleep(3000);

console.log(await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    delayMinSec: r.state.behavior.delayMinSec,
    delayMaxSec: r.state.behavior.delayMaxSec,
    maxPerHour: r.state.behavior.maxPerHour,
    browse: r.state.behavior.perAction.browse,
    activeHours: r.state.behavior.activeHours,
    commentLanguage: r.state.behavior.commentLanguage,
    preset: r.state.presetLabel
  }, null, 2))
`));

process.exit(0);
