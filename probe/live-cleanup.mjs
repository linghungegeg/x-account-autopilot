// 清理发帖框里的残留草稿，并确认已清空。不做任何发布动作。
import { connect, sleep } from './cdp.js';

const cdp = await connect({ port: Number(process.env.X_CDP_PORT) || 9223 });
const page = await cdp.page(0);
await page.send('Page.enable');

console.log('当前页面:', page.target.url);

// 直接重载，丢弃未提交的草稿
await page.send('Page.navigate', { url: 'https://x.com/home' }).catch(e => console.log('navigate:', e.message));
await sleep(5000);

const state = await page.eval(`(() => {
  const editor = document.querySelector('[data-testid="tweetTextarea_0"]');
  const attach = document.querySelector('[data-testid="attachments"]');
  const files = document.querySelector('[data-testid="fileInput"]');
  return {
    url: location.href,
    composerText: (editor?.innerText || '').trim(),
    attachments: !!attach,
    fileCount: files ? files.files.length : null,
    progressBar: !!document.querySelector('[data-testid="progressBar-bar"]')
  };
})()`);

console.log('清理后状态:', JSON.stringify(state, null, 2));
const clean = !state.composerText && !state.attachments && !state.progressBar;
console.log(clean ? '✅ 发帖框已清空，没有残留草稿' : '⚠️ 仍有残留，需要再处理');

page.close();
process.exit(0);
