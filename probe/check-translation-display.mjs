// 查清"显示成中文"的真相：是存储里就是中文，还是浏览器把页面翻译了？
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(3000);

// 切到发帖计划
await page.eval(`document.querySelector('.nav button[data-pane="plan"]')?.click()`);
await sleep(1000);

console.log('=== 1. 浏览器有没有在翻译这个页面 ===');
console.log(await page.eval(`JSON.stringify({
  htmlClass: document.documentElement.className,
  hasTranslatedClass: /translated/.test(document.documentElement.className),
  htmlLang: document.documentElement.lang,
  hasFontTags: document.querySelectorAll('font').length,
  // Chrome 翻译会在 <html> 上挂 translated-ltr / translated-rtl
  bodyAttr: document.body.getAttribute('class') || ''
})`));

console.log('\n=== 2. 存储里的真实内容（不经过页面渲染）===');
const stored = await page.eval(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify(
    r.state.postPlan.items.map(i => ({
      lang: i.language,
      weight: i.weight,
      text: i.text,
      source: i.source.slice(0, 40),
      // 中文字符占比
      cjk: (i.text.match(/[\\u4e00-\\u9fff]/g) || []).length,
      latin: (i.text.match(/[A-Za-z]/g) || []).length,
      kana: (i.text.match(/[\\u3040-\\u30ff]/g) || []).length,
      hangul: (i.text.match(/[\\uac00-\\ud7af]/g) || []).length
    })), null, 2)
  )
`);
console.log(stored);

console.log('\n=== 3. 页面上渲染出来的文本 ===');
console.log(await page.eval(`
  JSON.stringify([...document.querySelectorAll('#planItems .plan-item')].map(el => ({
    head: el.querySelector('.plan-head b')?.textContent,
    text: el.querySelector('.plan-text')?.textContent,
    meta: el.querySelector('.plan-meta')?.textContent?.slice(0, 50)
  })), null, 2)
`));

console.log('\n=== 4. 用 DOM 节点的原始值绕过翻译 ===');
console.log(await page.eval(`
  JSON.stringify([...document.querySelectorAll('#planItems .plan-text')].map(el => {
    // 翻译插件通常会改 textContent，但原始文本可以从 React 状态或直接读 innerHTML 对比
    const raw = el.textContent;
    return { textContent: raw, innerHTML: el.innerHTML.slice(0, 120) };
  }), null, 2)
`));

process.exit(0);
