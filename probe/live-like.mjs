// 实测点赞：确认 unlike 状态 testid + 抓 FavoriteTweet 接口。
// 点赞后会立刻取消，不留痕迹。
import { writeFileSync } from 'node:fs';
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const OUT = 'probe/result-live-like.json';

const cdp = await connect({ port: PORT });
const page = await cdp.page(0);

const calls = [];
page.on(msg => {
  if (msg.method === 'Network.requestWillBeSent' && msg.params.request.url.includes('/graphql/')) {
    calls.push({
      requestId: msg.params.requestId,
      op: msg.params.request.url.split('/').pop().split('?')[0],
      postData: msg.params.request.postData
    });
  }
});

await page.send('Network.enable');
await page.send('Page.enable');

// ---------------------------------------------------------------- 准备
await page.goto('https://x.com/search?q=AI&src=typed_query&f=live', { waitMs: 4500 });

// 找一条"还没点赞"的推文
const pick = await page.eval(`(() => {
  const arts = [...document.querySelectorAll('[data-testid="tweet"]')];
  for (let i = 0; i < arts.length; i++) {
    const a = arts[i];
    if (a.querySelector('[data-testid="unlike"]')) continue;   // 已经赞过，跳过
    const like = a.querySelector('[data-testid="like"]');
    if (!like) continue;
    const href = [...a.querySelectorAll('a[href*="/status/"]')].map(x => x.getAttribute('href'))[0];
    return { index: i, href, text: (a.querySelector('[data-testid="tweetText"]')?.innerText || '').slice(0, 60) };
  }
  return null;
})()`);

if (!pick) {
  console.log('❌ 搜索页里找不到未点赞的推文，无法测试');
  process.exit(1);
}
console.log('选中推文:', JSON.stringify(pick));

const readState = `(() => {
  const a = [...document.querySelectorAll('[data-testid="tweet"]')][${pick.index}];
  if (!a) return { gone: true };
  return {
    hasLike: !!a.querySelector('[data-testid="like"]'),
    hasUnlike: !!a.querySelector('[data-testid="unlike"]'),
    likeAria: a.querySelector('[data-testid="like"]')?.getAttribute('aria-label'),
    unlikeAria: a.querySelector('[data-testid="unlike"]')?.getAttribute('aria-label'),
    actionTestIds: [...a.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid'))
      .filter(t => /like|unlike|retweet|reply|bookmark/i.test(t))
  };
})()`;

console.log('\n=== 点赞前 ===');
const before = await page.eval(readState);
console.log(JSON.stringify(before, null, 2));

// ---------------------------------------------------------------- 点赞
calls.length = 0;
console.log('\n>>> 点击点赞按钮');
await page.eval(`(() => {
  const a = [...document.querySelectorAll('[data-testid="tweet"]')][${pick.index}];
  a.querySelector('[data-testid="like"]').click();
  return true;
})()`);
await sleep(2500);

console.log('\n=== 点赞后 ===');
const after = await page.eval(readState);
console.log(JSON.stringify(after, null, 2));

// ---------------------------------------------------------------- 抓接口
const likeCall = calls.find(c => /FavoriteTweet/i.test(c.op));
console.log('\n=== 点赞触发的 GraphQL ===');
calls.forEach(c => console.log(`  ${c.op}`));

let likeBody = null;
if (likeCall) {
  console.log('\n请求体:', (likeCall.postData || '').slice(0, 600));
  const body = await page.send('Network.getResponseBody', { requestId: likeCall.requestId }).catch(e => ({ error: e.message }));
  likeBody = body?.body ? body.body.slice(0, 1200) : body;
  console.log('响应体:', typeof likeBody === 'string' ? likeBody : JSON.stringify(likeBody));
}

// ---------------------------------------------------------------- 取消点赞
console.log('\n>>> 取消点赞（还原）');
await page.eval(`(() => {
  const a = [...document.querySelectorAll('[data-testid="tweet"]')][${pick.index}];
  const b = a.querySelector('[data-testid="unlike"]');
  if (b) b.click();
  return !!b;
})()`);
await sleep(2500);

console.log('\n=== 还原后 ===');
const restored = await page.eval(readState);
console.log(JSON.stringify(restored, null, 2));

const ok = before.hasLike && !before.hasUnlike && after.hasUnlike && restored.hasLike && !restored.hasUnlike;
console.log(`\n${ok ? '✅' : '⚠️'} 结论: unlike 状态 testid ${after.hasUnlike ? '确实存在' : '不存在'}；已还原=${restored.hasLike && !restored.hasUnlike}`);

writeFileSync(OUT, JSON.stringify({ pick, before, after, restored, calls, likeBody }, null, 2));
console.log(`完整结果: ${OUT}`);

page.close();
process.exit(0);
