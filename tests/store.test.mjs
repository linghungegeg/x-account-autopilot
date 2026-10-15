// store.js 依赖 chrome.storage，这里用一个内存假实现来测持久化层的真实行为。

import test from 'node:test';
import assert from 'node:assert/strict';

const memory = new Map();

globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        if (typeof key === 'string') {
          return memory.has(key) ? { [key]: structuredClone(memory.get(key)) } : {};
        }
        if (Array.isArray(key)) {
          return Object.fromEntries(key.filter(k => memory.has(k)).map(k => [k, structuredClone(memory.get(k))]));
        }
        const out = {};
        for (const [k, fallback] of Object.entries(key || {})) {
          out[k] = memory.has(k) ? structuredClone(memory.get(k)) : fallback;
        }
        return out;
      },
      async set(patch) {
        for (const [k, v] of Object.entries(patch)) memory.set(k, structuredClone(v));
      }
    }
  }
};

const store = await import('../src/lib/store.js');
const { PRESETS, presetValues } = await import('../src/lib/guardrails.js');

test('默认状态是安全态：总开关关闭 + 演练模式开启', async () => {
  memory.clear();
  const state = await store.getState();
  assert.equal(state.behavior.enabled, false);
  assert.equal(state.behavior.dryRun, true);
  assert.deepEqual(state.queue, []);
  assert.deepEqual(state.keywords, []);
});

test('updateState 串行化读改写，并发调用不丢更新', async () => {
  memory.clear();
  await store.getState();

  await Promise.all(Array.from({ length: 25 }, () => store.updateState(state => ({
    ...state,
    keywordIndex: (state.keywordIndex || 0) + 1
  }))));

  const state = await store.getState();
  assert.equal(state.keywordIndex, 25);
});

test('一次写入失败不会永久破坏写入链', async () => {
  memory.clear();
  await store.getState();

  await assert.rejects(
    store.updateState(() => { throw new Error('boom'); }),
    /boom/
  );

  const next = await store.updateState(state => ({ ...state, keywordIndex: 999 }));
  assert.equal(next.keywordIndex, 999);
  assert.equal((await store.getState()).keywordIndex, 999);
});

test('addLog 只保留最近 2000 条且最新的在最前', async () => {
  memory.clear();
  await store.getState();
  for (let i = 0; i < 2005; i += 1) await store.addLog('info', `第 ${i} 条`);

  const state = await store.getState();
  assert.equal(state.logs.length, 2000);
  assert.equal(state.logs[0].message, '第 2004 条');
});

test('pruneSeen 丢弃过期记录', async () => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const seen = {
    '/a/status/1': now - day,
    '/a/status/2': now - 13 * day,
    '/a/status/3': now - 15 * day
  };
  const pruned = store.pruneSeen(seen, now);
  assert.deepEqual(Object.keys(pruned).sort(), ['/a/status/1', '/a/status/2']);
});

test('normalizeBehavior 把越界参数夹回合法区间', () => {
  const behavior = store.normalizeBehavior({
    delayMinSec: 1,
    delayMaxSec: 999999,
    maxPerHour: -5,
    maxPerDay: 99999,
    activeHours: { start: 99, end: -3 },
    stopAfterConsecutiveErrors: 0,
    perAction: { reply: { maxPerHour: -1, maxPerDay: 99999 } }
  });

  assert.equal(behavior.delayMinSec, 5);
  assert.equal(behavior.delayMaxSec, 7200);
  assert.equal(behavior.maxPerHour, 0);
  assert.equal(behavior.maxPerDay, 2000);
  assert.deepEqual(behavior.activeHours, { start: 23, end: 0 });
  assert.equal(behavior.stopAfterConsecutiveErrors, 1);
  assert.equal(behavior.perAction.reply.maxPerHour, 0);
  assert.equal(behavior.perAction.reply.maxPerDay, 2000);
  assert.equal(behavior.perAction.follow.maxPerDay, 30, '未提供的动作应保留默认上限');
});

