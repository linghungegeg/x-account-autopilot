import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIONS,
  ACTION_LABELS,
  canRun,
  createStats,
  isWithinActiveHours,
  matchBlacklist,
  pickRhythm,
  presetLabel,
  presetValues,
  randomDelayMs,
  recordAction,
  recordError,
  rollStats,
  totalCount,
  DEFAULT_BEHAVIOR,
  PRESETS,
  PRESET_ORDER,
  IMAGE_MODES
} from '../src/lib/guardrails.js';

// 用本地时间构造，保证 getHours() 在任何时区下都稳定
const at = (hour, minute = 0, day = 22) => new Date(2026, 8, day, hour, minute, 0, 0).getTime();

const behavior = extra => ({ ...DEFAULT_BEHAVIOR, enabled: true, ...extra });

test('rollStats 跨小时清零小时计数，保留当日计数', () => {
  let stats = createStats(at(15));
  stats = recordAction(stats, 'reply', at(15));
  stats = recordAction(stats, 'reply', at(15));
  assert.equal(stats.byAction.reply.hour, 2);
  assert.equal(stats.byAction.reply.day, 2);

  const rolled = rollStats(stats, at(16));
  assert.equal(rolled.byAction.reply.hour, 0);
  assert.equal(rolled.byAction.reply.day, 2);
});

test('rollStats 跨天清零全部计数', () => {
  let stats = createStats(at(23, 0, 22));
  stats = recordAction(stats, 'like', at(23, 0, 22));
  const rolled = rollStats(stats, at(10, 0, 23));
  assert.equal(rolled.byAction.like.hour, 0);
  assert.equal(rolled.byAction.like.day, 0);
  assert.equal(totalCount(rolled).day, 0);
});

test('isWithinActiveHours 支持普通时段与跨午夜时段', () => {
  assert.equal(isWithinActiveHours(at(15), { start: 9, end: 23 }), true);
  assert.equal(isWithinActiveHours(at(3), { start: 9, end: 23 }), false);
  assert.equal(isWithinActiveHours(at(23), { start: 9, end: 23 }), false);
  assert.equal(isWithinActiveHours(at(23), { start: 22, end: 6 }), true);
  assert.equal(isWithinActiveHours(at(3), { start: 22, end: 6 }), true);
  assert.equal(isWithinActiveHours(at(12), { start: 22, end: 6 }), false);
  assert.equal(isWithinActiveHours(at(12), { start: 0, end: 0 }), true);
});

test('canRun 在总开关关闭时拒绝', () => {
  const stats = createStats(at(15));
  const gate = canRun({ behavior: { ...DEFAULT_BEHAVIOR, enabled: false }, stats, now: at(15) });
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /总开关/);
});

test('canRun 在非活跃时段拒绝', () => {
  const stats = createStats(at(3));
  const gate = canRun({ behavior: behavior({ activeHours: { start: 9, end: 23 } }), stats, now: at(3) });
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /活跃时段/);
});

test('三档预设的活跃时段都是全天（start === end 表示不限制）', () => {
  for (const name of PRESET_ORDER) {
    assert.deepEqual(PRESETS[name].activeHours, { start: 0, end: 0 }, `${name} 档应为全天`);
  }
  // 全天时任何小时都放行
  const behaviorAllDay = behavior({ activeHours: { start: 0, end: 0 } });
  for (const hour of [0, 3, 9, 23]) {
    assert.equal(canRun({ behavior: behaviorAllDay, stats: createStats(at(hour)), now: at(hour) }).allowed, true);
  }
});

test('canRun 达到单动作小时上限时拒绝', () => {
  let stats = createStats(at(15));
  const config = behavior({ perAction: { ...DEFAULT_BEHAVIOR.perAction, reply: { maxPerHour: 2, maxPerDay: 20 } } });
  stats = recordAction(stats, 'reply', at(15));
  assert.equal(canRun({ behavior: config, stats, action: 'reply', now: at(15) }).allowed, true);

  stats = recordAction(stats, 'reply', at(15));
  const gate = canRun({ behavior: config, stats, action: 'reply', now: at(15) });
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /评论本小时已达上限 2/);
  // 其它动作不受影响
  assert.equal(canRun({ behavior: config, stats, action: 'like', now: at(15) }).allowed, true);
});

test('canRun 达到全局每日上限时拒绝任何动作', () => {
  let stats = createStats(at(15));
  const config = behavior({ maxPerDay: 2, perAction: { ...DEFAULT_BEHAVIOR.perAction } });
  stats = recordAction(stats, 'like', at(15));
  stats = recordAction(stats, 'follow', at(15));

  const gate = canRun({ behavior: config, stats, action: 'reply', now: at(15) });
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /今日总动作已达上限 2/);
});

