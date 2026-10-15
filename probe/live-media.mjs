// 实测媒体上传：把一张真实图片塞进发帖框，抓上传接口，然后丢弃草稿（不发布）。
// 用来回答"发帖到底支不支持图片/视频"。
import { readFileSync, writeFileSync } from 'node:fs';
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const OUT = 'probe/result-live-media.json';

const png = readFileSync('icons/icon128.png').toString('base64');
console.log(`测试图片: icons/icon128.png (${png.length} 字节 base64)`);

const cdp = await connect({ port: PORT });
const page = await cdp.page(0);

const net = [];
page.on(msg => {
  if (msg.method === 'Network.requestWillBeSent') {
    const url = msg.params.request.url;
    if (url.includes('/graphql/') || url.includes('/media/') || url.includes('upload')) {
      net.push({
        kind: 'req',
        url,
        op: url.includes('/graphql/') ? url.split('/').pop().split('?')[0] : url,
        method: msg.params.request.method,
        postData: msg.params.request.postData ? msg.params.request.postData.slice(0, 300) : undefined
      });
    }
  } else if (msg.method === 'Network.responseReceived') {
    const url = msg.params.response.url;
    if (url.includes('/graphql/') || url.includes('/media/') || url.includes('upload')) {
      net.push({ kind: 'res', url: url.split('?')[0], status: msg.params.response.status });
    }
  }
});

await page.send('Network.enable');
await page.send('Page.enable');

console.log('\n>>> 打开 x.com/home');
await page.goto('https://x.com/home', { waitMs: 4000 });

const before = await page.eval(`(() => {
  const i = document.querySelector('[data-testid="fileInput"]');
  return {
    hasInput: !!i,
    accept: i?.getAttribute('accept'),
    multiple: i?.multiple,
    existingAttachments: !!document.querySelector('[data-testid="attachments"]')
  };
})()`);
console.log('上传前:', JSON.stringify(before, null, 2));

// ---------------------------------------------------------------- 塞图片
net.length = 0;
console.log('\n>>> 把 PNG 塞进 fileInput 并派发 input/change');
const injected = await page.eval(`(async () => {
  const input = document.querySelector('[data-testid="fileInput"]');
  if (!input) return { ok: false, error: '找不到 fileInput' };
  const bin = atob(${JSON.stringify(png)});
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const file = new File([bytes], 'probe-image.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, filesAssigned: input.files.length, size: file.size, type: file.type };
})()`);
console.log('注入结果:', JSON.stringify(injected));

await sleep(6000);

// ---------------------------------------------------------------- 观察结果
const after = await page.eval(`(() => {
  const all = [...new Set([...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')))];
  const attach = document.querySelector('[data-testid="attachments"]');
  const btn = document.querySelector('[data-testid="tweetButtonInline"]');
  return {
    attachmentNode: !!attach,
    attachmentHtml: attach ? attach.outerHTML.slice(0, 400) : null,
    attachmentImgs: attach ? [...attach.querySelectorAll('img')].map(i => (i.getAttribute('src') || '').slice(0, 70)) : [],
    submitDisabled: btn ? (btn.disabled || btn.getAttribute('aria-disabled')) : null,
    progressBar: !!document.querySelector('[data-testid="progressBar-bar"]'),
    mediaTestIds: all.filter(t => /attach|media|photo|video|remove/i.test(t))
  };
})()`);
console.log('\n上传后:', JSON.stringify(after, null, 2));

console.log('\n=== 媒体相关网络 ===');
const seen = new Set();
for (const n of net) {
  const key = `${n.kind}:${n.op || n.url}`;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`  [${n.kind}] ${n.status ?? n.method} ${n.op || n.url}`);
}
const uploadCalls = net.filter(n => n.kind === 'req' && /upload|media/i.test(n.url));
if (uploadCalls.length) {
  console.log('\n上传请求体样本:');
  uploadCalls.slice(0, 3).forEach(c => console.log(`  ${c.url}\n    ${(c.postData || '(无)').slice(0, 250)}`));
}

// ---------------------------------------------------------------- 丢弃草稿
console.log('\n>>> 丢弃草稿（重新加载页面，不发布）');
await page.goto('https://x.com/home', { waitMs: 3000 });
const clean = await page.eval(`(() => ({
  composerText: (document.querySelector('[data-testid="tweetTextarea_0"]')?.innerText || '').trim(),
  attachments: !!document.querySelector('[data-testid="attachments"]')
}))()`);
console.log('清理后:', JSON.stringify(clean));

writeFileSync(OUT, JSON.stringify({ before, injected, after, net }, null, 2));
console.log(`\n完整结果: ${OUT}`);

page.close();
process.exit(0);