test('空值不会绕过 fallback 变成 0（否则上限变 0 会封死所有动作）', () => {
  // Number('') / Number(null) / Number([]) / Number(false) 全是 0，
  // 而 0 是有限数，会绕过原来的 fallback 判断。
  // 实测后果：用户清空"每小时总上限"保存后，canRun 里 used >= 0 恒真，
  // 所有动作被封死，日志一直刷"本小时总动作已达上限 0"。
  const fallback = store.normalizeBehavior({});
  for (const empty of ['', null, undefined, false, [], 'abc']) {
    const behavior = store.normalizeBehavior({ maxPerHour: empty, maxPerDay: empty });
    assert.equal(behavior.maxPerHour, fallback.maxPerHour, `maxPerHour 空值 ${JSON.stringify(empty)} 应回落默认`);
    assert.equal(behavior.maxPerDay, fallback.maxPerDay, `maxPerDay 空值 ${JSON.stringify(empty)} 应回落默认`);
  }
  // 显式填 0 仍然要尊重（用户可能真的想暂停某类动作）
  assert.equal(store.normalizeBehavior({ maxPerHour: 0 }).maxPerHour, 0);
});

test('结束时段允许填 24，不会塌缩成"全天"的反义', () => {
  // 填 24 若被夹成 23，且开始也是 23，就得到 {23,23}——
  // 而 start === end 表示"全天"，护栏会 24 小时放行，跟本意相反。
  assert.deepEqual(store.normalizeBehavior({ activeHours: { start: 9, end: 24 } }).activeHours, { start: 9, end: 24 });
  assert.deepEqual(store.normalizeBehavior({ activeHours: { start: 23, end: 24 } }).activeHours, { start: 23, end: 24 });
  // 开始时段仍然只到 23
  assert.equal(store.normalizeBehavior({ activeHours: { start: 99, end: 5 } }).activeHours.start, 23);
  // 发帖计划窗口同理
  assert.equal(store.normalizePostPlan({ windowStart: 22, windowEnd: 24 }).windowEnd, 24);
});

test('delayMinSec > delayMaxSec 时把 max 抬到 min（否则用户填的小值被静默忽略）', () => {
  const behavior = store.normalizeBehavior({ delayMinSec: 300, delayMaxSec: 60 });
  assert.equal(behavior.delayMinSec, 300);
  assert.equal(behavior.delayMaxSec, 300);
});

test('defaultState 深拷贝，改它不会污染模块级默认常量', () => {
  const a = store.defaultState();
  a.behavior.perAction.like.maxPerDay = 1;
  a.behavior.engage.reply = false;
  a.behavior.commentStyles.push('污染');
  a.postPlan.items.push({ id: 'x' });
  a.postPlan.scheduledTimes.push('00:00');

  const b = store.defaultState();
  assert.equal(b.behavior.perAction.like.maxPerDay, store.defaultState().behavior.perAction.like.maxPerDay, 'perAction 不该被污染');
  assert.equal(b.behavior.engage.reply, true, 'engage 不该被污染');
  assert.equal(b.behavior.commentStyles.includes('污染'), false, 'commentStyles 不该被污染');
  assert.equal(b.postPlan.items.length, 0, 'items 不该被污染');
  assert.equal(b.postPlan.scheduledTimes.includes('00:00'), false, 'scheduledTimes 不该被污染');
});

test('normalizeConfig 去掉尾部斜杠并保留默认模型', () => {
  const config = store.normalizeConfig({ baseUrl: 'https://relay.example.com/v1///', apiKey: ' sk-1 ' });
  assert.equal(config.baseUrl, 'https://relay.example.com/v1');
  assert.equal(config.apiKey, 'sk-1');
  assert.equal(config.chatModel, 'gpt-4o-mini');
});

test('文字与生图可以用不同的 Key，生图 Key 留空时复用文字 Key', () => {
  const separate = store.normalizeConfig({ apiKey: 'sk-chat', imageApiKey: 'sk-image' });
  assert.equal(store.pickApiKey(separate, 'chat'), 'sk-chat');
  assert.equal(store.pickApiKey(separate, 'image'), 'sk-image');

  const shared = store.normalizeConfig({ apiKey: 'sk-only' });
  assert.equal(shared.imageApiKey, '');
  assert.equal(store.pickApiKey(shared, 'chat'), 'sk-only');
  assert.equal(store.pickApiKey(shared, 'image'), 'sk-only', '生图 Key 留空应复用文字 Key');

  const empty = store.normalizeConfig({});
  assert.equal(store.pickApiKey(empty, 'chat'), '');
  assert.equal(store.pickApiKey(empty, 'image'), '');
  assert.equal(store.pickApiKey(undefined, 'image'), '');
});

