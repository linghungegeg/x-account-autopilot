// 加权字数 / 发帖计划 / 日志分页：这三块都是纯函数，而且字数规则是拿真实 X 实测校准过的。

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_BEHAVIOR, POST_WEIGHT_LIMIT, PRESETS, canRun, createStats, fitsWeightLimit, matchBlacklist, pickNextTask, postPlanDue, recordAction, totalCount, weightedLength } from '../src/lib/guardrails.js';
import { filterLogs, paginateLogs } from '../src/lib/logs.js';
import { DEFAULT_POST_PLAN, normalizePostPlan } from '../src/lib/store.js';

// 用本地时间构造，保证 getHours() 在任何时区下都稳定
const at = (hour, minute = 0) => new Date(2026, 8, 22, hour, minute, 0, 0).getTime();

// ------------------------------------------------------------------ 加权字数

test('加权字数：拉丁 1 单位、CJK 2 单位（期望值来自真实 X 实测）', () => {
  // 实测：279 个 a → "1 character remaining"；281 个 a → "exceeded by 1"
  assert.equal(weightedLength('a'.repeat(279)), 279);
  assert.equal(weightedLength('a'.repeat(281)), 281);
  // 实测：139 个中 → 剩 2；140 个中 → 剩 0；141 个中 → 超 2
  assert.equal(weightedLength('中'.repeat(139)), 278);
  assert.equal(weightedLength('中'.repeat(140)), 280);
  assert.equal(weightedLength('中'.repeat(141)), 282);
  // 实测：278 个 a + 1 个中 = 280，正好卡满
  assert.equal(weightedLength('a'.repeat(278) + '中'), 280);
});

test('加权字数的边界判定', () => {
  assert.equal(POST_WEIGHT_LIMIT, 280);
  assert.equal(fitsWeightLimit('中'.repeat(140)), true);
  assert.equal(fitsWeightLimit('中'.repeat(141)), false);
  assert.equal(fitsWeightLimit('a'.repeat(280)), true);
  assert.equal(fitsWeightLimit('a'.repeat(281)), false);
  assert.equal(fitsWeightLimit('', 10), true);
  assert.equal(weightedLength(null), 0);
  assert.equal(weightedLength(undefined), 0);
});

test('emoji 和日韩文同样按 2 单位算', () => {
  assert.equal(weightedLength('😀'), 2);
  assert.equal(weightedLength('あ'), 2);
  assert.equal(weightedLength('한'), 2);
  assert.equal(weightedLength('A'), 1);
});

test('emoji / 符号的加权值要和 twitter-text 一致（默认 2，只有 4 个区间是 1）', () => {
  // 这里曾经写反过（默认 1 + 手列 emoji 区间），20 个抽样字符错了 15 个。
  // twitter-text 的规则是 defaultWeight=2，weight=1 的只有：
  //   0x0000-0x10FF / 0x2000-0x200D / 0x2010-0x201F / 0x2032-0x2037
  const weight2 = ['🚀', '❤', '✅', '⭐', '☀', '🫠', '🩷', '🈚', '⏰', '→', '、', '。', '「', '」', '￥', '中', 'あ', '한'];
  for (const ch of weight2) {
    assert.equal(weightedLength(ch), 2, `${ch} 应该算 2`);
  }
  // 国旗是两个 regional indicator，各算 2
  assert.equal(weightedLength('🇨🇳'), 4);

  // weight=1 的区间
  for (const ch of ['a', 'Z', '9', 'é', 'Ж', '\u200d', '\u2014']) {
    assert.equal(weightedLength(ch), 1, `${ch} 应该算 1`);
  }
});

test('链接按 23 个字符计（X 的 transformedURLLength）', () => {
  assert.equal(weightedLength('https://x.com'), 23);
  assert.equal(weightedLength(`https://example.com/${'a'.repeat(200)}`), 23);
  assert.equal(weightedLength('看这个 https://x.com 很好'), weightedLength('看这个 ') + 23 + weightedLength(' 很好'));
});

test('a*279 + emoji 必须判为超限（曾经误判成可发导致发不出去）', () => {
  assert.equal(weightedLength('a'.repeat(279) + '🚀'), 281);
  assert.equal(fitsWeightLimit('a'.repeat(279) + '🚀'), false);
  assert.equal(fitsWeightLimit('a'.repeat(278) + '🚀'), true);
});

// ------------------------------------------------------------------ 发帖计划

const plan = extra => normalizePostPlan({
  enabled: true,
  items: [{ id: 'a', status: 'pending' }],
  scheduledTimes: [],
  ...extra
});

