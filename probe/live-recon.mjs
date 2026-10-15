// 实测侦察：连上已登录的 Chrome，抓当前 DOM 控件 + 网络请求。
// 只读，不做任何写操作。
import { writeFileSync } from 'node:fs';
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const OUT = new URL('./result-live-recon.json', import.meta.url).pathname.replace(/^\//, '');

const cdp = await connect({ port: PORT });
console.log('可用页面:');
cdp.pages.forEach((p, i) => console.log(`  [${i}] ${p.title} — ${p.url}`));

const page = await cdp.page(0);
console.log(`\n附着到: ${page.target.url}\n`);

// ---------------------------------------------------------------- 网络捕获
const net = [];
page.on(msg => {
  if (msg.method === 'Network.requestWillBeSent') {
    const r = msg.params.request;
    net.push({
      kind: 'req',
      url: r.url,
      method: r.method,
      type: msg.params.type,
      postData: r.postData ? r.postData.slice(0, 400) : undefined
    });
  } else if (msg.method === 'Network.responseReceived') {
    net.push({ kind: 'res', url: msg.params.response.url, status: msg.params.response.status });
  }
});

await page.send('Network.enable');
await page.send('Page.enable');

// ---------------------------------------------------------------- 当前页 DOM
const snapshot = `(() => {
  const testIds = [...new Set([...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')))].sort();
  const fileInputs = [...document.querySelectorAll('input[type=file]')].map(i => ({
    tid: i.getAttribute('data-testid'),
    accept: i.getAttribute('accept'),
    multiple: i.multiple,
    hidden: i.offsetParent === null
  }));
  const mediaButtons = [...document.querySelectorAll('[aria-label]')]
    .map(e => ({ tag: e.tagName, tid: e.getAttribute('data-testid'), aria: e.getAttribute('aria-label') }))
    .filter(x => /photo|video|media|gif|poll|图片|视频|媒体|照片|投票/i.test(x.aria || ''));
  const composer = document.querySelector('[data-testid="tweetTextarea_0"]');
  return {
    url: location.href,
    title: document.title,
    loggedIn: !!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]'),
    hasComposer: !!composer,
    testIdCount: testIds.length,
    testIds,
    fileInputs,
    mediaButtons
  };
})()`;

console.log('=== 当前页 (x.com/home) ===');
const home = await page.eval(snapshot);
console.log('登录态:', home.loggedIn, '| 发帖框:', home.hasComposer, '| testid 数:', home.testIdCount);
console.log('\nfile input:');
console.log(JSON.stringify(home.fileInputs, null, 2));
console.log('\n媒体相关按钮:');
home.mediaButtons.forEach(b => console.log(`  ${b.tag} [${b.tid || '-'}] ${b.aria}`));

// ---------------------------------------------------------------- 导航到搜索页
net.length = 0;
console.log('\n=== 导航到搜索结果页 ===');
await page.goto('https://x.com/search?q=AI&src=typed_query&f=live', { waitMs: 4000 });

const search = await page.eval(snapshot);
console.log('testid 数:', search.testIdCount);
console.log('tweets:', await page.eval('document.querySelectorAll(\'[data-testid="tweet"]\').length'));

// ---------------------------------------------------------------- 汇总网络
const graphql = [...new Set(net.filter(n => n.kind === 'req' && n.url.includes('/graphql/')).map(n => {
  try { return new URL(n.url).pathname.split('/').pop(); } catch { return n.url; }
}))];
const others = [...new Set(net.filter(n => n.kind === 'req' && !n.url.includes('/graphql/') && !n.url.startsWith('data:')).map(n => {
  try { const u = new URL(n.url); return `${n.method} ${u.origin}${u.pathname}`; } catch { return n.url; }
}))];

console.log('\n=== 本次导航触发的 GraphQL 操作 ===');
graphql.forEach(g => console.log('  ' + g));
console.log('\n=== 其它请求 ===');
others.slice(0, 30).forEach(o => console.log('  ' + o));

writeFileSync(OUT, JSON.stringify({ home, search, graphql, others, net: net.slice(0, 200) }, null, 2));
console.log(`\n完整结果已写入 ${OUT}`);

page.close();
process.exit(0);
