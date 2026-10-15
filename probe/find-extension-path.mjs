// 从 Chrome 的 Preferences 里读出这个扩展的实际安装路径。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';
const PROFILES = [
  'E:\\x\\.chrome-debug-login\\Default\\Preferences',
  'E:\\x\\.chrome-debug\\Default\\Preferences'
];

for (const file of PROFILES) {
  if (!existsSync(file)) {
    console.log(`(跳过，不存在) ${file}`);
    continue;
  }
  console.log(`\n=== ${file} ===`);
  let prefs;
  try {
    prefs = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    console.log('  解析失败:', error.message);
    continue;
  }

  const settings = prefs.extensions?.settings || {};
  const entry = settings[EXT_ID];
  if (!entry) {
    console.log('  这个 profile 里没有该扩展');
    const unpacked = Object.entries(settings)
      .filter(([, v]) => v?.location === 4 || v?.path)
      .map(([id, v]) => `    ${id}  ${v.path || '(无路径)'}`);
    if (unpacked.length) console.log('  其它未打包扩展:', '\n' + unpacked.join('\n'));
    continue;
  }

  console.log('  名称:', entry.manifest?.name);
  console.log('  版本:', entry.manifest?.version);
  console.log('  location:', entry.location, '(4 = unpacked)');
  console.log('  >>> 安装路径:', entry.path);
  console.log('  该路径下 manifest.json 存在:', existsSync(join(entry.path || '', 'manifest.json')));
  console.log('  该路径下 mockup.html 存在:', existsSync(join(entry.path || '', 'mockup.html')));
}