// ------------------------------------------------------------------ 档位

test('preset 是存储字段：合法值原样保留，非法值回落到均衡', () => {
  assert.equal(store.normalizeBehavior({ preset: 'aggressive' }).preset, 'aggressive');
  assert.equal(store.normalizeBehavior({ preset: 'nonsense' }).preset, 'balanced');
  assert.equal(store.normalizeBehavior({}).preset, 'balanced');
});

test('每档各自记住自己那套参数，切档不丢改动', () => {
  // 在均衡档把每日上限改掉
  const edited = store.normalizeBehavior({ ...presetValues('balanced'), preset: 'balanced', maxPerDay: 77 });
  assert.equal(edited.preset, 'balanced', '改参数不该掉档');
  assert.equal(edited.presetSets.balanced.maxPerDay, 77, '改动写进均衡档');
  assert.equal(edited.presetSets.aggressive.maxPerDay, PRESETS.aggressive.maxPerDay, '其它档不受影响');

  // 切到激进档：生效参数变成激进那套
  const switched = store.normalizeBehavior({ ...edited, ...edited.presetSets.aggressive, preset: 'aggressive' });
  assert.equal(switched.preset, 'aggressive');
  assert.equal(switched.maxPerDay, PRESETS.aggressive.maxPerDay);

  // 切回均衡档：之前改的 77 还在
  const back = store.normalizeBehavior({ ...switched, ...switched.presetSets.balanced, preset: 'balanced' });
  assert.equal(back.maxPerDay, 77, '切回来应该还是改过的值');
});

test('超出范围的档位参数会被夹取，但档位不变', () => {
  const behavior = store.normalizeBehavior({ ...presetValues('aggressive'), preset: 'aggressive', maxPerDay: 99999 });
  assert.equal(behavior.maxPerDay, 2000);
  assert.equal(behavior.preset, 'aggressive', '夹取不该把档位打掉');
  assert.equal(behavior.presetSets.aggressive.maxPerDay, 2000, '存下来的也该是夹过的值');
});

test('三档的默认参数都完整，且与 PRESETS 一致', () => {
  const behavior = store.normalizeBehavior({});
  for (const name of ['conservative', 'balanced', 'aggressive']) {
    const rhythm = behavior.presetSets[name];
    assert.equal(rhythm.delayMinSec, PRESETS[name].delayMinSec);
    assert.equal(rhythm.maxPerDay, PRESETS[name].maxPerDay);
    assert.equal(rhythm.perAction.reply.maxPerDay, PRESETS[name].perAction.reply.maxPerDay);
    assert.equal(rhythm.activeHours.end, PRESETS[name].activeHours.end);
  }
});

test('历史状态里没有 presetSets 时能补齐，不会炸', () => {
  const behavior = store.normalizeBehavior({ preset: 'conservative', delayMinSec: 200 });
  assert.equal(behavior.presetSets.conservative.delayMinSec, 200);
  assert.equal(behavior.presetSets.balanced.delayMinSec, PRESETS.balanced.delayMinSec);
  assert.equal(behavior.presetSets.aggressive.delayMinSec, PRESETS.aggressive.delayMinSec);
});

// ------------------------------------------------------------------ 新增参数

test('发帖带图的配置项已移除（改由发帖计划管理）', () => {
  const behavior = store.normalizeBehavior({ postImage: 'always', postImageChance: 1 });
  assert.equal('postImage' in behavior, false);
  assert.equal('postImageChance' in behavior, false);
});