test('recordError 连续失败到阈值后进入冷却', () => {
  const config = behavior({ stopAfterConsecutiveErrors: 2, cooldownAfterErrorMin: 30 });
  let stats = createStats(at(15));

  stats = recordError(stats, config, at(15), '第一次失败');
  assert.equal(stats.consecutiveErrors, 1);
  assert.equal(stats.cooldownUntil, 0);
  assert.equal(canRun({ behavior: config, stats, now: at(15) }).allowed, true);

  stats = recordError(stats, config, at(15), '第二次失败');
  assert.equal(stats.consecutiveErrors, 0);
  assert.equal(stats.cooldownUntil, at(15) + 30 * 60000);

  const blocked = canRun({ behavior: config, stats, now: at(15) + 60000 });
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason, /冷却/);

  // 冷却结束后恢复
  assert.equal(canRun({ behavior: config, stats, now: at(15) + 31 * 60000 }).allowed, true);
});

test('recordAction 会清空连续失败计数', () => {
  const config = behavior();
  let stats = createStats(at(15));
  stats = recordError(stats, config, at(15), '失败');
  assert.equal(stats.consecutiveErrors, 1);
  stats = recordAction(stats, 'like', at(15));
  assert.equal(stats.consecutiveErrors, 0);
});

test('randomDelayMs 落在配置区间内且可注入随机源', () => {
  const config = { delayMinSec: 60, delayMaxSec: 180 };
  assert.equal(randomDelayMs(config, () => 0), 60000);
  assert.equal(randomDelayMs(config, () => 1), 180000);
  assert.equal(randomDelayMs(config, () => 0.5), 120000);

  const value = randomDelayMs(config, () => 0.37);
  assert.ok(value >= 60000 && value <= 180000);
});

test('matchBlacklist 命中作者与内容词', () => {
  const config = behavior({ blacklistUsers: ['@SpamKing'], blacklistWords: ['空投'] });
  assert.match(matchBlacklist(config, { author: 'spamking', text: '正常内容' }), /黑名单/);
  assert.match(matchBlacklist(config, { author: 'someone', text: '快来领空投啦' }), /空投/);
  assert.equal(matchBlacklist(config, { author: 'someone', text: '正常内容' }), '');
});

test('totalCount 汇总所有动作', () => {
  let stats = createStats(at(15));
  stats = recordAction(stats, 'reply', at(15));
  stats = recordAction(stats, 'like', at(15));
  stats = recordAction(stats, 'like', at(15));
  assert.deepEqual(totalCount(stats), { hour: 3, day: 3 });
});

test('rollStats 能修复残缺的 stats 结构', () => {
  const broken = { dateKey: 'x', hourKey: 'y', byAction: { reply: { hour: 5 } } };
  const rolled = rollStats(broken, at(15));
  assert.equal(rolled.byAction.reply.day, 0);
  assert.equal(rolled.byAction.follow.hour, 0);
  assert.equal(rolled.dateKey, '2026-09-22');
});

// ------------------------------------------------------------------ 三档预设

test('默认参数就是均衡档', () => {
  assert.equal(DEFAULT_BEHAVIOR.preset, 'balanced');
  assert.equal(presetLabel(DEFAULT_BEHAVIOR.preset), '均衡');
});

test('每档都自带一套默认节奏参数，与 PRESETS 一致', () => {
  for (const name of PRESET_ORDER) {
    const values = presetValues(name);
    assert.equal(values.preset, name);
    assert.deepEqual(pickRhythm(values, name), pickRhythm(PRESETS[name], name), `${name} 默认值应与 PRESETS 一致`);
  }
});

test('pickRhythm 只取节奏字段；缺失或非法的字段回落到该档默认值', () => {
  const rhythm = pickRhythm({ delayMinSec: 42, maxPerHour: 'abc' }, 'conservative');
  assert.equal(rhythm.delayMinSec, 42, '给了值就用给的值');
  assert.equal(rhythm.maxPerHour, PRESETS.conservative.maxPerHour, '非法值回落');
  assert.equal(rhythm.perAction.reply.maxPerDay, PRESETS.conservative.perAction.reply.maxPerDay, '缺字段回落');

  // 与档位无关的参数不该被卷进来
  for (const field of ['cooldownAfterErrorMin', 'queueLimit', 'pauseOnChallenge', 'blacklistWords']) {
    assert.equal(field in rhythm, false, `${field} 不属于档位参数`);
  }
});

