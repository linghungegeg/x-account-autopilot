// 解卡：渲染进程被原生 JS 弹窗（X 的"离开此页面？"确认框）阻塞时，
// Runtime.enable 会一直挂住。这里绕过 attach()，直接用浏览器进程能处理的
// Page.handleJavaScriptDialog 把弹窗关掉。
const PORT = Number(process.env.X_CDP_PORT) || 9223;
const HOST = '127.0.0.1';

const list = await fetch(`http://${HOST}:${PORT}/json/list`).then(r => r.json());
const page = list.find(t => t.type === 'page' && t.url.includes('x.com'));
if (!page) { console.log('没有 x.com 页面目标'); process.exit(1); }
console.log('目标:', page.title, '—', page.url);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

const send = (id, method, params = {}) => {
  ws.send(JSON.stringify({ id, method, params }));
};

ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data);
  if (msg.method === 'Page.javascriptDialogOpening') {
    console.log('检测到弹窗:', msg.params.type, '|', msg.params.message);
    send(90, 'Page.handleJavaScriptDialog', { accept: true });
    console.log('已确认关闭');
  }
  if (msg.id === 1) console.log('Page.enable 返回');
  if (msg.id === 2) console.log('handleJavaScriptDialog 返回:', JSON.stringify(msg.result || msg.error));
});

send(1, 'Page.enable');
send(2, 'Page.handleJavaScriptDialog', { accept: true });

await new Promise(r => setTimeout(r, 3000));

// 确认页面是否恢复响应
send(3, 'Runtime.evaluate', { expression: 'location.href', returnByValue: true });
await new Promise(r => setTimeout(r, 3000));

ws.close();
console.log('完成');
process.exit(0);