test('评论语言默认跟随原帖，非法值回落到 match', () => {
  assert.equal(store.normalizeBehavior({}).commentLanguage, 'match');
  assert.equal(store.normalizeBehavior({ commentLanguage: '乱填' }).commentLanguage, 'match');
  for (const lang of ['match', 'zh', 'en', 'ja']) {
    assert.equal(store.normalizeBehavior({ commentLanguage: lang }).commentLanguage, lang);
  }
});

test('已移除功能的配置字段都会被丢掉，不留历史残留', () => {
  const behavior = store.normalizeBehavior({
    replyImage: 'always',
    replyImageChance: 1,
    postImage: 'always',
    postImageChance: 1,
    mode: 'review'
  });
  for (const field of ['replyImage', 'replyImageChance', 'postImage', 'postImageChance', 'mode']) {
    assert.equal(field in behavior, false, `${field} 应该被丢掉`);
  }
});

test('滚动次数与停留时间的上下限不会倒挂', () => {
  const behavior = store.normalizeBehavior({ humanizeScrollMin: 9, humanizeScrollMax: 2 });
  assert.ok(behavior.humanizeScrollMax >= behavior.humanizeScrollMin);

  const pauses = store.normalizeBehavior({ humanizePauseMinSec: 30, humanizePauseMaxSec: 5 });
  assert.ok(pauses.humanizePauseMaxSec >= pauses.humanizePauseMinSec);
});

test('评论风格会去重、去空、限量', () => {
  const behavior = store.normalizeBehavior({ commentStyles: [' 真诚互动 ', '真诚互动', '', '提问式'] });
  assert.deepEqual(behavior.commentStyles, ['真诚互动', '提问式']);

  const many = store.normalizeBehavior({ commentStyles: Array.from({ length: 40 }, (_, i) => `风格${i}`) });
  assert.equal(many.commentStyles.length, 10);
});

test('字段缺失时评论风格回落到默认，用户主动清空则尊重空数组', () => {
  assert.deepEqual(store.normalizeBehavior({}).commentStyles, ['真诚互动', '提问式', '简短共鸣']);
  assert.deepEqual(store.normalizeBehavior({ commentStyles: [] }).commentStyles, []);
});

test('风控自保与拟人化默认开启', () => {
  const behavior = store.normalizeBehavior({});
  assert.equal(behavior.pauseOnChallenge, true);
  assert.equal(behavior.humanize, true);
  assert.equal(behavior.engage.browse, true);
});

// ---------------------------------------------------------------- 意向线索

test('默认状态里意向采集是关闭的，但推荐词已经预置好，且和互动关键词分开', () => {
  const state = store.defaultState();
  // 开关默认关闭：装完不会自己跑
  assert.equal(state.intentConfig.enabled, false);
  // 但词池预置了实测推荐词，用户打开开关就能用
  assert.ok(state.intentKeywords.length >= 15, `推荐词应预置好，实际 ${state.intentKeywords.length} 个`);
  assert.ok(state.intentKeywords.some(item => item.keyword === '"review code" game'));
  assert.ok(state.intentKeywords.some(item => item.type === 'creator'));
  assert.ok(state.intentKeywords.some(item => item.type === 'player'));
  // 互动池和意向池必须是两个独立字段，否则意向词会被拿去点赞/关注
  assert.deepEqual(state.keywords, []);
  assert.notEqual(state.keywords, state.intentKeywords);
});

test('推荐词是深拷贝，改默认状态不会污染模块常量', () => {
  const a = store.defaultState();
  a.intentKeywords[0].keyword = '被改坏了';
  a.intentKeywords.push({ keyword: '多出来的' });
  const b = store.defaultState();
  assert.notEqual(b.intentKeywords[0].keyword, '被改坏了');
  assert.equal(b.intentKeywords.length, store.DEFAULT_INTENT_KEYWORDS.length);
  assert.equal(store.DEFAULT_INTENT_KEYWORDS[0].keyword, '"review code" game');
});

test('推荐词里不含踩过坑的黑产 / 体育歧义词', () => {
  const words = store.DEFAULT_INTENT_KEYWORDS.map(item => item.keyword).join('\n');
  // 博彩 bot 网络刷屏
  assert.doesNotMatch(words, /rekomendasi game/i);
  // 中文黑产（百家乐招代理、盗号服务、实名卡）
  assert.doesNotMatch(words, /游戏代理|代理 游戏/);
  // 英文 game 的体育歧义：这两句捞出来全是比赛
  assert.doesNotMatch(words, /games like this|games similar to/i);
  // 密度 949/天但精度 0% 的推荐贴标题
  assert.doesNotMatch(words, /おすすめのゲームありませんか/);
});

