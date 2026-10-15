// 找到扩展现在挂在哪个 Chrome 实例上。
const PORTS = [9223, 9224, 9225];

for (const port of PORTS) {
  let list;
  try {
    list = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
  } catch {
    console.log(`端口 ${port}: 无响应`);
    continue;
  }
  const ext = list.filter(t => t.url.startsWith('chrome-extension://'));
  console.log(`端口 ${port}: ${list.filter(t => t.type === 'page').length} 个页面, ${ext.length} 个扩展目标`);
  for (const t of ext) console.log(`   [${t.type}] ${t.url.slice(0, 95)}`);

  // 试打开已知 ID 的页面
  const ids = [...new Set(ext.map(t => (t.url.match(/^chrome-extension:\/\/([a-p]+)/) || [])[1]).filter(Boolean))];
  for (const id of ids) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/new?chrome-extension://${id}/src/options/options.html`, { method: 'PUT' }).then(x => x.json());
      console.log(`   试打开 ${id} 的设置页 -> ${r.url ? 'OK' : '?'}`);
    } catch (e) {
      console.log(`   试打开 ${id} 失败: ${String(e.message).slice(0, 60)}`);
    }
  }
}
