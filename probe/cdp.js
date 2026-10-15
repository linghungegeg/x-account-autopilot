/* 极简 CDP 客户端 (Node 24 原生 WebSocket, 零依赖)
   用法:
     import {connect} from './cdp.js';
     const cdp = await connect({port: 9223});   // 默认 9222，可用 X_CDP_PORT 覆盖
     const page = await cdp.page();             // 拿一个已存在的页面
     await page.eval('1+1');

   注意: 本文件是 ES module (package.json 里 type=module)。
*/
import { writeFileSync } from 'node:fs';

const DEFAULT_PORT = Number(process.env.X_CDP_PORT) || 9222;

async function json(host, port, path) {
  const r = await fetch(`http://${host}:${port}${path}`);
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
}

async function listTargets({host = '127.0.0.1', port = DEFAULT_PORT} = {}) {
  return json(host, port, '/json/list');
}

class Session {
  constructor(ws, target) {
    this.ws = ws; this.target = target;
    this.id = 0; this.pending = new Map(); this.handlers = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const {resolve, reject} = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers) h(msg);
      }
    });
  }
  send(method, params = {}, timeoutMs = 30000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {resolve, reject});
      this.ws.send(JSON.stringify({id, method, params}));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout: ' + method)); }
      }, timeoutMs);
    });
  }
  on(fn) { this.handlers.push(fn); return () => { this.handlers = this.handlers.filter(h => h !== fn); }; }
  waitFor(method, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { off(); reject(new Error('waitFor timeout: ' + method)); }, timeout);
      const off = this.on((m) => { if (m.method === method) { clearTimeout(t); off(); resolve(m.params); } });
    });
  }
  /* 在页面主世界执行表达式, 返回 JSON 值。长任务（例如生图 40 秒）要调大 timeoutMs */
  async eval(expr, {awaitPromise = true, timeoutMs = 30000} = {}) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise, userGesture: true,
    }, timeoutMs);
    if (r.exceptionDetails) throw new Error('page error: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result?.value;
  }
  async goto(url, {waitMs = 2500} = {}) {
    await this.send('Page.enable');
    const loaded = this.waitFor('Page.loadEventFired', 30000).catch(() => null);
    await this.send('Page.navigate', {url});
    await loaded;
    if (waitMs) await sleep(waitMs);
  }
  async shot(path, {fullPage = false} = {}) {
    const opts = {format: 'png'};
    if (fullPage) { const m = await this.send('Page.getLayoutMetrics'); const c = m.cssContentSize; opts.clip = {x:0,y:0,width:c.width,height:c.height,scale:1}; opts.captureBeyondViewport = true; }
    const r = await this.send('Page.captureScreenshot', opts);
    writeFileSync(path, Buffer.from(r.data, 'base64'));
    return path;
  }
  close() { try { this.ws.close(); } catch {} }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function connect({port = DEFAULT_PORT, host = '127.0.0.1'} = {}) {
  const list = await json(host, port, '/json/list');
  const pages = list.filter(t => t.type === 'page' && !t.url.startsWith('devtools://'));
  return {
    targets: list,
    pages,
    async attach(target) {
      const t = typeof target === 'number' ? pages[target] : target;
      const ws = new WebSocket(t.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
      const s = new Session(ws, t);
      await s.send('Runtime.enable');
      return s;
    },
    async page(i = 0) { return this.attach(pages[i]); },
    async newPage(url = 'about:blank') {
      const t = await fetch(`http://${host}:${port}/json/new?${encodeURIComponent(url)}`, {method:'PUT'}).then(r=>r.json());
      const ws = new WebSocket(t.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
      const s = new Session(ws, t); await s.send('Runtime.enable'); return s;
    },
  };
}

export { connect, sleep, listTargets };