test('mergeRecommendedKeywords 只补缺的，不动已有的', () => {
  const current = [{ keyword: '"review code" game', lang: 'EN', type: 'creator', enabled: false }];
  const merged = store.mergeRecommendedKeywords(current);
  // 已有的那条保留（包括用户关掉的 enabled: false）
  const kept = merged.keywords.find(item => item.keyword === '"review code" game');
  assert.equal(kept.enabled, false);
  // 其余推荐词补齐
  assert.equal(merged.added, store.DEFAULT_INTENT_KEYWORDS.length - 1);
  assert.equal(merged.keywords.length, store.DEFAULT_INTENT_KEYWORDS.length);

  // 再来一次不会重复添加
  const again = store.mergeRecommendedKeywords(merged.keywords);
  assert.equal(again.added, 0);
  assert.equal(again.keywords.length, store.DEFAULT_INTENT_KEYWORDS.length);
});

test('getState 在旧状态缺 intentKeywords 时补上推荐词，但用户清空过就不补', async () => {
  memory.clear();
  // 模拟 0.5.0 升级上来的状态：有 xState，但没有 intentKeywords 字段
  memory.set('xState', { keywords: ['AI 工具'], queue: [], seen: {} });
  const upgraded = await store.getState();
  assert.ok(upgraded.intentKeywords.length >= 15, '升级上来应自动补推荐词');
  assert.deepEqual(upgraded.keywords, ['AI 工具'], '互动词池不受影响');

  // 用户主动清空过：存的是 []，不能再补回来
  memory.clear();
  memory.set('xState', { keywords: [], intentKeywords: [], queue: [], seen: {} });
  const cleared = await store.getState();
  assert.deepEqual(cleared.intentKeywords, []);
});

test('意向词池补齐语种和类型，非法类型回落到找游戏', () => {
  const list = store.normalizeIntentKeywords([
    '"review code" game',
    { keyword: 'recomienden juegos', lang: 'es', type: 'creator' },
    { keyword: '坏类型', type: 'nonsense' },
    { keyword: '   ' },
    null,
    { lang: 'EN' }
  ]);
  assert.equal(list.length, 3);
  // 纯字符串按默认值补齐
  assert.deepEqual(list[0], { keyword: '"review code" game', lang: 'EN', type: 'player', enabled: true });
  // 语种统一大写
  assert.equal(list[1].lang, 'ES');
  assert.equal(list[1].type, 'creator');
  assert.equal(list[2].type, 'player');
});

test('意向采集参数被夹回合法区间，默认值是保守的', () => {
  const defaults = store.normalizeIntentConfig({});
  assert.equal(defaults.windowHours, 72);
  assert.equal(defaults.paceSec, 25);
  assert.equal(defaults.throttleGuard, true);
  assert.equal(defaults.aiClassify, true);

  const clamped = store.normalizeIntentConfig({
    windowHours: 99999,
    paceSec: 0,
    dailyLimit: -5,
    scrollRounds: 99
  });
  assert.equal(clamped.windowHours, 720);
  assert.equal(clamped.paceSec, 5);
  assert.equal(clamped.dailyLimit, 0);
  assert.equal(clamped.scrollRounds, 10);
});

test('mergeLeads 按帖子地址去重，重复的不会二次登记', () => {
  const now = Date.now();
  const first = store.mergeLeads([], [
    { statusHref: '/a/status/1', text: 'a', collectedAt: now },
    { statusHref: '/a/status/2', text: 'b', collectedAt: now }
  ], now);
  assert.equal(first.added.length, 2);

  const second = store.mergeLeads(first.items, [
    { statusHref: '/a/status/2', text: 'b', collectedAt: now },
    { statusHref: '/a/status/3', text: 'c', collectedAt: now }
  ], now);
  assert.equal(second.added.length, 1);
  assert.equal(second.items.length, 3);

  // 没有地址的条目直接丢掉，否则去重键是空的会互相覆盖
  const noHref = store.mergeLeads([], [{ text: '没有地址' }], now);
  assert.equal(noHref.added.length, 0);
});

