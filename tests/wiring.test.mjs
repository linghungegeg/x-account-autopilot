// 接线检查：确保 UI 引用的 DOM id 都存在，且所有消息类型后台都有分支处理。
// 这类错误在浏览器里只会表现为"点了没反应"，所以放到单测里挡住。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = join(import.meta.dirname, '..');
const read = path => readFileSync(join(root, path), 'utf8');

const ACTIONS = ['reply', 'follow', 'like', 'post'];

function actionsIn(js) {
  const block = js.match(/^export const ACTIONS = \[([^\]]+)\]/m);
  if (!block) return [];
  return block[1].split(',').map(item => item.trim().replace(/['"]/g, '')).filter(Boolean);
}

function selectorsIn(js) {
  const found = new Set();
  for (const match of js.matchAll(/\$\(['"`]#([A-Za-z][\w-]*)['"`]\)/g)) found.add(match[1]);
  for (const match of js.matchAll(/bind\(['"`]#([A-Za-z][\w-]*)['"`]/g)) found.add(match[1]);
  for (const match of js.matchAll(/querySelectorAll\(['"`]#([A-Za-z][\w-]*)/g)) found.add(match[1]);
  // 展开 $(\`#${action}Hour\`) 这类模板写法
  for (const match of js.matchAll(/#\$\{action\}(Hour|Day)/g)) {
    for (const action of ACTIONS) found.add(`${action}${match[1]}`);
  }
  return [...found];
}

function idsIn(html) {
  return new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
}

function messageTypesIn(js) {
  return new Set([...js.matchAll(/type:\s*'([A-Z_]+)'/g)].map(match => match[1]));
}

function handledTypesIn(sw) {
  return new Set([...sw.matchAll(/case\s+'([A-Z_]+)'\s*:/g)].map(match => match[1]));
}

// 后台发进标签页的消息类型（callTab / chrome.tabs.sendMessage 的第二参）
function tabMessageTypesIn(sw) {
  const found = new Set();
  for (const match of sw.matchAll(/callTab\([^,]+,\s*\{\s*type:\s*'([A-Z_]+)'/g)) found.add(match[1]);
  for (const match of sw.matchAll(/chrome\.tabs\.sendMessage\([^,]+,\s*\{\s*type:\s*'([A-Z_]+)'/g)) found.add(match[1]);
  return found;
}

// 内容脚本能处理的类型：switch 分支 + handlers 映射的键
function contentHandledTypesIn(js) {
  const found = new Set();
  for (const match of js.matchAll(/case\s+'(X_[A-Z_]+)'\s*:/g)) found.add(match[1]);
  for (const match of js.matchAll(/^\s*(X_[A-Z_]+):\s*\(\)/gm)) found.add(match[1]);
  return found;
}

const popupHtml = read('src/popup/popup.html');
const popupJs = read('src/popup/popup.js');
const optionsHtml = read('src/options/options.html');
const optionsJs = read('src/options/options.js');
const contentJs = read('src/content/x-content.js');
const workerJs = read('src/background/service-worker.js');

test('popup.js 引用的每个 id 都存在于 popup.html', () => {
  const ids = idsIn(popupHtml);
  const missing = selectorsIn(popupJs).filter(id => !ids.has(id));
  assert.deepEqual(missing, []);
});

test('options.js 引用的每个 id 都存在于 options.html', () => {
  const ids = idsIn(optionsHtml);
  const missing = selectorsIn(optionsJs).filter(id => !ids.has(id));
  assert.deepEqual(missing, []);
});

test('popup / options / content 发送的消息类型后台都有处理分支', () => {
  const handled = handledTypesIn(workerJs);
  const sent = new Set([
    ...messageTypesIn(popupJs),
    ...messageTypesIn(optionsJs),
    ...messageTypesIn(contentJs)
  ]);
  const unhandled = [...sent].filter(type => !handled.has(type));
  assert.deepEqual(unhandled, []);
});

test('后台发进页面的每条消息内容脚本都能处理', () => {
  const sentToTab = tabMessageTypesIn(workerJs);
  assert.ok(sentToTab.size >= 5, `应至少识别出 5 种页面消息，实际 ${sentToTab.size}`);
  const handled = contentHandledTypesIn(contentJs);
  const unhandled = [...sentToTab].filter(type => !handled.has(type));
  assert.deepEqual(unhandled, []);
});

test('四个动作在内容脚本里都有实现', () => {
  const handled = contentHandledTypesIn(contentJs);
  for (const type of ['X_REPLY', 'X_LIKE', 'X_FOLLOW', 'X_POST', 'X_BROWSE']) {
    assert.ok(handled.has(type), `内容脚本缺少 ${type}`);
  }
});

test('内容脚本里的动作图标表与 guardrails 的 ACTIONS 不漂移', () => {
  const actions = actionsIn(read('src/lib/guardrails.js'));
  assert.ok(actions.length >= 5, `应至少识别出 5 个动作，实际 ${actions.length}`);

  // 内容脚本是普通脚本不能 import，图标表只能手抄一份，这里防止两边跑偏
  const iconBlock = contentJs.match(/const ACTION_ICONS = \{([^}]+)\}/)?.[1] || '';
  const labelBlock = contentJs.match(/const TYPE_LABELS = \{([^}]+)\}/)?.[1] || '';

  for (const action of actions) {
    assert.match(iconBlock, new RegExp(`\\b${action}:`), `ACTION_ICONS 缺少 ${action}`);
    assert.match(labelBlock, new RegExp(`\\b${action}:`), `TYPE_LABELS 缺少 ${action}`);
  }
});

test('popup 里的动作标签表覆盖所有动作', () => {
  const actions = actionsIn(read('src/lib/guardrails.js'));
  const labelBlock = popupJs.match(/const TYPE_LABELS = \{([^}]+)\}/)?.[1] || '';
  for (const action of actions) {
    assert.match(labelBlock, new RegExp(`\\b${action}:`), `popup TYPE_LABELS 缺少 ${action}`);
  }
});

test('manifest 声明的图标文件都存在且是 PNG', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const icons = { ...(manifest.icons || {}), ...(manifest.action?.default_icon || {}) };
  const paths = [...new Set(Object.values(icons))];
  assert.ok(paths.length >= 4, '应声明 16/32/48/128 四种图标');
  for (const path of paths) {
    const bytes = readFileSync(join(root, path));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${path} 不是合法 PNG`);
  }
});

test('风控停机所需的通知权限已声明', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.ok(manifest.permissions.includes('notifications'), '缺少 notifications 权限');
  // 通知图标必须存在，否则 chrome.notifications.create 会失败
  assert.ok(manifest.icons?.['128'], '通知需要 128 尺寸图标');
});

test('用了 import 的脚本必须以 module 方式加载', () => {
  // options.js 从 lib/guardrails.js 导入预设表，普通 script 标签会直接语法报错
  assert.match(optionsJs, /^import\s/m, 'options.js 应该用了 import');
  assert.match(optionsHtml, /<script[^>]*type="module"[^>]*src="options\.js"/, 'options.html 必须以 type="module" 加载');

  // popup.js 是普通脚本，不该出现 import
  assert.doesNotMatch(popupJs, /^import\s/m, 'popup.js 不应该用 import');
});

test('每个 import 的具名导出在目标模块里都真实存在', async () => {
  // 这条是为了拦住一类致命错误：ESM 具名导入对不上会让整个模块加载失败。
  // service worker 加载失败 = 整个扩展是死的，而 node --check 只解析语法、不校验导入。
  const files = [
    'src/background/service-worker.js',
    'src/options/options.js',
    'src/lib/store.js',
    'src/lib/image.js'
  ];

  let checked = 0;
  for (const file of files) {
    const source = read(file);
    const baseDir = dirname(join(root, file));

    for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
      const names = match[1]
        .split(',')
        .map(item => item.trim().split(/\s+as\s+/)[0].trim())
        .filter(Boolean);
      const specifier = match[2];
      const targetPath = resolve(baseDir, specifier);
      const module = await import(pathToFileURL(targetPath).href);

      for (const name of names) {
        checked += 1;
        assert.ok(
          name in module,
          `${file} 从 ${specifier} 导入了 ${name}，但该模块没有导出它`
        );
      }
    }
  }

  assert.ok(checked >= 30, `应校验到足够多的导入项，实际只有 ${checked} 个`);
});

test('manifest 声明的入口文件都真实存在', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const files = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_page,
    ...manifest.content_scripts.flatMap(entry => entry.js)
  ];
  for (const file of files) {
    assert.doesNotThrow(() => read(file), `缺少文件 ${file}`);
  }
});

test('manifest 具备调度与注入所需权限', () => {
  const manifest = JSON.parse(read('manifest.json'));
  for (const permission of ['storage', 'tabs', 'alarms', 'scripting']) {
    assert.ok(manifest.permissions.includes(permission), `缺少权限 ${permission}`);
  }
  assert.equal(manifest.background.type, 'module', 'service worker 需要 module 才能 import lib');
});

test('用到的常量必须已声明或已导入（拦住"忘了 import"）', async () => {
  // node --check 只解析语法，不校验标识符解析；ESM 里引用未声明的标识符
  // 会在运行时直接 ReferenceError。实测踩过：给 service-worker.js 加了
  // POST_WEIGHT_LIMIT 的用法却忘了加进 import，检查全绿但一发帖就崩。
  const { checkProject } = await import('../scripts/check-identifiers.mjs');
  const report = checkProject(root);
  assert.ok(report.length >= 8, '应检查到足够多的文件');
  const bad = report.filter(entry => entry.issues.length);
  assert.deepEqual(
    bad.map(entry => `${entry.file}: ${entry.issues.join(', ')}`),
    [],
    '有文件用到了未声明也未导入的常量'
  );
});

test('模板字符串里未声明的裸标识符要能查出来（拦住"删了声明却留下引用"）', async () => {
  // 实测踩过：删除"先审后发"时删掉了 popup.js 的 const mode，却把 `${mode}`
  // 留在了模板字符串里。node --check 和大写常量检查全绿，但弹窗一进"运行中"
  // 状态就 ReferenceError，后面的 renderStats/renderQueue/renderLogs 全不执行。
  const { undeclaredInTemplates } = await import('../scripts/check-identifiers.mjs');

  // 真会崩的：整体就是一个没声明的裸标识符
  assert.deepEqual(undeclaredInTemplates('const a = 1;\nconst s = `x${mode}y`;'), ['mode']);
  assert.deepEqual(undeclaredInTemplates('const s = `运行中（${preset}档 · ${mode}）`;').sort(), ['mode', 'preset']);

  // 不该误报的：已声明、已导入、函数参数、catch 参数、箭头函数参数、全局量
  assert.deepEqual(undeclaredInTemplates('const preset = "均衡";\nconst s = `${preset}`;'), []);
  assert.deepEqual(undeclaredInTemplates('import { a } from "./a.js";\nconst s = `${a}`;'), []);
  assert.deepEqual(undeclaredInTemplates('function f(handle) { return `${handle}`; }'), []);
  assert.deepEqual(undeclaredInTemplates('try {} catch (error) { console.log(`${error}`); }'), []);
  assert.deepEqual(undeclaredInTemplates('const g = item => `${item}`;'), []);
  assert.deepEqual(undeclaredInTemplates('const s = `${Math.round(1.5)}`;'), []);

  // 不该误报的：不是"单个裸标识符"的插值
  assert.deepEqual(undeclaredInTemplates('const s = `${state.behavior.mode}`;'), []);
  assert.deepEqual(undeclaredInTemplates('const s = `${fn(mode)}`;'), []);
  assert.deepEqual(undeclaredInTemplates('const s = `${count + 1} 条`;'), []);
  assert.deepEqual(undeclaredInTemplates('const s = `共 ${items.length} 条`;'), []);
});