test('发帖计划：关闭 / 没有待发条目 / 超每日上限 都不该发', () => {
  assert.equal(postPlanDue(plan({ enabled: false }), {}, at(12)), false);
  assert.equal(postPlanDue(normalizePostPlan({ enabled: true, items: [] }), {}, at(12)), false);
  assert.equal(postPlanDue(
    plan({ dailyLimit: 1 }),
    { postCountDate: new Date(at(12)).toDateString(), postCountToday: 1 },
    at(12)
  ), false);
});

test('发帖计划：指定了时间点就按时间点发，到点后 15 分钟内都算该发', () => {
  const p = plan({ scheduledTimes: ['09:30', '15:00'] });

  assert.equal(postPlanDue(p, {}, at(9, 30)), true);
  assert.equal(postPlanDue(p, {}, at(9, 40)), true, 'tick 错过整点也不该漏发');
  assert.equal(postPlanDue(p, {}, at(15, 0)), true);

  // 超过宽限期
  assert.equal(postPlanDue(p, {}, at(9, 46)), false);
  assert.equal(postPlanDue(p, {}, at(12, 0)), false);

  // 这个时间点已经发过了
  assert.equal(postPlanDue(p, { lastPostAt: at(9, 31) }, at(9, 40)), false);
  // 但下一个时间点还没发
  assert.equal(postPlanDue(p, { lastPostAt: at(9, 31) }, at(15, 5)), true);
});

test('发帖计划：没指定时间点就按时间段随机发', () => {
  const p = plan({ scheduledTimes: [], windowStart: 9, windowEnd: 18, dailyLimit: 3 });

  // 窗外
  assert.equal(postPlanDue(p, { lastPostAt: 0 }, at(3)), false);
  assert.equal(postPlanDue(p, { lastPostAt: 0 }, at(20)), false);

  // 窗内 + 距上次足够久（dailyLimit 3 → 最小间隔 8 小时）
  assert.equal(postPlanDue(p, { lastPostAt: at(0) }, at(9)), true);

  // 窗内但刚发过
  assert.equal(postPlanDue(p, { lastPostAt: at(9) }, at(9, 30)), false);
});

test('发帖计划：随机模式支持跨午夜时间窗', () => {
  const p = plan({ scheduledTimes: [], windowStart: 22, windowEnd: 6, dailyLimit: 1 });
  assert.equal(postPlanDue(p, { lastPostAt: 0 }, at(23)), true);
  assert.equal(postPlanDue(p, { lastPostAt: 0 }, at(3)), true);
  assert.equal(postPlanDue(p, { lastPostAt: 0 }, at(12)), false);
});

test('发帖计划：时间段起止相同表示全天', () => {
  const p = plan({ scheduledTimes: [], windowStart: 0, windowEnd: 0, dailyLimit: 1 });
  for (const hour of [0, 6, 12, 23]) {
    assert.equal(postPlanDue(p, { lastPostAt: 0 }, at(hour)), true, `${hour} 点应放行`);
  }
});

test('normalizePostPlan 夹取越界值并回落非法语言', () => {
  const p = normalizePostPlan({
    dailyLimit: 999,
    windowStart: -5,
    windowEnd: 99,
    language: '乱填',
    withImage: '乱填',
    imageChance: 5,
    maxWeight: 1,
    scheduledTimes: ['09:30', '乱写', '25:00', '7:5']
  });
  assert.equal(p.dailyLimit, 50);
  assert.equal(p.windowStart, 0);
  assert.equal(p.windowEnd, 24);
  assert.equal(p.language, DEFAULT_POST_PLAN.language);
  assert.equal(p.withImage, DEFAULT_POST_PLAN.withImage);
  assert.equal(p.imageChance, 1);
  assert.equal(p.maxWeight, 20);
  assert.deepEqual(p.scheduledTimes, ['09:30'], '只保留合法的 HH:MM');
});

// ------------------------------------------------------------------ 动作时间预算

test('拟人化默认参数要足够克制，否则会顶爆动作超时', () => {
  // 实测踩过：拟人化 92 秒 + 填表 60 秒 + 生图 60 秒，把动作超时顶爆，
  // 任务被判超时——但帖子其实已经发出去了（假阴性）。
  // 内容脚本里另有 45 秒总预算兜底，默认值不该接近那个上限。
  const pauseMs = DEFAULT_BEHAVIOR.humanizePauseMaxSec * 1000;
  const worstMs = DEFAULT_BEHAVIOR.humanizeScrollMax * (pauseMs + 1000);
  assert.ok(worstMs <= 45000, `拟人化最坏 ${worstMs}ms 应该落在 45 秒预算内`);
  assert.ok(DEFAULT_BEHAVIOR.humanizePauseMaxSec <= 5, '单次停顿不该超过 5 秒');
  assert.ok(DEFAULT_BEHAVIOR.humanizeScrollMax <= 6, '滚动次数不该超过 6 次');
});

