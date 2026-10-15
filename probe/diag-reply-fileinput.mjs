// 诊断：回复编辑器（/compose/post）上到底有没有 fileInput，什么时候出现。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';
const HREF = process.env.STATUS_HREF || '/linghungg/status/2102101871532146707';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);

const tabId = await ext.eval(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(t => t[0]?.id ?? null)`);

const SNAP = `() => {
  const inputs = [...document.querySelectorAll('input[type="file"]')].map(i => ({
    tid: i.getAttribute('data-testid'),
    accept: (i.getAttribute('accept') || '').slice(0, 50),
    visible: i.getClientRects().length > 0,
    inComposer: !!i.closest('[data-testid="tweetTextarea_0RichTextInputContainer"]')
  }));
  const editors = [...document.querySelectorAll('[data-testid="tweetTextarea_0"]')];
  return {
    path: location.pathname,
    editors: editors.length,
    fileInputs: inputs.length,
    inputs,
    // 附件按钮
    mediaButtons: [...document.querySelectorAll('[aria-label]')]
      .map(e => e.getAttribute('aria-label'))
      .filter(a => /photo|video|媒体|图片|视频/i.test(a)).slice(0, 5),
    hasAttachmentsNode: !!document.querySelector('[data-testid="attachments"]')
  };
}`;

const snap = async () => {
  const out = await ext.eval(`
    chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: ${SNAP} })
      .then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
  `);
  try { return JSON.parse(out); } catch { return out; }
};

// ---------------------------------------------------------------- 对比两个页面
console.log('=== A. /home（首页发帖框）===');
await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com/home' })`);
await sleep(10000);
console.log(JSON.stringify(await snap(), null, 2));

console.log('\n=== B. 帖子详情页，点 reply 之后 ===');
await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com${HREF}' })`);
await sleep(11000);
console.log('点 reply 前:', JSON.stringify(await snap()));

await ext.eval(`
  chrome.scripting.executeScript({
    target: { tabId: ${tabId} },
    func: () => {
      const a = document.querySelector('[data-testid="tweet"]');
      const b = a?.querySelector('[data-testid="reply"]');
      if (b) b.click();
      return !!b;
    }
  })
`);
console.log('\n>>> 已点击 reply，轮询观察 fileInput 何时出现');
for (let i = 1; i <= 8; i += 1) {
  await sleep(1500);
  const s = await snap();
  console.log(`  ${(i * 1.5).toFixed(1)}s  路径=${s.path} 编辑器=${s.editors} fileInput=${s.fileInputs} 附件节点=${s.hasAttachmentsNode}`);
  if (i === 1 || i === 4 || i === 8) {
    if (s.inputs?.length) console.log('      inputs:', JSON.stringify(s.inputs));
    if (s.mediaButtons?.length) console.log('      媒体按钮:', JSON.stringify(s.mediaButtons));
  }
}

console.log('\n=== 最终快照 ===');
console.log(JSON.stringify(await snap(), null, 2));

process.exit(0);
