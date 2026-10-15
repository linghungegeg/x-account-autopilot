// 检查任务是否卡住：已运行多久 + 内容脚本是否还响应。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const popup = await cdp.newPage(`chrome-extension://${EXT_ID}/src/popup/popup.html`);
await popup.send('Page.enable');
await sleep(2000);

const now = Date.now();
console.log('现在:', new Date(now).toLocaleTimeString('zh-CN', { hour12: false }));

const state = await popup.eval(`chrome.runtime.sendMessage({type:'GET_ALL'}).then(r => JSON.stringify({
  current: r.state.current,
  logs: r.state.logs.slice(0, 5).map(l => l.tag + ' | ' + l.message.slice(0, 80))
}, null, 2))`);
const parsed = JSON.parse(state);
console.log('后台:', state);

if (parsed.current) {
  const elapsed = Math.round((now - parsed.current.startedAt) / 1000);
  console.log(`\n⏱ 当前任务已运行 ${elapsed} 秒（阶段: ${parsed.current.stage}）`);
  console.log('   超过 300 秒会被 tick 判超时作废');
}

// ---------------------------------------------------------------- 内容脚本还活着吗
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const xPages = targets.filter(t => t.type === 'page' && t.url.includes('x.com'));
console.log(`\n=== x.com 标签页 (${xPages.length}) ===`);

for (const t of xPages) {
  const page = await cdp.attach(t);
  const info = await page.eval(`(() => ({
    url: location.href.slice(0, 90),
    panel: !!document.getElementById('x-helper-panel-host'),
    tweets: document.querySelectorAll('[data-testid="tweet"]').length,
    editor: !!document.querySelector('[data-testid="tweetTextarea_0"]'),
    editorText: (document.querySelector('[data-testid="tweetTextarea_0"]')?.innerText || '').slice(0, 60),
    attachments: !!document.querySelector('[data-testid="attachments"]'),
    progressBar: !!document.querySelector('[data-testid="progressBar-bar"]'),
    challenge: /^\\/i\\/flow\\//.test(location.pathname) ? 'YES' : 'no'
  }))()`);
  console.log(`\n  ${info.url}`);
  console.log(`    面板=${info.panel} 推文=${info.tweets} 编辑器=${info.editor} 附件=${info.attachments} 进度条=${info.progressBar}`);
  if (info.editorText) console.log(`    编辑器内容: "${info.editorText}"`);
}

process.exit(0);
