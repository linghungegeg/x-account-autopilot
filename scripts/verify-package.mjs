// 校验打出来的 zip：能否解压、版本对不对、和目录内容是否一致、图标是否有效。
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const version = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).version;
const zipPath = join(root, 'dist', `x-nurture-helper-${version}.zip`);
const dirPath = join(root, 'dist', `x-nurture-helper-${version}`);

const fail = message => { console.log('  ❌ ' + message); process.exitCode = 1; };
const ok = message => console.log('  ✅ ' + message);

console.log(`=== 校验 v${version} ===\n`);

// 1. 文件存在
console.log('1. 文件存在性');
for (const [label, p] of [['zip', zipPath], ['解压目录', dirPath]]) {
  if (existsSync(p)) ok(`${label}: ${relative(root, p)}`); else fail(`${label} 不存在: ${p}`);
}

// 2. zip 能被解压（用 PowerShell 的 Expand-Archive，等价于用户的操作）
console.log('\n2. zip 可解压性（模拟用户解压）');
const tmp = mkdtempSync(join(tmpdir(), 'xzip-'));
try {
  execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${tmp}' -Force`], { stdio: 'pipe' });
  ok('解压成功');
} catch (error) {
  fail('解压失败: ' + String(error.stderr || error.message).slice(0, 200));
}

// 3. 列出所有文件并对比
// 注意 base：递归时路径必须相对最初的根目录算，
// 否则嵌套文件会丢掉 src/lib 这类前缀（第一版就踩了这个坑）。
const walk = (dir, base = dir) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).replace(/\\/g, '/'));
  }
  return out;
};

console.log('\n3. zip 内容 vs 目录内容');
const fromZip = walk(tmp).sort();
const fromDir = walk(dirPath).sort();
const onlyZip = fromZip.filter(f => !fromDir.includes(f));
const onlyDir = fromDir.filter(f => !fromZip.includes(f));
if (!onlyZip.length && !onlyDir.length) ok(`${fromZip.length} 个文件完全一致`);
else {
  if (onlyZip.length) fail('只在 zip 里: ' + onlyZip.join(', '));
  if (onlyDir.length) fail('只在目录里: ' + onlyDir.join(', '));
}

// 4. 逐字节比对
console.log('\n4. 逐字节比对');
let mismatch = 0;
for (const file of fromZip) {
  const a = readFileSync(join(tmp, file));
  const b = readFileSync(join(dirPath, file));
  if (!a.equals(b)) { fail(`内容不一致: ${file}`); mismatch += 1; }
}
if (!mismatch) ok('所有文件逐字节一致');

// 5. manifest 校验
console.log('\n5. manifest.json');
const manifest = JSON.parse(readFileSync(join(tmp, 'manifest.json'), 'utf8'));
manifest.version === version ? ok(`version = ${manifest.version}`) : fail(`version 是 ${manifest.version}，期望 ${version}`);
manifest.manifest_version === 3 ? ok('manifest_version = 3') : fail('不是 MV3');
ok(`权限: ${(manifest.permissions || []).join(', ')}`);

// 6. 图标有效性
console.log('\n6. 图标');
for (const size of [16, 32, 48, 128]) {
  const rel = manifest.icons?.[String(size)];
  if (!rel) { fail(`manifest 缺少 ${size} 图标`); continue; }
  const buf = readFileSync(join(tmp, rel));
  const isPng = buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  (isPng && w === size && h === size)
    ? ok(`${rel}  ${w}x${h}  ${Math.round(buf.length / 1024 * 10) / 10} KB`)
    : fail(`${rel} 无效: png=${isPng} ${w}x${h}`);
}

// 7. 版本号没有残留
console.log('\n7. 版本号一致性');
const stale = [];
for (const file of fromZip.filter(f => /\.(json|js|html|md)$/.test(f))) {
  const text = readFileSync(join(tmp, file), 'utf8');
  const matches = text.match(/0\.3\.\d+/g);
  if (matches) stale.push(`${file}: ${[...new Set(matches)].join(',')}`);
}
stale.length ? fail('仍有旧版本号: ' + stale.join(' | ')) : ok('没有旧版本号残留');

// 8. 关键文件非空
console.log('\n8. 关键文件');
for (const file of ['src/background/service-worker.js', 'src/content/x-content.js', 'src/options/options.html', 'src/lib/guardrails.js']) {
  const size = statSync(join(tmp, file)).size;
  size > 500 ? ok(`${file}  ${Math.round(size / 1024)} KB`) : fail(`${file} 只有 ${size} 字节`);
}

rmSync(tmp, { recursive: true, force: true });
console.log('\n' + (process.exitCode ? '❌ 有问题' : '✅ 全部通过'));
