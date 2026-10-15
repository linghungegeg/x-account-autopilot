// 把 icons/icon.svg 栅格化成 Chrome 要求的 PNG。
//
// 为什么不用纯 Node：Chrome 的 manifest 图标只接受位图（PNG/BMP/ICO/JPEG），
// 不支持 SVG。要做到"源是矢量的"，就得有个渲染器把 SVG 画成位图。
// 手写一个 SVG 光栅化器不值当，直接借已经跑着的浏览器用 canvas 导出，
// 这样既不引入任何依赖，又保证源文件是矢量。
//
// 用法：node scripts/make-icons.mjs
// 需要探测用的 Chrome 在跑（默认 9223 端口，可用 X_CDP_PORT 覆盖）。

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect } from '../probe/cdp.js';

const root = join(import.meta.dirname, '..');
const SIZES = [16, 32, 48, 128];
const svg = readFileSync(join(root, 'icons', 'icon.svg'), 'utf8');

let cdp;
try {
  cdp = await connect({ port: Number(process.env.X_CDP_PORT) || 9223 });
} catch (error) {
  console.error('连不上浏览器，无法栅格化 SVG。');
  console.error('请先启动带调试端口的 Chrome（node probe/... 那套），或设置 X_CDP_PORT。');
  console.error('原始错误:', error.message);
  process.exit(1);
}

const page = await cdp.newPage('about:blank');

for (const size of SIZES) {
  const dataUrl = await page.eval(`
    (async () => {
      const svgText = ${JSON.stringify(svg)};
      const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.width = ${size};
      img.height = ${size};
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('SVG 加载失败'));
        img.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = ${size};
      canvas.height = ${size};
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, ${size}, ${size});
      ctx.drawImage(img, 0, 0, ${size}, ${size});
      URL.revokeObjectURL(url);
      return canvas.toDataURL('image/png');
    })()
  `, { timeoutMs: 20000 });

  const base64 = String(dataUrl).split(',')[1];
  if (!base64) throw new Error(`尺寸 ${size} 没有拿到 PNG 数据`);
  const target = join(root, 'icons', `icon${size}.png`);
  writeFileSync(target, Buffer.from(base64, 'base64'));
  console.log(`  icon${size}.png  ${Math.round(Buffer.from(base64, 'base64').length / 1024 * 10) / 10} KB`);
}

await fetch(`http://127.0.0.1:${Number(process.env.X_CDP_PORT) || 9223}/json/close/${page.target.id}`, { method: 'PUT' }).catch(() => {});
console.log('\n图标已从 icons/icon.svg 栅格化生成。');
process.exit(0);
