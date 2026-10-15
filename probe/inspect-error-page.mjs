// dump chrome://extensions 错误页的 shadow DOM 结构，找出「全部清除」控件。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9224;
const EXT_ID = process.env.EXT_ID || 'beoeccdkmifoakblkibgmedccfknhfbi';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome://extensions/?errors=${EXT_ID}`);
await page.send('Page.enable');
await sleep(4000);

console.log(await page.eval(`(() => {
  const out = [];
  const scan = (root, label) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.tagName === 'EXTENSIONS-ERROR-PAGE' && el.shadowRoot) {
        const sr = el.shadowRoot;
        out.push('--- ' + label + ' extensions-error-page shadowRoot ---');
        out.push('children: ' + [...sr.children].map(c => c.tagName + (c.id ? '#' + c.id : '')).join(', '));
        out.push('all tags: ' + [...sr.querySelectorAll('*')].map(c => c.tagName + (c.id ? '#' + c.id : '') + (c.className && typeof c.className === 'string' ? '.' + c.className.split(' ')[0] : '')).join(' | '));
        out.push('buttons: ' + [...sr.querySelectorAll('button, a, cr-button')].map(b => JSON.stringify({ tag: b.tagName, id: b.id, text: (b.textContent || '').trim().slice(0, 30) })).join(' , '));
        out.push('html head: ' + sr.innerHTML.replace(/\\s+/g, ' ').slice(0, 900));
      }
    }
  };
  scan(document, 'document');
  const manager = document.querySelector('extensions-manager');
  if (manager?.shadowRoot) scan(manager.shadowRoot, 'manager');
  return out.join('\\n');
})()`));
process.exit(0);
