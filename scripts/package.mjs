// 打包扩展为 zip。零依赖，手写 ZIP（deflate + 中央目录），和 make-icons.mjs 一样不引第三方库。
//
// 用法：node scripts/package.mjs
// 产物：dist/x-nurture-helper-<version>.zip

import { deflateRawSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';

const root = join(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

// 打入扩展运行文件及 README 引用的图片，开发用的目录一律排除
const INCLUDE_FILES = ['manifest.json', 'README.md', 'README.en.md', 'LICENSE'];
const INCLUDE_DIRS = ['src', 'icons', 'img'];
const EXCLUDE = [/(^|\/)\./, /node_modules/, /\.test\.mjs$/, /\.map$/];

// ---------------------------------------------------------------- 收集文件

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(root, full).split(sep).join('/');
    if (EXCLUDE.some(pattern => pattern.test(rel))) continue;
    if (entry.isDirectory()) walk(full, out);
    else out.push(rel);
  }
  return out;
}

const files = [...INCLUDE_FILES];
for (const dir of INCLUDE_DIRS) {
  const full = join(root, dir);
  try {
    if (statSync(full).isDirectory()) files.push(...walk(full));
  } catch {
    // 目录不存在就跳过
  }
}
files.sort();

// ---------------------------------------------------------------- ZIP 写入

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// DOS 时间格式（固定成 manifest 的版本时间不重要，用当前时间即可）
function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

const { time: dosTime, day: dosDate } = dosDateTime();
const localParts = [];
const centralParts = [];
let offset = 0;

for (const name of files) {
  const raw = readFileSync(join(root, name));
  const deflated = deflateRawSync(raw, { level: 9 });
  // 压缩后反而更大时用存储模式
  const useStore = deflated.length >= raw.length;
  const data = useStore ? raw : deflated;
  const method = useStore ? 0 : 8;
  const nameBytes = Buffer.from(name, 'utf8');
  const crc = crc32(raw);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28);
  localParts.push(local, nameBytes, data);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt16LE(dosTime, 12);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(offset, 42);
  centralParts.push(central, nameBytes);

  offset += local.length + nameBytes.length + data.length;
}

const centralBuffer = Buffer.concat(centralParts);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(files.length, 8);
eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(centralBuffer.length, 12);
eocd.writeUInt32LE(offset, 16);
eocd.writeUInt16LE(0, 20);

const zip = Buffer.concat([...localParts, centralBuffer, eocd]);

const outDir = join(root, 'dist');
const unpackedDir = join(outDir, `x-nurture-helper-${manifest.version}`);
mkdirSync(unpackedDir, { recursive: true });

// 同时输出解压目录：Chrome 只能"加载已解压的扩展程序"，
// 把目录一起产出，修完代码重跑一次就能直接同步给浏览器里的那份。
for (const name of files) {
  const target = join(unpackedDir, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, readFileSync(join(root, name)));
}

const outPath = join(outDir, `x-nurture-helper-${manifest.version}.zip`);
writeFileSync(outPath, zip);

console.log(`已打包 ${files.length} 个文件`);
console.log(`  zip:  ${relative(root, outPath)}  (${Math.round(zip.length / 1024)} KB)`);
console.log(`  目录: ${relative(root, unpackedDir)}`);
console.log('');
for (const name of files) {
  const size = statSync(join(root, name)).size;
  console.log(`  ${name.padEnd(42)} ${String(Math.round(size / 1024)).padStart(5)} KB`);
}
