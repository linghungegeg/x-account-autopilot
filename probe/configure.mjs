// 通过设置页的真实表单配置中转站，并加关键词。密钥从环境变量读。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const BASE = process.env.RELAY_BASE || 'https://kakai.icu/v1';
const CHAT_KEY = process.env.RELAY_CHAT_KEY;
const IMAGE_KEY = process.env.RELAY_IMAGE_KEY;
const CHAT_MODEL = process.env.RELAY_CHAT_MODEL || 'gpt-5.5';
const IMAGE_MODEL = process.env.RELAY_IMAGE_MODEL || 'gpt-image-2.5';

if (!CHAT_KEY || !IMAGE_KEY) {
  console.log('❌ 缺少 RELAY_CHAT_KEY / RELAY_IMAGE_KEY 环境变量');
  process.exit(1);
}

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(3500);

// 抓设置页的报错
const errors = [];
page.on(msg => {
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  }
});
await page.send('Runtime.enable');

// ---------------------------------------------------------------- 填表单
console.log('>>> 填 AI 接口表单');
const filled = await page.eval(`(() => {
  const set = (sel, value) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  return {
    baseUrl: set('#baseUrl', ${JSON.stringify(BASE)}),
    apiKey: set('#apiKey', ${JSON.stringify(CHAT_KEY)}),
    imageApiKey: set('#imageApiKey', ${JSON.stringify(IMAGE_KEY)}),
    chatModel: set('#chatModel', ${JSON.stringify(CHAT_MODEL)}),
    imageModel: set('#imageModel', ${JSON.stringify(IMAGE_MODEL)}),
    imageSize: set('#imageSize', '1024x1024')
  };
})()`);
console.log('字段填充:', JSON.stringify(filled));

console.log('\n>>> 点「保存接口配置」');
await page.eval(`document.querySelector('#saveConfig').click()`);
await sleep(2500);
console.log('状态栏:', await page.eval(`document.querySelector('#status')?.textContent`));

// ---------------------------------------------------------------- 测连接
console.log('\n>>> 点「测试连接」（只测文字模型）');
await page.eval(`document.querySelector('#testConfig').click()`);
for (let i = 0; i < 20; i++) {
  await sleep(1500);
  const status = await page.eval(`document.querySelector('#status')?.textContent`);
  if (status && !/测试中/.test(status)) { console.log('结果:', status); break; }
}

// ---------------------------------------------------------------- 关键词
console.log('\n>>> 添加关键词');
await page.eval(`(() => {
  const input = document.querySelector('#keywordInput');
  input.value = 'AI 工具';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#addKeyword').click();
  return true;
})()`);
await sleep(2000);
const chips = await page.eval(`[...document.querySelectorAll('#keywordChips .chip')].map(c => c.textContent.replace('×','').trim())`);
console.log('关键词 chips:', JSON.stringify(chips));

// ---------------------------------------------------------------- 核对后台
const config = await page.eval(`chrome.runtime.sendMessage({type:'GET_ALL'}).then(r => JSON.stringify({
  config: {
    baseUrl: r.config.baseUrl,
    chatModel: r.config.chatModel,
    imageModel: r.config.imageModel,
    imageSize: r.config.imageSize,
    chatKeyTail: r.config.apiKey.slice(-6),
    imageKeyTail: r.config.imageApiKey.slice(-6)
  },
  keywords: r.state.keywords,
  enabled: r.state.behavior.enabled,
  dryRun: r.state.behavior.dryRun,
  preset: r.state.presetLabel
}, null, 2))`);
console.log('\n=== 后台确认 ===');
console.log(config);

if (errors.length) console.log('\n设置页报错:', errors);
process.exit(0);
