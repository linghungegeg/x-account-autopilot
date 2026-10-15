// 深挖 /compose/post 的结构：工具栏、对话框、按钮。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);
const tabId = await ext.eval(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(t => t[0]?.id ?? null)`);

// 当前页面应该还停在 /compose/post
const DUMP = `() => {
  const out = { path: location.pathname };

  out.dialogs = [...document.querySelectorAll('[role="dialog"]')].map(d => ({
    tid: d.getAttribute('data-testid'),
    aria: d.getAttribute('aria-label'),
    text: (d.innerText || '').slice(0, 80).replace(/\\n/g, ' | ')
  }));

  const toolbar = document.querySelector('[data-testid="toolBar"]');
  out.toolbar = toolbar ? {
    html: toolbar.outerHTML.slice(0, 900),
    buttons: [...toolbar.querySelectorAll('button,[role="button"]')].map(b => ({
      tid: b.getAttribute('data-testid'),
      aria: b.getAttribute('aria-label'),
      disabled: b.getAttribute('aria-disabled')
    }))
  } : null;

  // 编辑器所在的容器
  const editor = document.querySelector('[data-testid="tweetTextarea_0"]');
  out.editorContainer = editor ? {
    html: editor.closest('[data-testid="tweetTextarea_0RichTextInputContainer"]')?.outerHTML.slice(0, 400) || null,
    ancestors: (() => {
      const names = [];
      let el = editor;
      for (let i = 0; i < 8 && el; i += 1) { names.push(el.tagName + (el.getAttribute('data-testid') ? '[' + el.getAttribute('data-testid') + ']' : '')); el = el.parentElement; }
      return names;
    })()
  } : null;

  out.allFileInputs = document.querySelectorAll('input[type="file"]').length;
  out.allAriaLabels = [...new Set([...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label')))].slice(0, 25);

  return out;
}`;

console.log('=== /compose/post 结构 ===');
const dump = await ext.eval(`
  chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: ${DUMP} })
    .then(r => JSON.stringify(r[0]?.result, null, 2)).catch(e => 'ERR: ' + e.message)
`);
console.log(dump);

// 试试点工具栏里的按钮，看会不会出现 fileInput
console.log('\n=== 尝试点工具栏按钮，观察是否出现 fileInput ===');
const CLICK_ALL = `() => {
  const toolbar = document.querySelector('[data-testid="toolBar"]');
  if (!toolbar) return 'no-toolbar';
  const btns = [...toolbar.querySelectorAll('button,[role="button"]')];
  const labels = btns.map(b => b.getAttribute('aria-label') || b.getAttribute('data-testid') || '?');
  // 点第一个不是"添加位置"之类的
  const target = btns[0];
  if (target) target.click();
  return JSON.stringify(labels);
}`;
console.log('工具栏按钮:', await ext.eval(`
  chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: ${CLICK_ALL} })
    .then(r => r[0]?.result).catch(e => 'ERR: ' + e.message)
`));
await sleep(2500);
console.log('点击后 fileInput 数:', await ext.eval(`
  chrome.scripting.executeScript({
    target: { tabId: ${tabId} },
    func: () => document.querySelectorAll('input[type="file"]').length
  }).then(r => r[0]?.result).catch(e => 'ERR: ' + e.message)
`));

process.exit(0);