// ------------------------------------------------------------------ 任务优先级

test('计划帖优先于互动任务（实测踩过被饿死的坑）', () => {
  // 复现当时的队列：14 个互动任务排在前面，到点的计划帖一直没轮到
  const queue = [
    { id: 'r1', type: 'reply', status: 'pending', createdAt: 1 },
    { id: 'l1', type: 'like', status: 'pending', createdAt: 2 },
    { id: 'f1', type: 'follow', status: 'pending', createdAt: 3 },
    { id: 'b1', type: 'browse', status: 'pending', createdAt: 4 },
    { id: 'p1', type: 'post', status: 'pending', createdAt: 5 }
  ];
  assert.equal(pickNextTask(queue).id, 'p1', '发帖必须排最前');
});

test('任务优先级顺序：发帖 > 评论 > 点赞 > 关注 > 浏览', () => {
  const types = ['browse', 'follow', 'like', 'reply', 'post'];
  const queue = types.map((type, i) => ({ id: type, type, status: 'pending', createdAt: i }));
  const order = [];
  let rest = queue;
  while (rest.length) {
    const next = pickNextTask(rest);
    order.push(next.type);
    rest = rest.filter(t => t.id !== next.id);
  }
  assert.deepEqual(order, ['post', 'reply', 'like', 'follow', 'browse']);
});

test('同优先级按创建时间先来先做，非 pending 的跳过', () => {
  const queue = [
    { id: 'r2', type: 'reply', status: 'pending', createdAt: 200 },
    { id: 'r1', type: 'reply', status: 'pending', createdAt: 100 },
    { id: 'r0', type: 'reply', status: 'done', createdAt: 50 },
    { id: 'x', type: 'reply', status: 'running', createdAt: 10 }
  ];
  assert.equal(pickNextTask(queue).id, 'r1');
  assert.equal(pickNextTask([]), null);
  assert.equal(pickNextTask([{ id: 'a', type: 'reply', status: 'done' }]), null);
});

// ------------------------------------------------------------------ 日志

const entries = [
  { at: 5, level: 'success', tag: '发布', message: '评论 @a 完成', action: 'reply', author: 'a', statusHref: '/a/status/1', result: 'ok' },
  { at: 4, level: 'error', tag: '发布', message: '评论 @b 失败', action: 'reply', author: 'b', statusHref: '/b/status/2', result: 'failed' },
  { at: 3, level: 'info', tag: '互动', message: '点赞 @c 完成', action: 'like', author: 'c', statusHref: '/c/status/3', result: 'ok' },
  { at: 2, level: 'info', tag: '扫描', message: '关键词命中 6 条' },
  { at: 1, level: 'warn', tag: '调度', message: '暂停：不在活跃时段' }
];

test('日志筛选：按动作 / 结果 / 级别 / 关键词', () => {
  assert.equal(filterLogs(entries, { action: 'reply' }).length, 2);
  assert.equal(filterLogs(entries, { result: 'failed' }).length, 1);
  assert.equal(filterLogs(entries, { level: 'info' }).length, 2);
  assert.equal(filterLogs(entries, { search: '@b' }).length, 1);
  assert.equal(filterLogs(entries, { search: 'status/3' }).length, 1, '应该能按帖子地址搜');
  assert.equal(filterLogs(entries, { search: '不存在的词' }).length, 0);
  assert.equal(filterLogs(entries, {}).length, 5);
});

test('日志筛选：没有 result 字段的记录按成功算', () => {
  assert.equal(filterLogs(entries, { result: 'ok' }).length, 4);
});

test('日志筛选：error 级别但没有 result 字段的也要算失败', () => {
  // "调度出错"这类日志没有 result 字段，以前被当成成功，
  // 按"失败"筛选时正好看不到——而用户查问题恰恰要看它们。
  const withError = [
    ...entries,
    { at: 6, level: 'error', tag: '调度', message: '调度出错：等待 X 页面加载超时' },
    { at: 7, level: 'info', tag: '扫描', message: '关键词没有新的可用结果' }
  ];
  const failed = filterLogs(withError, { result: 'failed' });
  assert.equal(failed.length, 2, '任务失败 + 调度出错');
  assert.ok(failed.some(e => e.message.includes('调度出错')));
  // 显式标了 result 的成功日志不受 level 推断影响
  assert.equal(filterLogs(withError, { result: 'ok' }).length, 5);
});

