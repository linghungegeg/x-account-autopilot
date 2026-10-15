// 把扩展恢复到默认状态（测试期间改过的值还原）。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(2500);

console.log('恢复前:', await page.eval(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    dryRun: r.state.behavior.dryRun,
    enabled: r.state.behavior.enabled,
    activeHours: r.state.behavior.activeHours,
    preset: r.state.presetLabel
  }))
`));

console.log('\n>>> 调 RESET_BEHAVIOR');
console.log(await page.eval(`
  chrome.runtime.sendMessage({ type: 'RESET_BEHAVIOR' }).then(r => JSON.stringify({
    ok: r.ok,
    dryRun: r.state.behavior.dryRun,
    enabled: r.state.behavior.enabled,
    activeHours: r.state.behavior.activeHours,
    preset: r.state.presetLabel
  }))
`));

process.exit(0);