test('presetValues / pickRhythm 返回深拷贝，改它不会污染预设本身', () => {
  const values = presetValues('aggressive');
  values.perAction.reply.maxPerDay = 1;
  values.activeHours.start = 5;
  assert.equal(PRESETS.aggressive.perAction.reply.maxPerDay, 50);
  assert.equal(PRESETS.aggressive.activeHours.start, 0);

  // 默认的每档参数同样不能和 PRESETS 共享引用
  DEFAULT_BEHAVIOR.presetSets.balanced.perAction.like.maxPerHour = 99;
  assert.equal(PRESETS.balanced.perAction.like.maxPerHour, 10);
  DEFAULT_BEHAVIOR.presetSets.balanced.perAction.like.maxPerHour = 10;
});

test('三档的激进程度单调递增', () => {
  const [conservative, balanced, aggressive] = PRESET_ORDER.map(name => PRESETS[name]);

  assert.ok(conservative.delayMinSec > balanced.delayMinSec, '保守的间隔应大于均衡');
  assert.ok(balanced.delayMinSec > aggressive.delayMinSec, '均衡的间隔应大于激进');

  assert.ok(conservative.maxPerDay < balanced.maxPerDay, '保守的日上限应小于均衡');
  assert.ok(balanced.maxPerDay < aggressive.maxPerDay, '均衡的日上限应小于激进');

  for (const action of ['reply', 'follow', 'like', 'post']) {
    assert.ok(
      conservative.perAction[action].maxPerDay <= balanced.perAction[action].maxPerDay,
      `${action} 保守档不应高于均衡档`
    );
    assert.ok(
      balanced.perAction[action].maxPerDay <= aggressive.perAction[action].maxPerDay,
      `${action} 均衡档不应高于激进档`
    );
  }
});

test('保守档默认不发帖，且间隔不低于 3 分钟', () => {
  assert.equal(PRESETS.conservative.perAction.post.maxPerDay, 0);
  assert.ok(PRESETS.conservative.delayMinSec >= 180);
  assert.ok(PRESETS.aggressive.delayMinSec >= 30, '激进档也不该低于 30 秒');
});

test('保守档的参数真的能通过 canRun 的护栏检查', () => {
  const now = at(15);
  const behavior = { ...DEFAULT_BEHAVIOR, ...presetValues('conservative'), enabled: true };
  const stats = createStats(now);
  assert.equal(canRun({ behavior, stats, action: 'reply', now }).allowed, true);
  assert.equal(canRun({ behavior, stats, action: 'post', now }).allowed, false, '保守档发帖上限为 0，应被挡住');
});

// ------------------------------------------------------------------ 浏览动作

test('浏览是独立动作，三档预设都给了额度', () => {
  assert.ok(ACTIONS.includes('browse'));
  assert.equal(ACTION_LABELS.browse, '浏览');
  for (const name of PRESET_ORDER) {
    const cap = PRESETS[name].perAction.browse;
    assert.ok(cap && cap.maxPerDay > 0, `${name} 档缺少浏览额度`);
  }
});

test('浏览额度在三档之间单调递增，且不低于评论额度', () => {
  const [conservative, balanced, aggressive] = PRESET_ORDER.map(name => PRESETS[name]);
  assert.ok(conservative.perAction.browse.maxPerDay < balanced.perAction.browse.maxPerDay);
  assert.ok(balanced.perAction.browse.maxPerDay < aggressive.perAction.browse.maxPerDay);
  // 浏览是最安全的动作，额度应当高于评论
  for (const preset of [conservative, balanced, aggressive]) {
    assert.ok(preset.perAction.browse.maxPerDay > preset.perAction.reply.maxPerDay);
  }
});

test('浏览动作也受分动作额度约束', () => {
  const now = at(15);
  const behavior = {
    ...DEFAULT_BEHAVIOR,
    enabled: true,
    perAction: { ...DEFAULT_BEHAVIOR.perAction, browse: { maxPerHour: 3, maxPerDay: 20 } }
  };
  let stats = createStats(now);
  for (let i = 0; i < 3; i += 1) stats = recordAction(stats, 'browse', now);

  const gate = canRun({ behavior, stats, action: 'browse', now });
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /浏览本小时已达上限/);
});

test('分动作上限高于总上限时，先触发的是总上限', () => {
  // 均衡档总上限 10/时、浏览 15/时，所以浏览的分动作额度永远不会先绑住
  const now = at(15);
  const behavior = { ...DEFAULT_BEHAVIOR, enabled: true };
  assert.ok(behavior.perAction.browse.maxPerHour > behavior.maxPerHour);

  let stats = createStats(now);
  for (let i = 0; i < behavior.maxPerHour; i += 1) stats = recordAction(stats, 'browse', now);

  const gate = canRun({ behavior, stats, action: 'browse', now });
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /本小时总动作已达上限/);
});