test('日志分页：每页 20 条、页码夹取', () => {
  const many = Array.from({ length: 45 }, (_, i) => ({ at: i, message: `第 ${i} 条` }));

  const first = paginateLogs(many, { page: 1 });
  assert.equal(first.total, 45);
  assert.equal(first.pageCount, 3);
  assert.equal(first.entries.length, 20);
  assert.equal(first.pageSize, 20);

  assert.equal(paginateLogs(many, { page: 3 }).entries.length, 5);
  assert.equal(paginateLogs(many, { page: 99 }).page, 3, '超出范围夹到最后一页');
  assert.equal(paginateLogs(many, { page: -1 }).page, 1, '负数夹到第一页');
  assert.equal(paginateLogs([], { page: 1 }).pageCount, 1);
  assert.equal(paginateLogs([], { page: 1 }).entries.length, 0);
});

test('日志分页：筛选后再分页', () => {
  const many = Array.from({ length: 45 }, (_, i) => ({
    at: i,
    message: `第 ${i} 条`,
    action: i % 3 === 0 ? 'reply' : 'like'
  }));
  const result = paginateLogs(many, { action: 'reply', page: 1 });
  assert.equal(result.total, 15);
  assert.equal(result.pageCount, 1);
  assert.equal(result.entries.length, 15);
});

// ------------------------------------------------------------------ 审计修复回归

test('黑名单的 ASCII 词按词边界匹配，不会误伤子串', () => {
  // 直接 includes 的话，屏蔽词 `ai` 会命中 said / email / wait / again
  const behavior = { blacklistUsers: [], blacklistWords: ['ai'] };
  assert.equal(matchBlacklist(behavior, { text: 'AI is changing everything' }), '内容命中黑名单词「ai」');
  assert.equal(matchBlacklist(behavior, { text: 'this is AI' }), '内容命中黑名单词「ai」');
  assert.equal(matchBlacklist(behavior, { text: 'he said hello' }), '', 'said 不该命中');
  assert.equal(matchBlacklist(behavior, { text: 'send me an email' }), '', 'email 不该命中');
  assert.equal(matchBlacklist(behavior, { text: 'wait a moment' }), '', 'wait 不该命中');
  // 中日韩没有词边界，仍然子串匹配
  assert.equal(matchBlacklist({ blacklistWords: ['空投'] }, { text: '这个空投项目' }), '内容命中黑名单词「空投」');
});

test('加权字数：链接末尾的标点不属于链接，要单独计', () => {
  // "看这个 https://x.com。" —— 句号是 2 单位，不能跟着链接一起被算成 23
  const withPunct = weightedLength('看这个 https://x.com。');
  const withoutPunct = weightedLength('看这个 https://x.com');
  assert.equal(withPunct - withoutPunct, 2, '末尾句号应额外算 2');
});

test('统计计数遇到字符串也要能正确累加（否则护栏静默失效）', () => {
  // storage 里存成字符串时，'3' + '3' = '33'，上限永不触发
  // 用完整的 stats 结构（含 dateKey/hourKey），否则 rollStats 会当成跨天而清零
  const stats = createStats(at(12));
  stats.byAction = {
    browse: { hour: '1', day: '2' },
    like: { hour: '3', day: '4' },
    reply: { hour: 0, day: 0 },
    follow: { hour: 0, day: 0 },
    post: { hour: 0, day: 0 }
  };
  assert.deepEqual(totalCount(stats), { hour: 4, day: 6 });

  const after = recordAction(stats, 'like', at(12));
  assert.equal(after.byAction.like.hour, 4, '字符串计数 +1 应该是 4 而不是 "31"');
  assert.equal(after.byAction.like.day, 5);
});

test('上限为 0 时的提示要说清楚是被关闭了', () => {
  const behavior = { ...DEFAULT_BEHAVIOR, enabled: true, activeHours: { start: 0, end: 0 }, perAction: { ...DEFAULT_BEHAVIOR.perAction, post: { maxPerHour: 0, maxPerDay: 0 } } };
  const gate = canRun({ behavior, stats: createStats(at(12)), action: 'post', now: at(12) });
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /关闭|上限为 0/, '不该只说"已达上限 0"');
});

test('DEFAULT_BEHAVIOR 不与 PRESETS 共享对象（改一个不会污染另一个）', () => {
  assert.notEqual(DEFAULT_BEHAVIOR.perAction, PRESETS.balanced.perAction);
  assert.notEqual(DEFAULT_BEHAVIOR.perAction.like, PRESETS.balanced.perAction.like);
  assert.notEqual(DEFAULT_BEHAVIOR.activeHours, PRESETS.balanced.activeHours);
});