test('pruneLeads 丢掉过期线索', () => {
  const now = Date.now();
  const items = [
    { statusHref: '/a/status/1', collectedAt: now - 1000 },
    { statusHref: '/a/status/2', collectedAt: now - 100 * 24 * 3600 * 1000 }
  ];
  assert.deepEqual(store.pruneLeads(items, now).map(item => item.statusHref), ['/a/status/1']);
});

test('applyLeadPatch 只改跟进状态和备注，非法状态被忽略', () => {
  const items = [{ id: 'x', followUp: 'new', note: '' }];
  const updated = store.applyLeadPatch(items, 'x', { followUp: 'messaged', note: '已私信' });
  assert.equal(updated[0].followUp, 'messaged');
  assert.equal(updated[0].note, '已私信');

  const bad = store.applyLeadPatch(items, 'x', { followUp: '乱填' });
  assert.equal(bad[0].followUp, 'new');

  // 改不存在的 id 不该动任何东西
  assert.deepEqual(store.applyLeadPatch(items, 'nope', { followUp: 'messaged' }), items);
});

test('selectNewLeads 两层去重：同帖子只留一次，同一个人也只留一次', () => {
  const now = Date.now();
  const iso = ms => new Date(now - ms).toISOString();
  const results = [
    { statusHref: '/a/1', author: 'alice', text: 'x', postedAt: iso(1000) },
    { statusHref: '/a/2', author: 'alice', text: 'y', postedAt: iso(2000) },  // 同作者 → 丢
    { statusHref: '/a/3', author: 'bob', text: 'z', postedAt: iso(3000) },
    { statusHref: '/a/3', author: 'bob', text: 'z', postedAt: iso(3000) },    // 同帖子 → 丢
    { statusHref: '/a/4', author: 'carol', text: 'w', postedAt: iso(4000) }
  ];
  const out = store.selectNewLeads(results, { cutoff: now - 3600e3 });
  assert.deepEqual(out.fresh.map(r => r.statusHref), ['/a/1', '/a/3', '/a/4']);
  assert.equal(out.skippedDupAuthor, 1);
});

test('selectNewLeads 过滤过期和无时间戳的帖子', () => {
  const now = Date.now();
  const results = [
    { statusHref: '/a/1', author: 'a', text: 'x', postedAt: new Date(now - 1000).toISOString() },
    { statusHref: '/a/2', author: 'b', text: 'y', postedAt: new Date(now - 100 * 24 * 3600e3).toISOString() },
    { statusHref: '/a/3', author: 'c', text: 'z', postedAt: '' }
  ];
  const out = store.selectNewLeads(results, { cutoff: now - 72 * 3600e3 });
  assert.deepEqual(out.fresh.map(r => r.statusHref), ['/a/1']);
  assert.equal(out.skippedOld, 2, '过期和没时间戳的都要算跳过');
});

test('selectNewLeads 尊重已有线索里的作者和帖子地址', () => {
  const now = Date.now();
  const out = store.selectNewLeads(
    [
      { statusHref: '/a/1', author: 'alice', text: 'x', postedAt: new Date(now).toISOString() },
      { statusHref: '/a/9', author: 'alice', text: 'y', postedAt: new Date(now).toISOString() },
      { statusHref: '/a/2', author: 'bob', text: 'z', postedAt: new Date(now).toISOString() }
    ],
    { knownHrefs: ['/a/1'], knownAuthors: ['alice'], cutoff: now - 3600e3 }
  );
  // /a/1 已存在 → 丢；/a/9 作者已存在 → 丢；只剩 bob
  assert.deepEqual(out.fresh.map(r => r.statusHref), ['/a/2']);
});

