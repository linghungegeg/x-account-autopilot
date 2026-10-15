// 验证 -unfollow：走只读路径，不关注任何人。
// 思路：从自己的"正在关注"列表里挑一个已关注的人，访问他的主页，
// 主页上应该直接渲染 -unfollow 按钮——这正是 isFollowing() 依赖的状态。
import { writeFileSync } from 'node:fs';
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const OUT = 'probe/result-live-follow.json';

const cdp = await connect({ port: PORT });
const page = await cdp.page(0);

const calls = [];
page.on(msg => {
  if (msg.method === 'Network.requestWillBeSent' && msg.params.request.url.includes('/graphql/')) {
    calls.push({ requestId: msg.params.requestId, op: msg.params.request.url.split('/').pop().split('?')[0] });
  }
});

await page.send('Network.enable');
await page.send('Page.enable');

// ---------------------------------------------------------------- 我的账号
// 注意：SideNav_AccountSwitcher_Button 是纯头像按钮，innerText 为空，不能从它取文本。
const me = await page.eval(`(() => {
  const link = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
  const btn = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
  const avatar = btn?.querySelector('[data-testid^="UserAvatar-Container-"]');
  const img = btn?.querySelector('img');
  const handle = (link?.getAttribute('href') || '').replace(/^\\//, '')
    || (avatar?.getAttribute('data-testid') || '').replace('UserAvatar-Container-', '');
  return { handle, name: img?.getAttribute('alt') || '', avatar: (img?.getAttribute('src') || '').slice(0, 70) };
})()`);
console.log('当前账号:', JSON.stringify(me));
if (!me.handle) { console.log('❌ 取不到自己的 handle'); process.exit(1); }

// ---------------------------------------------------------------- 正在关注列表
console.log(`\n>>> 打开 https://x.com/${me.handle}/following`);
await page.goto(`https://x.com/${me.handle}/following`, { waitMs: 5000 });

const listInfo = await page.eval(`(() => {
  const cells = [...document.querySelectorAll('[data-testid="UserCell"]')];
  const unfollows = [...document.querySelectorAll('[data-testid$="-unfollow"]')];
  const follows = [...document.querySelectorAll('[data-testid$="-follow"]')];
  const handles = cells.map(c => (c.innerText.match(/@([A-Za-z0-9_]{1,15})/) || [])[1]).filter(Boolean);
  return {
    userCells: cells.length,
    unfollowCount: unfollows.length,
    followCount: follows.length,
    unfollowSamples: unfollows.slice(0, 5).map(b => ({
      tid: b.getAttribute('data-testid'),
      aria: b.getAttribute('aria-label'),
      text: (b.innerText || '').trim()
    })),
    followSamples: follows.slice(0, 5).map(b => ({ tid: b.getAttribute('data-testid'), aria: b.getAttribute('aria-label') })),
    handles: handles.slice(0, 8)
  };
})()`);

console.log('\n=== 正在关注列表 ===');
console.log(JSON.stringify(listInfo, null, 2));

// ---------------------------------------------------------------- 已关注者的主页
const target = listInfo.handles[0];
if (!target) {
  console.log('\n⚠️ 关注列表里没抓到用户名，跳过主页验证');
} else {
  console.log(`\n>>> 打开已关注用户主页 https://x.com/${target}`);
  await page.goto(`https://x.com/${target}`, { waitMs: 4500 });

  const profile = await page.eval(`(() => {
    const scope = document.querySelector('[data-testid="primaryColumn"]') || document;
    const unfollow = scope.querySelector('[data-testid$="-unfollow"]');
    const follow = scope.querySelector('[data-testid$="-follow"]');
    return {
      url: location.href,
      hasUnfollow: !!unfollow,
      hasFollow: !!follow,
      unfollow: unfollow ? { tid: unfollow.getAttribute('data-testid'), aria: unfollow.getAttribute('aria-label'), text: (unfollow.innerText || '').trim() } : null,
      follow: follow ? { tid: follow.getAttribute('data-testid'), aria: follow.getAttribute('aria-label') } : null,
      primaryColumnPresent: !!document.querySelector('[data-testid="primaryColumn"]')
    };
  })()`);

  console.log('\n=== 已关注用户主页 ===');
  console.log(JSON.stringify(profile, null, 2));

  const verdict = profile.hasUnfollow && !profile.hasFollow;
  console.log(`\n${verdict ? '✅' : '⚠️'} 已关注用户主页上 ${profile.hasUnfollow ? '存在' : '不存在'} -unfollow 按钮`);
  console.log('   我的 isFollowing() 判据：primaryColumn 内出现 [data-testid$="-unfollow"] → ' + (verdict ? '成立' : '需要调整'));

  writeFileSync(OUT, JSON.stringify({ me, listInfo, profile, calls }, null, 2));
}

console.log('\n=== 本次涉及的 GraphQL ===');
[...new Set(calls.map(c => c.op))].forEach(op => console.log('  ' + op));
console.log(`\n完整结果: ${OUT}`);

page.close();
process.exit(0);
