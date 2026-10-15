// 真实验证 4：生成图片 + 真实带图评论（只生一次图，复用）。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';
const HREF = process.env.STATUS_HREF || '/linghungg/status/2102101871532146707';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);

const tabId = await ext.eval(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(t => t[0]?.id ?? null)`);
console.log('工作标签页:', tabId);

// ---------------------------------------------------------------- 生图一次
console.log('\n>>> 调扩展的 AI_IMAGE 生图（同时验证中转站生图 + MIME 嗅探）');
let started = Date.now();
const img = await ext.eval(`
  chrome.runtime.sendMessage({
    type: 'AI_IMAGE',
    prompt: 'a minimal flat illustration of a small robot watering a plant, soft colors'
  }).then(r => {
    window.__testImage = r.dataUrl || '';
    return JSON.stringify({
      ok: r.ok,
      error: r.error,
      mime: (r.dataUrl || '').slice(5, (r.dataUrl || '').indexOf(';')),
      bytes: Math.round((r.dataUrl || '').length * 0.75)
    });
  }).catch(e => 'ERR: ' + e.message)
`, { timeoutMs: 180000 });
console.log(`耗时 ${Math.round((Date.now() - started) / 1000)}s`);
console.log('生图:', img);

const imgParsed = (() => { try { return JSON.parse(img); } catch { return null; } })();
if (!imgParsed?.ok) { console.log('❌ 生图失败，中止'); process.exit(1); }

// ---------------------------------------------------------------- 真实带图评论
console.log(`\n>>> 导航到测试帖 ${HREF}`);
await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com${HREF}' })`);
await sleep(11000);

console.log('\n>>> 发送带图评论（真实提交，复用上面那张图）');
started = Date.now();
const reply = await ext.eval(`
  chrome.tabs.sendMessage(${tabId}, {
    type: 'X_REPLY',
    statusHref: ${JSON.stringify(HREF)},
    text: 'with image',
    mediaDataUrl: window.__testImage,
    dryRun: false,
    humanize: { humanize: false }
  }).then(r => JSON.stringify(r)).catch(e => 'ERR: ' + e.message)
`, { timeoutMs: 180000 });
console.log(`耗时 ${Math.round((Date.now() - started) / 1000)}s`);
console.log('X_REPLY:', reply);

// ---------------------------------------------------------------- 确认
console.log('\n>>> 刷新确认');
await sleep(4000);
await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com${HREF}' })`);
await sleep(12000);

const state = await ext.eval(`
  chrome.scripting.executeScript({
    target: { tabId: ${tabId} },
    func: () => {
      const arts = [...document.querySelectorAll('[data-testid="tweet"]')];
      return {
        tweets: arts.length,
        texts: [...document.querySelectorAll('[data-testid="tweetText"]')].map(e => (e.innerText || '').trim().slice(0, 40)),
        photos: document.querySelectorAll('[data-testid="tweetPhoto"]').length,
        replyAria: arts[0]?.querySelector('[data-testid="reply"]')?.getAttribute('aria-label')
      };
    }
  }).then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
`);
console.log('页面:', state);

const parsed = (() => { try { return JSON.parse(reply); } catch { return null; } })();
console.log('\n=== 结论 ===');
console.log(`✅ 生图成功（${imgParsed.mime}, ${Math.round(imgParsed.bytes / 1024)} KB）`);
console.log(parsed?.ok ? `✅ 带图评论提交成功（withMedia=${parsed.withMedia}）` : '❌ 带图评论失败: ' + (parsed?.error || reply));

process.exit(0);
