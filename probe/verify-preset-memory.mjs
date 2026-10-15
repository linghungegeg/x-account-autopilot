// 实测用户报的场景：在某一档里改参数，保存后不该掉档；切档各自记住；恢复默认只还原当前档。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9224;
const EXT_ID = process.env.EXT_ID || 'beoeccdkmifoakblkibgmedccfknhfbi';

const cdp = await connect({ port: PORT });

// 先重载扩展，确保跑的是刚打好的包
const boot = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await boot.send('Page.enable');
await sleep(2500);
await boot.eval(`(() => { chrome.runtime.reload(); return true; })()`).catch(() => {});
await sleep(6000);

const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(4000);
const ev = (expr, timeoutMs = 60000) => page.eval(expr, { timeoutMs });

await ev(`document.querySelector('.nav button[data-pane="behavior"]').click()`);
await sleep(400);

const call = msg => ev(`chrome.runtime.sendMessage(${JSON.stringify(msg)}).then(r => JSON.stringify({ ok: r.ok, error: r.error })).catch(e => 'ERR: ' + e.message)`);
const state = async () => JSON.parse(await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    preset: r.state.behavior.preset,
    presetLabel: r.state.presetLabel,
    flat: {
      delayMinSec: r.state.behavior.delayMinSec,
      maxPerDay: r.state.behavior.maxPerDay,
      scanLimit: r.state.behavior.scanLimit,
      activeEnd: r.state.behavior.activeHours.end
    },
    perAction: {
      browseHour: r.state.behavior.perAction.browse.maxPerHour,
      replyDay: r.state.behavior.perAction.reply.maxPerDay
    },
    sets: Object.fromEntries(['conservative', 'balanced', 'aggressive'].map(name => [name, {
      delayMinSec: r.state.behavior.presetSets[name].delayMinSec,
      maxPerDay: r.state.behavior.presetSets[name].maxPerDay,
      scanLimit: r.state.behavior.presetSets[name].scanLimit,
      activeEnd: r.state.behavior.presetSets[name].activeHours.end,
      browseHour: r.state.behavior.presetSets[name].perAction.browse.maxPerHour,
      replyDay: r.state.behavior.presetSets[name].perAction.reply.maxPerDay
    }])),
    hint: document.querySelector('#presetHint')?.textContent,
    onButtons: [...document.querySelectorAll('#presetSeg button')].filter(b => b.classList.contains('on')).map(b => b.dataset.preset)
  }))
`));

// 本次要验的字段：扁平标量 / 嵌套对象 / 分动作上限 都要覆盖
const EDITED = { delayMinSec: 111, maxPerDay: 77, scanLimit: 9, activeEnd: 22, browseHour: 33, replyDay: 8 };
const setAll = async () => {
  for (const [id, value] of Object.entries(EDITED)) await setField(id, value);
};

const clickPreset = async name => {
  await ev(`[...document.querySelectorAll('#presetSeg button')].find(b => b.dataset.preset === ${JSON.stringify(name)}).click()`);
  await sleep(1500);
};
const setField = async (id, value) => {
  await ev(`(() => { const el = document.querySelector('#${id}'); el.value = '${value}'; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(200);
};
const save = async () => { await ev(`document.querySelector('#saveBehavior').click()`); await sleep(2000); };

const check = (label, actual, expected) =>
  console.log(`  ${String(actual) === String(expected) ? '✅' : '❌'} ${label}：期望 ${expected}，实际 ${actual}`);

// ---------------------------------------------------------------- 0. 归零
console.log('=== 0. 先把三档都恢复成默认 ===');
for (const name of ['conservative', 'balanced', 'aggressive']) {
  await clickPreset(name);
  await ev(`document.querySelector('#resetPreset').click()`);
  await sleep(1800);
}
let s = await state();
console.log('  三档基准值:', JSON.stringify(s.sets.balanced), '/', JSON.stringify(s.sets.aggressive), '/', JSON.stringify(s.sets.conservative));

// ---------------------------------------------------------------- 1. 在均衡档改参数
console.log('\n=== 1. 切到「均衡」→ 改 6 个字段（扁平/嵌套/分动作都有）→ 保存 ===');
console.log('  改动:', JSON.stringify(EDITED));
await clickPreset('balanced');
await setAll();
await save();
s = await state();
console.log('  状态栏:', await ev(`document.querySelector('#status')?.textContent`));
console.log('  档位按钮选中:', JSON.stringify(s.onButtons));
console.log('  提示:', s.hint);
check('保存后档位仍是均衡', s.preset, 'balanced');
for (const [id, value] of Object.entries(EDITED)) {
  const actual = id in s.flat ? s.flat[id] : s.perAction[id];
  check(`生效参数 ${id}`, actual, value);
  check(`均衡档存下 ${id}`, s.sets.balanced[id], value);
}
check('激进档没被动(delayMinSec)', s.sets.aggressive.delayMinSec, 30);
check('保守档没被动(delayMinSec)', s.sets.conservative.delayMinSec, 180);

// ---------------------------------------------------------------- 2. 切到激进档
console.log('\n=== 2. 切到「激进」===');
await clickPreset('aggressive');
s = await state();
console.log('  档位按钮选中:', JSON.stringify(s.onButtons));
check('档位变成激进', s.preset, 'aggressive');
check('生效参数换成激进那套', s.flat.delayMinSec, 30);
check('均衡档的改动还在', s.sets.balanced.delayMinSec, 111);

// ---------------------------------------------------------------- 3. 切回均衡档
console.log('\n=== 3. 切回「均衡」===');
await clickPreset('balanced');
s = await state();
check('档位变回均衡', s.preset, 'balanced');
for (const [id, value] of Object.entries(EDITED)) {
  const actual = id in s.flat ? s.flat[id] : s.perAction[id];
  check(`切回来 ${id} 还是改过的值`, actual, value);
}
console.log('  提示:', s.hint);

// ---------------------------------------------------------------- 4. 恢复本档默认值
console.log('\n=== 4. 点「恢复本档默认值」===');
await ev(`document.querySelector('#resetPreset').click()`);
await sleep(2000);
s = await state();
console.log('  状态栏:', await ev(`document.querySelector('#status')?.textContent`));
check('档位还是均衡', s.preset, 'balanced');
check('delayMinSec 回到均衡默认 60', s.flat.delayMinSec, 60);
check('activeEnd 回到均衡默认 0', s.flat.activeEnd, 0);
check('browseHour 回到均衡默认 15', s.perAction.browseHour, 15);
check('激进档仍是 30', s.sets.aggressive.delayMinSec, 30);

// ---------------------------------------------------------------- 5. 与档位无关的设置不受影响
console.log('\n=== 5. 与档位无关的设置不受切档/恢复影响 ===');
await call({ type: 'SAVE_BEHAVIOR', behavior: { queueLimit: 44, cooldownAfterErrorMin: 11 } });
await clickPreset('conservative');
await ev(`document.querySelector('#resetPreset').click()`);
await sleep(2000);
console.log(' ', await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    queueLimit: r.state.behavior.queueLimit,
    cooldownAfterErrorMin: r.state.behavior.cooldownAfterErrorMin,
    preset: r.state.behavior.preset
  }))
`));

// 收尾：三档都恢复默认，切回均衡
for (const name of ['conservative', 'balanced', 'aggressive']) {
  await clickPreset(name);
  await ev(`document.querySelector('#resetPreset').click()`);
  await sleep(1800);
}
await clickPreset('balanced');
console.log('\n收尾完成:', await ev(`document.querySelector('#status')?.textContent`));
process.exit(0);
