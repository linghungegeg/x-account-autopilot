// 直接打中转站接口，验证扩展里的假设是否成立。
// 密钥只从环境变量读，绝不落盘、绝不进仓库。
import { writeFileSync } from 'node:fs';
import { sniffMimeFromBase64 } from '../src/lib/image.js';

const CHAT_KEY = process.env.RELAY_CHAT_KEY;
const IMAGE_KEY = process.env.RELAY_IMAGE_KEY;
const BASE = process.env.RELAY_BASE || 'https://kakai.icu/v1';
const CHAT_MODEL = process.env.RELAY_CHAT_MODEL || 'gpt-5.5';
const IMAGE_MODEL = process.env.RELAY_IMAGE_MODEL || 'gpt-image-2.5';

const OUT = 'probe/result-relay.json';
const report = {};

const redact = value => (typeof value === 'string' ? value.replace(/sk-[A-Za-z0-9]{8,}/g, 'sk-***') : value);
const show = value => JSON.stringify(value, null, 2).slice(0, 900);

async function post(path, body, key, label) {
  const started = Date.now();
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { label, status: response.status, ms: Date.now() - started, json, raw: json ? null : text.slice(0, 500) };
}

// ---------------------------------------------------------------- 文字模型
console.log('=== 1. 文字模型 ===');
console.log(`POST ${BASE}/chat/completions  model=${CHAT_MODEL}`);
const chat = await post('/chat/completions', {
  model: CHAT_MODEL,
  messages: [
    { role: 'system', content: '你在帮用户写一条中文社交平台评论。只输出评论正文。' },
    { role: 'user', content: '要评论的帖子：今天用 Rust 重写了一个小服务，内存占用从 300MB 降到 20MB。' }
  ],
  temperature: 0.95
}, CHAT_KEY, 'chat');

console.log(`HTTP ${chat.status}  用时 ${chat.ms}ms`);
if (chat.json) {
  const content = chat.json.choices?.[0]?.message?.content;
  console.log('choices[0].message.content 类型:', Array.isArray(content) ? 'array' : typeof content);
  console.log('返回内容:', Array.isArray(content) ? content.map(i => i.text || '').join('') : String(content ?? '(空)').slice(0, 200));
  console.log('model 字段:', chat.json.model, '| usage:', JSON.stringify(chat.json.usage || {}));
  if (!content) console.log('⚠️ 完整响应:', show(chat.json));
} else {
  console.log('非 JSON 响应:', chat.raw);
}
report.chat = { status: chat.status, ms: chat.ms, hasChoices: !!chat.json?.choices, model: chat.json?.model, usage: chat.json?.usage };

// ---------------------------------------------------------------- 生图模型
console.log('\n=== 2. 生图模型 ===');
console.log(`POST ${BASE}/images/generations  model=${IMAGE_MODEL}`);
const image = await post('/images/generations', {
  model: IMAGE_MODEL,
  prompt: 'a calm minimal illustration of a small blue bird on a wire, soft daylight',
  size: '1024x1024',
  response_format: 'b64_json'
}, IMAGE_KEY, 'image');

console.log(`HTTP ${image.status}  用时 ${image.ms}ms`);
if (image.json) {
  const item = image.json.data?.[0];
  console.log('data[0] 字段:', item ? Object.keys(item).join(', ') : '(没有 data[0])');
  if (item?.b64_json) {
    const bytes = Math.round(item.b64_json.length * 0.75);
    console.log(`b64_json: ${item.b64_json.length} 字符 ≈ ${Math.round(bytes / 1024)} KB`);
    const mime = sniffMimeFromBase64(item.b64_json);
    console.log(`魔数嗅探结果: ${mime}  ← 我的 sniffMimeFromBase64 判断`);
    console.log(`前 16 字节(base64): ${item.b64_json.slice(0, 16)}`);
    report.image = { status: image.status, ms: image.ms, kind: 'b64_json', approxBytes: bytes, sniffed: mime };
  } else if (item?.url) {
    console.log('返回的是 URL:', item.url.slice(0, 100));
    report.image = { status: image.status, ms: image.ms, kind: 'url', url: item.url.slice(0, 100) };
  } else {
    console.log('⚠️ 未知结构:', show(image.json));
    report.image = { status: image.status, ms: image.ms, kind: 'unknown', keys: item ? Object.keys(item) : [] };
  }
} else {
  console.log('非 JSON 响应:', image.raw);
  report.image = { status: image.status, ms: image.ms, kind: 'non-json', raw: image.raw };
}

writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`\n结果已写入 ${OUT}（不含密钥）`);
