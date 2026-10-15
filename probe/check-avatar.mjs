// X 现在怎么渲染头像？侧边栏 + 推文里的头像容器各查一个。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9224;

const cdp = await connect({ port: PORT });
const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const xTarget = list.find(t => t.type === 'page' && t.url.includes('x.com'));
if (!xTarget) { console.log('没有 x.com 页面'); process.exit(1); }

const page = await cdp.attach(xTarget);
await page.send('Page.enable');
await sleep(500);

const probe = `(() => {
  const containers = [...document.querySelectorAll('[data-testid^="UserAvatar-Container-"]')];
  function describe(el) {
    if (!el) return null;
    const imgs = [...el.querySelectorAll('img')];
    const bgEls = [...el.querySelectorAll('*')].filter(n => {
      const bg = getComputedStyle(n).backgroundImage;
      return bg && bg !== 'none';
    });
    return {
      testid: el.getAttribute('data-testid'),
      htmlLen: el.innerHTML.length,
      imgCount: imgs.length,
      imgSrcs: imgs.map(i => (i.getAttribute('src') || '').slice(0, 70)),
      bgCount: bgEls.length,
      bgSample: bgEls.slice(0, 2).map(n => getComputedStyle(n).backgroundImage.slice(0, 90)),
      hasSvg: !!el.querySelector('svg'),
      innerHead: el.innerHTML.slice(0, 260)
    };
  }
  const tweet = document.querySelector('[data-testid="tweet"]');
  const tweetAvatar = tweet?.querySelector('[data-testid^="UserAvatar-Container-"]');
  return JSON.stringify({
    containerTotal: containers.length,
    sidebar: describe(document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"] [data-testid^="UserAvatar-Container-"]')),
    tweetAvatar: describe(tweetAvatar),
    tweetAvatarParentHtml: (tweetAvatar?.parentElement?.innerHTML || '').slice(0, 400)
  });
})()`;

console.log(JSON.stringify(JSON.parse(await page.eval(probe)), null, 2));
process.exit(0);
