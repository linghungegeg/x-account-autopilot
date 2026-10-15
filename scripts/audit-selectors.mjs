// 选择器核对：把源码里用到的 data-testid 与 probe/ 下真实抓取的结果对一遍，
// 分清哪些是"实际抓过、有据可依"，哪些是"照着惯例猜的、没验证过"。
//
// 用法：node scripts/audit-selectors.mjs
// 注意：probe/ 里的抓取结果被 .gitignore 挡着，新克隆的仓库里没有这些文件。

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const PROBE_DIR = join(root, 'probe');
const SRC_DIRS = ['src'];

// ---------------------------------------------------------------- 抓取结果

function collectTestIds(value, out = new Set()) {
  if (typeof value === 'string') {
    // 探针结果里经常嵌着 HTML 片段，从里面也能提取 testid
    for (const match of value.matchAll(/data-testid="([^"]+)"/g)) out.add(match[1]);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTestIds(item, out);
    return out;
  }
  if (!value || typeof value !== 'object') return out;

  for (const [key, child] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (typeof child === 'string' && (key === 'tid' || lower.endsWith('testid'))) {
      out.add(child);
      continue;
    }
    if (Array.isArray(child) && (lower.includes('testid') || key === 'profile')) {
      for (const item of child) if (typeof item === 'string') out.add(item);
      continue;
    }
    if (key === 'keyCounts' && child && typeof child === 'object') {
      // 计数为 0 表示探针明确找过但页面上不存在，不能算"有依据"
      for (const [name, count] of Object.entries(child)) {
        if (Number(count) > 0) out.add(name);
      }
      continue;
    }
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object') collectTestIds(item, out);
        else if (typeof item === 'string' && /^[A-Za-z][\w.\-]*$/.test(item)) out.add(item);
      }
      continue;
    }
    collectTestIds(child, out);
  }
  return out;
}

function loadObserved() {
  if (!existsSync(PROBE_DIR)) return { ids: new Set(), files: [] };
  const ids = new Set();
  const files = [];

  for (const name of readdirSync(PROBE_DIR)) {
    if (!/\.(json|txt)$/.test(name)) continue;
    const path = join(PROBE_DIR, name);
    const raw = readFileSync(path, 'utf8');
    files.push(name);
    try {
      collectTestIds(JSON.parse(raw), ids);
    } catch {
      // 非严格 JSON（探针偶尔写成一行）时退回正则粗提
      for (const match of raw.matchAll(/"([A-Za-z][\w.\-]*)"/g)) ids.add(match[1]);
    }
  }
  return { ids, files };
}

// ---------------------------------------------------------------- 源码用法

function collectUsed() {
  const used = new Map(); // testid -> Set(文件)

  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(js|mjs)$/.test(entry.name)) continue;
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(/data-testid(\$)?=["']([^"']+)["']/g)) {
        const id = match[2];
        if (!used.has(id)) used.set(id, new Set());
        used.get(id).add(path.replace(root + '\\', '').replace(root + '/', ''));
      }
    }
  };

  for (const dir of SRC_DIRS) walk(join(root, dir));
  return used;
}

// ---------------------------------------------------------------- 输出

const { ids: observed, files } = loadObserved();
const used = collectUsed();

const isObserved = id => {
  if (observed.has(id)) return true;
  // 前缀型选择器（例如 -follow / -unfollow）按后缀匹配
  if (id.startsWith('-')) return [...observed].some(seen => seen.endsWith(id));
  return false;
};

const rows = [...used.entries()]
  .map(([id, sources]) => ({ id, sources: [...sources].join(', '), ok: isObserved(id) }))
  .sort((a, b) => Number(a.ok) - Number(b.ok) || a.id.localeCompare(b.id));

const grounded = rows.filter(row => row.ok);
const guessed = rows.filter(row => !row.ok);

console.log(`探针结果文件：${files.length ? files.join(', ') : '（无）'}`);
console.log(`探针里出现过的 testid 共 ${observed.size} 个\n`);

console.log(`✅ 有真实抓取依据的（${grounded.length}）`);
for (const row of grounded) console.log(`   ${row.id.padEnd(34)} ${row.sources}`);

console.log(`\n⚠️  没有抓取依据、靠惯例写的（${guessed.length}）`);
for (const row of guessed) console.log(`   ${row.id.padEnd(34)} ${row.sources}`);

if (!files.length) {
  console.log('\n提示：probe/ 下没有抓取结果，无法核对。');
}

process.exitCode = 0;
