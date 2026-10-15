// 静态检查：文件里用到的标识符，必须已声明或已导入。
//
// 拦住的是"忘了 import"和"删了声明却留下引用"这两类错误——node --check 只解析语法、
// 不校验标识符解析，而 ESM 里引用未声明的标识符会在运行时直接 ReferenceError。
// 实测踩过两次：
//   1. 给 service-worker.js 加 POST_WEIGHT_LIMIT 的用法却忘了加进 import，
//      语法检查全绿，但一发帖就 ReferenceError。
//   2. 删除"先审后发"时删掉了 popup.js 的 const mode，却把 `${mode}` 留在模板字符串里，
//      语法检查和大写常量检查全绿，但弹窗一进"运行中"状态就崩。
// 所以这里查两遍：大写常量（第一类）+ 模板字符串里整体是单个裸标识符的插值（第二类）。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CHECKED_FILES = [
  'src/background/service-worker.js',
  'src/content/x-content.js',
  'src/options/options.js',
  'src/popup/popup.js',
  'src/lib/guardrails.js',
  'src/lib/store.js',
  'src/lib/logs.js',
  'src/lib/image.js'
];

// 浏览器/Node 提供的全局常量
const GLOBALS = new Set([
  'JSON', 'URL', 'NaN', 'Infinity', 'Math', 'Object', 'Array', 'String', 'Number', 'Boolean',
  'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'Promise', 'Map', 'Set',
  'WeakMap', 'WeakSet', 'Symbol', 'Proxy', 'Reflect', 'BigInt', 'Intl', 'TextEncoder', 'TextDecoder',
  'InputEvent', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'DataTransfer', 'File',
  'FileReader', 'Blob', 'FormData', 'AbortController', 'DOMException', 'MutationObserver',
  'IntersectionObserver', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame',
  'HTMLInputElement', 'HTMLElement', 'Node', 'Element', 'DOMParser', 'XMLHttpRequest', 'Headers',
  'Request', 'Response', 'ReadableStream', 'structuredClone', 'atob', 'btoa',
  'CSS', 'IDBKeyRange', 'Notification', 'Image', 'Audio', 'Uint8Array', 'ArrayBuffer', 'Buffer'
]);

// 去掉注释和字符串字面量，避免把里面的内容当成标识符。
// 模板字符串里的 ${} 表达式要保留——那里面的标识符是真的在求值。
// 同时把每个 ${} 里的表达式单独收集出来，供 undeclaredInTemplates 使用。
function stripCommentsAndStrings(source) {
  let out = '';
  const templateExprs = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    if (two === '/*') {
      i += 2;
      while (i < n && source.slice(i, i + 2) !== '*/') i += 1;
      i += 2;
      continue;
    }
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < n) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === quote) { i += 1; break; }
        if (quote === '`' && source.slice(i, i + 2) === '${') {
          let depth = 1;
          i += 2;
          const start = i;
          while (i < n && depth > 0) {
            if (source[i] === '{') depth += 1;
            else if (source[i] === '}') depth -= 1;
            i += 1;
          }
          const expr = source.slice(start, i - 1);
          templateExprs.push(expr);
          out += expr;
          continue;
        }
        i += 1;
      }
      out += ' ';
      continue;
    }
    out += ch;
    i += 1;
  }
  return { code: out, templateExprs };
}

export function declaredNames(code) {
  const declared = new Set();
  for (const m of code.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  // 解构声明：const { A, B: C } = ...
  for (const m of code.matchAll(/\b(?:const|let|var)\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(':').pop().trim().split('=')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name);
    }
  }
  // 函数参数（含默认值、解构）、catch 参数、单参箭头函数。
  // 宁可多收几个名字，也不要因为漏收而把合法代码误报成 bug。
  const addParams = (list) => {
    for (const name of list.matchAll(/[A-Za-z_$][\w$]*/g)) declared.add(name[0]);
  };
  for (const m of code.matchAll(/\bfunction\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/g)) addParams(m[1]);
  for (const m of code.matchAll(/\(([^)]*)\)\s*=>/g)) addParams(m[1]);
  for (const m of code.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/g)) declared.add(m[1]);
  for (const m of code.matchAll(/\bcatch\s*\(([^)]*)\)/g)) addParams(m[1]);
  return declared;
}

export function importedNames(code) {
  const imported = new Set();
  for (const m of code.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) imported.add(name);
    }
  }
  return imported;
}

// 返回该文件里"用到了但既没声明也没导入"的常量名
export function undeclaredConstants(source) {
  const { code } = stripCommentsAndStrings(source);
  const declared = declaredNames(code);
  const imported = importedNames(code);

  const issues = [];
  const seen = new Set();
  for (const m of code.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    if (GLOBALS.has(name) || declared.has(name) || imported.has(name)) continue;
    // 排除对象字面量的键名（形如 FOO: value）
    if (/^\s*:/.test(code.slice(m.index + name.length, m.index + name.length + 2))) continue;
    issues.push(name);
  }
  return issues;
}

// 模板字符串里形如 ${name} 的插值：整体就是一个裸标识符，没声明没导入就会 ReferenceError。
// 只认"整个插值就是单个标识符"这一种形态（${a.b} / ${f(x)} / ${i + 1} 一律跳过），
// 这样既不会误报属性访问和表达式，又能抓住"删了声明却留下引用"这类残留。
export function undeclaredInTemplates(source) {
  const { code, templateExprs } = stripCommentsAndStrings(source);
  const declared = declaredNames(code);
  const imported = importedNames(code);

  const issues = [];
  const seen = new Set();
  for (const expr of templateExprs) {
    const name = expr.trim();
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
    if (name === 'this' || name === 'arguments') continue;
    if (seen.has(name)) continue;
    seen.add(name);
    if (GLOBALS.has(name) || declared.has(name) || imported.has(name)) continue;
    issues.push(name);
  }
  return issues;
}

export function checkProject(root) {
  const report = [];
  for (const file of CHECKED_FILES) {
    const source = readFileSync(join(root, file), 'utf8');
    report.push({ file, issues: [...undeclaredConstants(source), ...undeclaredInTemplates(source)] });
  }
  return report;
}

// 直接运行时打印报告
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const root = process.cwd();
  let total = 0;
  for (const { file, issues } of checkProject(root)) {
    if (issues.length) {
      total += issues.length;
      console.log(`❌ ${file}`);
      issues.forEach(name => console.log(`     ${name}`));
    } else {
      console.log(`✅ ${file}`);
    }
  }
  console.log(`\n共 ${total} 个可疑标识符`);
  process.exitCode = total ? 1 : 0;
}
