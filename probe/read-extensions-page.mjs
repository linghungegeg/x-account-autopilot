// 读 chrome://extensions 的真实列表（要穿透多层 shadow DOM）。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9224;

const cdp = await connect({ port: PORT });
const page = await cdp.newPage('chrome://extensions/');
await page.send('Page.enable');
await sleep(5000);

const dump = await page.eval(`
  (() => {
    const mgr = document.querySelector('extensions-manager');
    if (!mgr) return JSON.stringify({ error: '没有 extensions-manager' });

    // 逐层穿透
    const deep = (root, selector) => {
      const found = root.querySelector(selector);
      if (found) return found;
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) {
          const inner = deep(el.shadowRoot, selector);
          if (inner) return inner;
        }
      }
      return null;
    };

    const toolbar = deep(mgr.shadowRoot, 'extensions-toolbar');
    const devMode = toolbar?.shadowRoot?.querySelector('#devMode');
    const list = deep(mgr.shadowRoot, 'extensions-item-list');
    const items = list?.shadowRoot ? [...list.shadowRoot.querySelectorAll('extensions-item')] : [];

    return JSON.stringify({
      developerMode: devMode ? (devMode.checked ?? devMode.hasAttribute('checked')) : null,
      itemCount: items.length,
      items: items.map(item => {
        const sr = item.shadowRoot;
        return {
          id: item.getAttribute('id') || item.id,
          name: sr?.querySelector('#name')?.textContent?.trim() || '(无名)',
          version: sr?.querySelector('#version')?.textContent?.trim() || '',
          description: sr?.querySelector('#description')?.textContent?.trim()?.slice(0, 60) || '',
          errors: sr?.querySelector('#errors-button')?.textContent?.trim() || '无'
        };
      })
    }, null, 2);
  })()
`).catch(e => 'ERR: ' + e.message);

console.log(dump);
process.exit(0);
