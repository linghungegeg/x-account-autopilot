// 确认这个 Chrome profile 的 X 登录状态。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9224;
const EXT_ID = process.env.EXT_ID || 'beoeccdkmifoakblkibgmedccfknhfbi';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(3000);

const ev = (expr, timeoutMs = 60000) => page.eval(expr, { timeoutMs });

const tabs = JSON.parse(await ev(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(t => JSON.stringify(t.map(x => x.id)))`));
for (const id of tabs) {
  const info = await ev(`
    chrome.scripting.executeScript({
      target: { tabId: ${id} },
      func: () => ({
        path: location.pathname,
        title: document.title,
        // 登录态特征
        hasAccountSwitcher: !!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]'),
        hasLoginButton: !!document.querySelector('[data-testid="loginButton"]'),
        profileLink: document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href') || null,
        hasPrimaryColumn: !!document.querySelector('[data-testid="primaryColumn"]'),
        bodyHint: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 120)
      })
    }).then(r => JSON.stringify(r[0]?.result, null, 2)).catch(e => 'ERR: ' + e.message)
  `, 30000);
  console.log(`=== 标签页 ${id} ===`);
  console.log(info);
}

console.log('\n=== cookies 里有没有 auth_token ===');
console.log(await ev(`
  chrome.cookies.get({ url: 'https://x.com', name: 'auth_token' })
    .then(c => JSON.stringify({ loggedIn: !!c, domain: c?.domain }))
    .catch(e => 'ERR: ' + e.message)
`));

process.exit(0);
