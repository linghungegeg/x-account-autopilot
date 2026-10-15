// 核对 options.js 里引用的每个 DOM id 在 options.html 里是否真的存在。
// 少一个就会让 init() 中途抛错，后面所有按钮都绑不上事件。
import { readFileSync } from 'node:fs';

const js = readFileSync('src/options/options.js', 'utf8');
const html = readFileSync('src/options/options.html', 'utf8');

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));

// options.js 里所有 $('#xxx') 和 querySelector('#xxx')
const used = new Set([...js.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]));
for (const m of js.matchAll(/querySelector(?:All)?\('#([A-Za-z0-9_-]+)/g)) used.add(m[1]);

console.log(`options.html 里定义了 ${htmlIds.size} 个 id`);
console.log(`options.js 里引用了 ${used.size} 个 id\n`);

const missing = [...used].filter(id => !htmlIds.has(id)).sort();
const unused = [...htmlIds].filter(id => !used.has(id)).sort();

if (missing.length) {
  console.log('❌ options.js 引用了但 HTML 里不存在的 id（会导致 init() 抛错）:');
  missing.forEach(id => console.log('   #' + id));
} else {
  console.log('✅ 引用的 id 全部存在');
}

if (unused.length) {
  console.log('\nℹ️  HTML 里有但 JS 没引用的 id（可能只是 CSS/标签用，不一定是问题）:');
  unused.forEach(id => console.log('   #' + id));
}

// 特别检查 init() 里绑定事件用到的 id，按绑定顺序
const initBlock = js.slice(js.indexOf('async function init()'), js.indexOf('function showPane'));
const bound = [...initBlock.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]);
const boundMissing = bound.filter(id => !htmlIds.has(id));
console.log('\n=== init() 里按顺序绑定的 id ===');
console.log('  ' + bound.join(', '));
if (boundMissing.length) {
  console.log('\n❌ 其中不存在的: ' + boundMissing.join(', '));
  console.log('   第一个缺失的会在这里抛错，它之后的绑定全部失效。');
} else {
  console.log('\n✅ init() 绑定的 id 全部存在');
}

// RHYTHM_INPUTS 也要检查
const rhythmBlock = js.slice(js.indexOf('const RHYTHM_INPUTS'), js.indexOf('const ACTIONS'));
const rhythm = [...rhythmBlock.matchAll(/'#([A-Za-z0-9_-]+)'/g)].map(m => m[1]);
const rhythmMissing = rhythm.filter(id => !htmlIds.has(id));
console.log('\n=== RHYTHM_INPUTS ===');
if (rhythmMissing.length) console.log('❌ 不存在: ' + rhythmMissing.join(', '));
else console.log('✅ 全部存在（' + rhythm.length + ' 个）');

process.exitCode = (missing.length || boundMissing.length || rhythmMissing.length) ? 1 : 0;
