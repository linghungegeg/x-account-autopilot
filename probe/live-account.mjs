// 诊断：账号信息到底从哪里取。readAccount() 目前依赖 innerText，实测是空的。
import { connect } from './cdp.js';

const cdp = await connect({ port: Number(process.env.X_CDP_PORT) || 9223 });
const page = await cdp.page(0);
await page.send('Page.enable');
await page.goto('https://x.com/home', { waitMs: 4000 });

const dump = await page.eval(`(() => {
  const out = {};
  const btn = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
  out.switcher = btn ? {
    innerText: JSON.stringify(btn.innerText),
    textContent: JSON.stringify((btn.textContent || '').slice(0, 80)),
    aria: btn.getAttribute('aria-label'),
    html: btn.outerHTML.slice(0, 700)
  } : null;

  const profileLink = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
  out.profileLink = profileLink ? {
    href: profileLink.getAttribute('href'),
    aria: profileLink.getAttribute('aria-label')
  } : null;

  out.avatarContainers = [...document.querySelectorAll('[data-testid^="UserAvatar-Container-"]')]
    .map(e => e.getAttribute('data-testid')).slice(0, 5);

  out.userNameNodes = [...document.querySelectorAll('[data-testid="UserName"]')]
    .slice(0, 3).map(e => (e.innerText || '').replace(/\\n/g, ' | ').slice(0, 60));

  out.imagesInSwitcher = btn ? [...btn.querySelectorAll('img')].map(i => ({
    alt: i.getAttribute('alt'), src: (i.getAttribute('src') || '').slice(0, 60)
  })) : [];

  return out;
})()`);

console.log(JSON.stringify(dump, null, 2));

// 顺便确认 sidebar 里能不能稳定拿到 handle
const fromProfileLink = await page.eval(`(() => {
  const a = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
  return a ? a.getAttribute('href').replace(/^\\//, '') : null;
})()`);
console.log('\n从 AppTabBar_Profile_Link 拿到的 handle:', fromProfileLink);

page.close();
process.exit(0);
