// 诊断：x.com 到底哪个元素在滚动？window.scrollBy 为什么没效果？
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2000);

const tabId = await ext.eval(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(t => t[0]?.id ?? null)`);

await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com/search?q=AI&src=typed_query&f=live' })`);
await sleep(10000);

const DIAG = `() => {
  const out = {
    windowScrollY: Math.round(window.scrollY),
    docScrollTop: Math.round(document.scrollingElement?.scrollTop || 0),
    bodyScrollTop: Math.round(document.body.scrollTop),
    docScrollHeight: document.scrollingElement?.scrollHeight,
    innerHeight: window.innerHeight,
    scrollable: []
  };
  for (const el of document.querySelectorAll('*')) {
    if (el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 200) {
      const s = getComputedStyle(el);
      if (/auto|scroll/.test(s.overflowY)) {
        out.scrollable.push({
          tag: el.tagName,
          tid: el.getAttribute('data-testid'),
          cls: (el.className || '').toString().slice(0, 40),
          scrollTop: Math.round(el.scrollTop),
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight
        });
        if (out.scrollable.length >= 5) break;
      }
    }
  }
  return out;
}`;

console.log('=== 滚动容器诊断 ===');
const before = await ext.eval(`
  chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: ${DIAG} })
    .then(r => JSON.stringify(r[0]?.result, null, 2)).catch(e => 'ERR: ' + e.message)
`);
console.log(before);

// 试三种滚动方式，看哪个有效
console.log('\n=== 测试各种滚动方式 ===');
const tryScroll = async (label, expr) => {
  const result = await ext.eval(`
    chrome.scripting.executeScript({
      target: { tabId: ${tabId} },
      func: () => {
        const start = {
          win: Math.round(window.scrollY),
          doc: Math.round(document.scrollingElement?.scrollTop || 0)
        };
        ${expr}
        return new Promise(resolve => setTimeout(() => resolve({
          start,
          end: { win: Math.round(window.scrollY), doc: Math.round(document.scrollingElement?.scrollTop || 0) },
          moved: (window.scrollY > start.win) || ((document.scrollingElement?.scrollTop || 0) > start.doc)
        }), 1500));
      }
    }).then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
  `);
  console.log(`${label}: ${result}`);
  return result;
};

await tryScroll('1. window.scrollBy smooth', `window.scrollBy({ top: 600, behavior: 'smooth' });`);
await sleep(1000);
await tryScroll('2. window.scrollBy 立即', `window.scrollBy(0, 600);`);
await sleep(1000);
await tryScroll('3. window.scrollTo', `window.scrollTo(0, window.scrollY + 600);`);
await sleep(1000);
await tryScroll('4. 滚 primaryColumn', `
  const pc = document.querySelector('[data-testid="primaryColumn"]');
  const scroller = pc ? (pc.closest('[style*="overflow"]') || pc.parentElement) : null;
  if (scroller) scroller.scrollTop += 600;
`);

process.exit(0);
