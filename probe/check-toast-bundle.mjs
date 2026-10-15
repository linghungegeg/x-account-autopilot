// 在 X 自己的 JS 包里搜 toast testid —— 零副作用，用来判断这个 testid 是否还存在。
import { connect } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;

// 从当前页面拿实际加载的脚本列表
const cdp = await connect({ port: PORT });
const page = await cdp.page(0);
const scripts = await page.eval(`[...document.scripts].map(s => s.src).filter(s => s.includes('abs.twimg.com'))`);
page.close();

console.log(`页面上加载了 ${scripts.length} 个 abs.twimg.com 脚本`);
console.log('（关闭 CDP 连接，下面用 Node 直接拉取，不经过浏览器）\n');

let totalHits = 0;
const samples = [];

for (const url of scripts) {
  let text;
  try {
    const response = await fetch(url);
    text = await response.text();
  } catch (error) {
    continue;
  }

  // 找 testId: "toast" / data-testid="toast" 这类写法
  const patterns = [
    /data-testid["':\s]+["']toast["']/gi,
    /testId["':\s]+["']toast["']/gi,
    /["']toast["']\s*:/gi
  ];
  let hits = 0;
  for (const pattern of patterns) hits += [...text.matchAll(pattern)].length;
  if (!hits) continue;

  totalHits += hits;
  const name = url.split('/').pop();
  console.log(`  ${name}  (${Math.round(text.length / 1024)}KB)  命中 ${hits}`);
  for (const match of text.matchAll(/.{0,70}testId["':\s]+["']toast["'].{0,70}/gi)) {
    samples.push(`${name}: ${match[0].replace(/\s+/g, ' ')}`);
    if (samples.length >= 5) break;
  }
  if (samples.length >= 5) break;
}

console.log('\n=== 结论 ===');
if (totalHits) {
  console.log(`✅ X 的客户端代码里仍然存在 toast testid（共命中 ${totalHits} 次）`);
  samples.forEach((s, i) => console.log(`  ${i + 1}. ${s.slice(0, 160)}`));
} else {
  console.log('❌ 在加载的脚本里没找到 toast testid 的写法');
  console.log('   注意：这只说明"没搜到"，不百分百等于"不存在"（可能是动态拼接的）。');
}
process.exit(0);
