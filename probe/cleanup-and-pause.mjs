// 收尾：清理残留草稿 + 暂停调度器 + 汇总当前状态。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });

// ---------------------------------------------------------------- 暂停调度器
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(2500);

console.log('>>> 关闭总开关（停止烧 API 额度）');
const off = await page.eval(`
  chrome.runtime.sendMessage({ type: 'SET_ENABLED', enabled: false })
    .then(r => JSON.stringify({ ok: r.ok, enabled: r.state?.behavior?.enabled }))
`);
console.log(off);

// ---------------------------------------------------------------- 清理所有 x.com 标签页的草稿
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const xPages = targets.filter(t => t.type === 'page' && t.url.includes('x.com'));
console.log(`\n>>> 清理 ${xPages.length} 个 x.com 标签页的草稿`);

for (const t of xPages) {
  const p = await cdp.attach(t);
  await p.send('Page.enable');
  await p.send('Page.navigate', { url: 'https://x.com/home' }).catch(() => {});
}
await sleep(6000);

for (const t of xPages) {
  const fresh = (await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json()))
    .filter(x => x.type === 'page' && x.url.includes('x.com'));
  for (const f of fresh) {
    const p = await cdp.attach(f);
    const state = await p.eval(`(() => {
      const e = document.querySelector('[data-testid="tweetTextarea_0"]');
      return {
        url: location.pathname,
        editorText: (e?.innerText || '').trim().slice(0, 50),
        attachments: !!document.querySelector('[data-testid="attachments"]')
      };
    })()`);
    console.log(`  ${state.url}  编辑器="${state.editorText}"  附件=${state.attachments}`);
    break;
  }
  break;
}

// ---------------------------------------------------------------- 最终状态
const state = await page.eval(`chrome.runtime.sendMessage({type:'GET_ALL'}).then(r => JSON.stringify({
  enabled: r.state.behavior.enabled,
  dryRun: r.state.behavior.dryRun,
  activeHours: r.state.behavior.activeHours,
  pending: r.state.pendingCount,
  queueLen: r.state.queue.length,
  stats: r.state.stats.total,
  keywords: r.state.keywords,
  logs: r.state.logs.slice(0, 8).map(l => l.tag + ' | ' + l.level + ' | ' + l.message.slice(0, 70))
}, null, 2))`);
console.log('\n=== 最终后台状态 ===');
console.log(state);

process.exit(0);
