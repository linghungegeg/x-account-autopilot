// 验证批量生成支持多种目标语言（不是只会中文）。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';
const SOURCE = '把重复的事情自动化掉，省下来的时间才是自己的。';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(3000);

const call = (msg, timeoutMs = 180000) => page.eval(
  `chrome.runtime.sendMessage(${JSON.stringify(msg)}).then(r => JSON.stringify({ ok: r.ok, error: r.error })).catch(e => 'ERR: ' + e.message)`,
  { timeoutMs }
);
const ev = (expr, timeoutMs = 60000) => page.eval(expr, { timeoutMs });

// 清空旧条目
console.log(await call({ type: 'CLEAR_POST_ITEMS' }));

const LANGUAGES = ['en', 'ja', 'ko', 'es', 'de'];
const EXPECT = {
  en: /[A-Za-z]/,
  ja: /[\u3040-\u30ff]/,
  ko: /[\uac00-\ud7af]/,
  es: /[A-Za-z]/,
  de: /[A-Za-z]/
};

for (const lang of LANGUAGES) {
  console.log(`\n>>> 生成 ${lang}`);
  const started = Date.now();
  const result = await call({ type: 'GENERATE_POSTS', mode: 'translate', sources: [SOURCE], language: lang });
  console.log(`  耗时 ${Math.round((Date.now() - started) / 1000)}s  ${result}`);

  const items = JSON.parse(await ev(`
    chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify(
      r.state.postPlan.items.slice(-1).map(i => ({ lang: i.language, weight: i.weight, text: i.text }))
    ))
  `));
  const item = items[0];
  if (!item) { console.log('  ❌ 没生成'); continue; }
  const matched = EXPECT[lang].test(item.text);
  console.log(`  [${item.lang} · ${item.weight}/280] ${item.text}`);
  console.log(`  ${matched ? '✅ 语言符合' : '❌ 语言不符'}`);
}

console.log('\n=== 全部条目 ===');
const all = JSON.parse(await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify(
    r.state.postPlan.items.map(i => '[' + i.language + ' ' + i.weight + '] ' + i.text)
  ))
`));
all.forEach(l => console.log('  ' + l));

process.exit(0);