test('selectNewLeads 的黑名单回调生效', () => {
  const now = Date.now();
  const out = store.selectNewLeads(
    [
      { statusHref: '/a/1', author: 'spammer', text: '博彩', postedAt: new Date(now).toISOString() },
      { statusHref: '/a/2', author: 'ok', text: 'hi', postedAt: new Date(now).toISOString() }
    ],
    { cutoff: now - 3600e3, isBlocked: r => r.author === 'spammer' }
  );
  assert.deepEqual(out.fresh.map(r => r.statusHref), ['/a/2']);
});

test('parseIntentVerdict 能扛住模型不老实的输出', () => {
  // 正常
  assert.deepEqual(store.parseIntentVerdict('{"type":"creator","confidence":0.9,"reason":"求key"}'),
    { type: 'creator', confidence: 0.9, reason: '求key' });
  assert.equal(store.parseIntentVerdict('{"type":"player","confidence":0.8}').type, 'player');

  // 包在 markdown 代码块里
  assert.equal(store.parseIntentVerdict('```json\n{"type":"creator","confidence":0.7}\n```').type, 'creator');
  // 前后加了解释
  assert.equal(store.parseIntentVerdict('判定结果如下：{"type":"player","confidence":0.6} 以上。').type, 'player');

  // 非法 JSON / 没有 JSON / 空 → 一律 none，宁可不采不可错采
  assert.equal(store.parseIntentVerdict('这个我判不了').type, 'none');
  assert.equal(store.parseIntentVerdict('{不是合法json}').type, 'none');
  assert.equal(store.parseIntentVerdict('').type, 'none');
  assert.equal(store.parseIntentVerdict(null).type, 'none');

  // 未知 type 当 none
  assert.equal(store.parseIntentVerdict('{"type":"maybe","confidence":0.9}').type, 'none');

  // 置信度被夹到 0-1，缺失当 0
  assert.equal(store.parseIntentVerdict('{"type":"player","confidence":5}').confidence, 1);
  assert.equal(store.parseIntentVerdict('{"type":"player","confidence":-3}').confidence, 0);
  assert.equal(store.parseIntentVerdict('{"type":"player"}').confidence, 0);
  assert.equal(store.parseIntentVerdict('{"type":"player","confidence":"0.55"}').confidence, 0.55);
});

test('leadsToCsv 按 RFC4180 转义，否则原文里的逗号和换行会错行', () => {
  const csv = store.leadsToCsv([{
    statusHref: '/a/status/1',
    author: 'someone',
    intentType: 'creator',
    confidence: 0.9,
    text: '他说,"有,逗号"\n还有换行',
    followUp: 'new',
    collectedAt: 1700000000000
  }]);
  const lines = csv.split('\r\n');
  assert.match(lines[0], /^帖子地址,作者,意向类型/);
  // 含逗号和换行的字段必须整体加引号，内部引号翻倍
  assert.match(lines[1], /"他说,""有,逗号""/);
  assert.match(csv, /https:\/\/x\.com\/a\/status\/1/);
  assert.match(csv, /@someone/);
});

test('线索存在独立的 storage key，不会污染 xState', async () => {
  memory.clear();
  await store.updateState(state => state);
  await store.updateLeads(() => ({
    items: [store.normalizeLead({ statusHref: '/a/status/9', text: 'hi' })],
    lastCollectAt: 123,
    keywordIndex: 0,
    collectedToday: 1,
    countDate: '2026-09-22'
  }));

  const leads = await store.getLeads();
  assert.equal(leads.items.length, 1);
  assert.equal(leads.collectedToday, 1);

  // 两个 key 必须分开：线索量级比状态大得多，混进 xState 会让每次状态读写都变慢
  assert.ok(memory.has('xLeads'), '线索应写在 xLeads');
  assert.ok(memory.has('xState'), '状态应写在 xState');
  const state = await store.getState();
  assert.equal(state.leads, undefined, 'xState 里不该有线索字段');
});

test('updateLeads 串行化，并发追加不丢更新', async () => {
  memory.clear();
  await store.getLeads();

  await Promise.all(Array.from({ length: 20 }, (_, i) => store.updateLeads(current => ({
    ...current,
    keywordIndex: (current.keywordIndex || 0) + 1
  }))));

  assert.equal((await store.getLeads()).keywordIndex, 20);
});
