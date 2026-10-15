// 查当前 X 页面的渲染状态：时间线有没有推文、头像在不在。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9224;

const cdp = await connect({ port: PORT });
const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const xTarget = list.find(t => t.type === 'page' && t.url.includes('x.com'));
if (!xTarget) { console.log('没有 x.com 页面'); process.exit(1); }
console.log('目标页面:', xTarget.url);

const page = await cdp.attach(xTarget);
await page.send('Page.enable');
await sleep(500);

const probe = `(() => {
  const tweets = [...document.querySelectorAll('[data-testid="tweet"]')];
  const cells = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')];
  const imgs = [...document.querySelectorAll('img')];
  return JSON.stringify({
    url: location.href,
    readyState: document.readyState,
    title: document.title,
    scrollHeight: document.documentElement.scrollHeight,
    tweetCount: tweets.length,
    cellCount: cells.length,
    imgTotal: imgs.length,
    imgWithSrc: imgs.filter(i => i.getAttribute('src')).length,
    sampleImgs: imgs.slice(0, 4).map(i => (i.getAttribute('src') || '(none)').slice(0, 70)),
    hasPrimaryColumn: !!document.querySelector('[data-testid="primaryColumn"]'),
    hasAccountSwitcher: !!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]'),
    hasProgressBar: !!document.querySelector('[data-testid="progressBar-bar"]'),
    bodyLen: (document.body.innerText || '').length,
    bodyHead: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 200)
  });
})()`;

for (let i = 1; i <= 3; i += 1) {
  const raw = await page.eval(probe);
  const d = JSON.parse(raw);
  console.log(`\n--- 第 ${i} 次 ---`);
  console.log(`tweet=${d.tweetCount} cell=${d.cellCount} img=${d.imgTotal}(有src ${d.imgWithSrc}) 高度=${d.scrollHeight} ready=${d.readyState}`);
  console.log('头像样本:', JSON.stringify(d.sampleImgs, null, 1));
  if (i === 1) {
    console.log('primaryColumn:', d.hasPrimaryColumn, '| 账号按钮:', d.hasAccountSwitcher, '| 进度条:', d.hasProgressBar);
    console.log('正文长度:', d.bodyLen, '|', d.bodyHead);
  }
  if (d.tweetCount > 0 && d.imgWithSrc > 0) break;
  await sleep(4000);
}
process.exit(0);
