// X 养号助手 · 后台调度器
// 职责：单写入者状态管理 + alarms 调度 + 任务队列执行 + 风控自保 + 动作结果验证。

import {
  ACTION_LABELS,
  DEFAULT_BEHAVIOR,
  LANGUAGE_LABELS,
  POST_WEIGHT_LIMIT,
  PRESET_ORDER,
  canRun,
  matchBlacklist,
  normalizeList,
  pickNextTask,
  postPlanDue,
  presetLabel,
  presetValues,
  randomDelayMs,
  recordAction,
  recordError,
  recordSuccess,
  rollStats,
  totalCount,
  weightedLength
} from '../lib/guardrails.js';
import { sniffMimeFromBase64 } from '../lib/image.js';
import { paginateLogs } from '../lib/logs.js';
import {
  CONFIG_DEFAULTS,
  addLog,
  applyLeadPatch,
  getConfig,
  getLeads,
  getState,
  leadsToCsv,
  mergeLeads,
  mergeRecommendedKeywords,
  normalizeBehavior,
  normalizeConfig,
  normalizeIntentConfig,
  normalizeIntentKeywords,
  normalizeKeywords,
  normalizePostPlan,
  parseIntentVerdict,
  pickApiKey,
  pruneSeen,
  resetQueue,
  saveConfig,
  selectNewLeads,
  updateLeads,
  updateState
} from '../lib/store.js';

const TICK_ALARM = 'x-tick';
const DUE_ALARM = 'x-due';
const INTENT_ALARM = 'x-intent';
const TICK_PERIOD_MIN = 1;
const CURRENT_STALE_MS = 5 * 60 * 1000;
const BLOCK_RETRY_MS = 5 * 60 * 1000;
const INTENT_RETRY_MS = 15 * 60 * 1000;

// 限流对照词：正常账号搜它必然有结果。实测连续约 17 次搜索导航后 X 会返回空页，
// 冷却约 2 分钟恢复。没有对照词就无法区分"这个词真没结果"和"被限流了"——
// refill() 原来会把限流当成"这个关键词没结果"，记一条 error 日志并让整个调度器退避 5 分钟。
const THROTTLE_CONTROL_KEYWORD = 'AI';

const SYSTEM_INTENT_CLASSIFY = [
  '你在给社交平台的帖子做意向分类，判断发帖人是不是潜在合作对象。',
  '只输出一个 JSON 对象，不要解释、不要 markdown 代码块。',
  '格式：{"type":"player|creator|none","confidence":0.85,"reason":"不超过20字"}',
  'player = 发帖人本人在求推荐游戏，想找游戏来玩；',
  'creator = 发帖人本人是内容创作者（主播/UP/评测/媒体），在找游戏做内容，或索要 review key / 评测码；',
  'none = 其他一切情况：新闻资讯、开发者自荐、厂商公告、玩梗、纯讨论、广告、博彩推广。',
  '关键：必须是发帖人本人在表达需求。别人在评论里说的话、或者第三方转述都不算。',
  '拿不准就判 none，不要勉强归类。'
].join('\n');

const SYSTEM_POST = [
  '你在帮用户写一条中文社交平台帖子。',
  '要求：口语化、有具体信息量、像真人分享，不要标题党、不要营销话术、不要话题标签。',
  '长度 30-80 字。只输出帖子正文。'
].join('\n');

const SYSTEM_IMAGE_PROMPT = [
  '把用户给你的中文内容转成一句英文图像生成提示词。',
  '只输出提示词本身，不要解释、不要引号、不要在画面里放文字。'
].join('\n');

let ticking = false;
let collecting = false;
let lastAccountKey = '';

// ---------------------------------------------------------------- 生命周期

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarms().catch(() => {});
  bootstrap().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarms().catch(() => {});
  bootstrap().catch(() => {});
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === TICK_ALARM || alarm.name === DUE_ALARM) {
    // 看门狗先跑，而且不受 tick 的防重入影响：tick 可能正卡在一个挂住的任务上，
    // 那时它的超时清理逻辑根本轮不到执行。
    watchdog().catch(() => {});
    tick(alarm.name === DUE_ALARM ? 'due' : 'alarm').catch(() => {});
    return;
  }
  // 意向采集走独立闹钟：它不产生任何写操作，但同样消耗搜索配额，
  // 所以节奏必须和互动任务解耦，不能跟着 refill() 的轮询走。
  if (alarm.name === INTENT_ALARM) {
    collectIntent().catch(() => {});
  }
});

ensureAlarms().catch(() => {});

async function ensureAlarms() {
  const existing = await chrome.alarms.get(TICK_ALARM);
  if (!existing) {
    await chrome.alarms.create(TICK_ALARM, { periodInMinutes: TICK_PERIOD_MIN, delayInMinutes: 0.1 });
  }
}

async function bootstrap() {
  // 上次运行中断留下的"执行中"任务直接作废，避免卡死队列
  await updateState(state => ({
    ...state,
    firstRunAt: state.firstRunAt || Date.now(),
    current: null
  }));
  await log('info', '后台调度器已就绪', '调度');
  // service worker 会被杀，一次性闹钟可能丢失，启动时补一次
  const state = await getState();
  if (state.intentConfig?.enabled) await scheduleIntentNext(10000);
}

// 看门狗：不经过 tick 的防重入，保证挂住的任务一定能被作废。
// 否则一个卡死的任务会让 ticking 永远为 true，整个调度器再也不动。
async function watchdog() {
  const state = await getState();
  if (!state.current) return;
  const age = Date.now() - (state.current.startedAt || 0);
  if (age <= CURRENT_STALE_MS) return;

  await log('warn', `任务超时作废：${describeTask(state.current)}（已卡 ${Math.round(age / 1000)} 秒）`, '调度');
  await updateState(current => ({
    ...current,
    current: null,
    stats: recordError(current.stats, current.behavior, Date.now(), '任务执行超时')
  }));
  // 顺手清掉可能残留在编辑器里的草稿
  const tabId = await currentXTabId();
  if (tabId) await callTab(tabId, { type: 'X_CLEAR_DRAFT' }, { retries: 0, timeoutMs: 15000 }).catch(() => {});
}

// ---------------------------------------------------------------- 消息路由

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case 'GET_ALL':
      return { ok: true, config: await getConfig(), state: await publicState() };
    case 'GET_PANEL':
      return { ok: true, panel: await panelSnapshot() };
    case 'SAVE_CONFIG':
      return { ok: true, config: await saveConfig(normalizeConfig(message.config)) };
    case 'SAVE_BEHAVIOR':
      await applyBehavior(message.behavior || {});
      return { ok: true, state: await publicState() };
    case 'RESET_BEHAVIOR':
      await resetBehavior();
      return { ok: true, state: await publicState() };
    case 'SET_PRESET':
      await setPreset(message.preset);
      return { ok: true, state: await publicState() };
    case 'RESET_PRESET':
      await resetPreset();
      return { ok: true, state: await publicState() };
    case 'SAVE_KEYWORDS':
      await updateState(state => ({ ...state, keywords: normalizeKeywords(message.keywords) }));
      return { ok: true, state: await publicState() };
    case 'SAVE_INTENT_KEYWORDS':
      await updateState(state => ({ ...state, intentKeywords: normalizeIntentKeywords(message.keywords) }));
      return { ok: true, state: await publicState() };
    case 'ADD_RECOMMENDED_KEYWORDS': {
      let added = 0;
      await updateState(state => {
        const merged = mergeRecommendedKeywords(state.intentKeywords);
        added = merged.added;
        return { ...state, intentKeywords: normalizeIntentKeywords(merged.keywords) };
      });
      if (added) await log('info', `已补入 ${added} 个实测推荐词`, '意向');
      return { ok: true, added, state: await publicState() };
    }
    case 'SAVE_INTENT_CONFIG': {
      const next = normalizeIntentConfig({ ...(await getState()).intentConfig, ...(message.config || {}) });
      await updateState(state => ({ ...state, intentConfig: next }));
      // 开关一变就立刻重排闹钟：关掉时要确保不会再有采集跑起来
      if (next.enabled) await scheduleIntentNext(5000);
      else await chrome.alarms.clear(INTENT_ALARM).catch(() => {});
      return { ok: true, state: await publicState() };
    }
    case 'COLLECT_NOW': {
      const result = await collectIntent({ manual: true });
      return { ok: true, result, leads: publicLeads(await getLeads(), message) };
    }
    case 'GET_LEADS':
      return { ok: true, leads: publicLeads(await getLeads(), message) };
    case 'UPDATE_LEAD': {
      await updateLeads(current => ({ ...current, items: applyLeadPatch(current.items, message.id, message.patch || {}) }));
      return { ok: true, leads: publicLeads(await getLeads(), message) };
    }
    case 'DELETE_LEAD': {
      await updateLeads(current => ({ ...current, items: current.items.filter(item => item.id !== message.id) }));
      return { ok: true, leads: publicLeads(await getLeads(), message) };
    }
    case 'CLEAR_LEADS': {
      await updateLeads(() => ({ items: [], lastCollectAt: 0, keywordIndex: 0, collectedToday: 0, countDate: '' }));
      return { ok: true, leads: publicLeads(await getLeads(), message) };
    }
    case 'EXPORT_LEADS': {
      const leads = await getLeads();
      return { ok: true, csv: leadsToCsv(leads.items), count: leads.items.length };
    }
    case 'SET_ENABLED':
      await setEnabled(!!message.enabled);
      return { ok: true, state: await publicState() };
    case 'RUN_NOW':
      await runNow();
      return { ok: true, state: await publicState() };
    case 'SCAN_NOW':
      await updateState(state => ({ ...state, nextRunAt: 0 }));
      await refill();
      return { ok: true, state: await publicState() };
    case 'REMOVE_TASK':
      await removeTask(message.id);
      return { ok: true, state: await publicState() };
    case 'CLEAR_QUEUE':
      await resetQueue();
      await log('info', '队列已清空', '队列');
      return { ok: true, state: await publicState() };
    case 'CLEAR_COOLDOWN': {
      // 修完问题后要能立刻恢复，不用干等冷却结束
      await updateState(state => ({
        ...state,
        stats: { ...state.stats, consecutiveErrors: 0, cooldownUntil: 0, lastError: '', lastErrorAt: 0 }
      }));
      await log('info', '已清除冷却和连续失败计数', '调度');
      return { ok: true, state: await publicState() };
    }
    case 'CLEAR_SEEN': {
      // 已处理记录默认保留 14 天，用来避免重复互动。
      // 但换关键词或想重新跑一遍时需要能清掉，否则同样的帖子永远不会再入队。
      const before = Object.keys((await getState()).seen || {}).length;
      await updateState(state => ({ ...state, seen: {} }));
      await log('info', `已清除 ${before} 条已处理记录`, '调度');
      return { ok: true, state: await publicState() };
    }
    case 'OPEN_PANEL': {
      // 优先开在用户正看着的那个 X 标签页，其次才回落到工作标签页
      const tabId = await activeXTabId() ?? await currentXTabId();
      if (!tabId) throw new Error('请先打开 X 页面');
      return callTab(tabId, { type: 'X_PANEL_OPEN' });
    }
    case 'AI_CHAT':
      return { ok: true, text: await requestChat(message.messages, normalizeConfig({ ...(await getConfig()), ...(message.options || {}) })) };
    case 'AI_IMAGE':
      return { ok: true, dataUrl: await requestImage(message.prompt, normalizeConfig({ ...(await getConfig()), ...(message.options || {}) })) };
    case 'GET_LOGS': {
      const state = await getState();
      return { ok: true, ...paginateLogs(state.logs, message) };
    }
    case 'SAVE_POST_PLAN':
      await updateState(state => ({ ...state, postPlan: normalizePostPlan({ ...state.postPlan, ...(message.plan || {}) }) }));
      return { ok: true, state: await publicState() };
    case 'GENERATE_POSTS': {
      const created = await generatePostItems(message);
      await updateState(state => ({ ...state, postPlan: { ...state.postPlan, items: [...state.postPlan.items, ...created].slice(-500) } }));
      await log('info', `批量生成 ${created.length} 条待发帖`, '发布');
      return { ok: true, created: created.length, state: await publicState() };
    }
    case 'DELETE_POST_ITEM':
      await updateState(state => ({ ...state, postPlan: { ...state.postPlan, items: state.postPlan.items.filter(item => item.id !== message.id) } }));
      return { ok: true, state: await publicState() };
    case 'CLEAR_POST_ITEMS':
      await updateState(state => ({ ...state, postPlan: { ...state.postPlan, items: [] } }));
      return { ok: true, state: await publicState() };
    case 'X_GET_STATE': {
      const tabId = await currentXTabId();
      if (!tabId) return { ok: false, error: '请先打开 X 页面' };
      const result = await callTab(tabId, { type: 'X_GET_STATE' });
      // 顺手把账号信息缓存下来，否则弹窗在第一次自动化之前一直显示"未连接"
      if (result?.ok) await cacheAccount(result.account);
      return result;
    }
    default:
      throw new Error('不支持的操作');
  }
}

// 恢复默认：还原所有节奏/护栏参数，但不重新打开总开关，也不退出演练模式；
// 关键词和黑名单属于用户数据，不参与重置。
async function resetBehavior() {
  await updateState(state => ({
    ...state,
    behavior: normalizeBehavior({
      ...DEFAULT_BEHAVIOR,
      enabled: false,
      dryRun: true,
      blacklistUsers: state.behavior.blacklistUsers,
      blacklistWords: state.behavior.blacklistWords
    }),
    nextRunAt: 0,
    current: null
  }));
  await log('info', '行为参数已恢复默认', '调度');
}

// 切档：把目标档存下来的那一套节奏参数加载成当前生效参数。
// 必须先加载再改 preset——normalizeBehavior 会把"当前生效的扁平字段"写回当前档，
// 如果只改 preset 不加载，旧档的值会被写进新档，把新档存的那套冲掉。
async function setPreset(name) {
  await updateState(state => {
    const target = PRESET_ORDER.includes(name) ? name : state.behavior.preset;
    const rhythm = state.behavior.presetSets?.[target] ?? presetValues(target);
    return { ...state, behavior: normalizeBehavior({ ...state.behavior, ...rhythm, preset: target }) };
  });
  const state = await getState();
  await log('info', `已切到「${presetLabel(state.behavior.preset)}」档`, '调度');
}

// 只把当前档的参数还原成该档内置默认值；其它档、以及与档位无关的设置都不动。
async function resetPreset() {
  await updateState(state => {
    const current = state.behavior.preset;
    return {
      ...state,
      behavior: normalizeBehavior({ ...state.behavior, ...presetValues(current), preset: current })
    };
  });
  const state = await getState();
  await log('info', `「${presetLabel(state.behavior.preset)}」档参数已恢复默认`, '调度');
}

async function publicState() {
  const state = await getState();
  const now = Date.now();
  const stats = rollStats(state.stats, now);
  const gate = canRun({ behavior: state.behavior, stats, action: null, now });
  return {
    ...state,
    // 弹窗每 1.5 秒拉一次，只给最近几条；完整日志走 GET_LOGS 分页取
    logs: state.logs.slice(0, 20),
    stats: { ...stats, total: totalCount(stats) },
    pendingCount: state.queue.filter(task => task.status === 'pending').length,
    blockReason: gate.allowed ? '' : gate.reason,
    presetLabel: presetLabel(state.behavior.preset),
    raiseDays: Math.max(1, Math.floor((now - (state.firstRunAt || now)) / 86400000) + 1),
    nextRunInMs: Math.max(0, (state.nextRunAt || 0) - now)
  };
}

// 线索列表：过滤 + 分页 + 状态计数。跟日志一样走分页接口，
// 不能把 5000 条线索整个塞进每条消息里。
function publicLeads(leads, { intentType = '', followUp = '', search = '', page = 1, pageSize = 20 } = {}) {
  const needle = String(search || '').trim().toLowerCase();
  const filtered = (leads.items || [])
    .filter(item => !intentType || item.intentType === intentType)
    .filter(item => !followUp || item.followUp === followUp)
    .filter(item => {
      if (!needle) return true;
      return [item.text, item.author, item.keyword, item.statusHref]
        .some(value => String(value || '').toLowerCase().includes(needle));
    })
    .sort((a, b) => (b.collectedAt || 0) - (a.collectedAt || 0));

  const size = Math.max(1, Math.min(100, Number(pageSize) || 20));
  const pageCount = Math.max(1, Math.ceil(filtered.length / size));
  const current = Math.min(Math.max(1, Number(page) || 1), pageCount);
  const today = todayKey();

  return {
    entries: filtered.slice((current - 1) * size, current * size),
    total: filtered.length,
    page: current,
    pageCount,
    lastCollectAt: leads.lastCollectAt || 0,
    collectedToday: leads.countDate === today ? leads.collectedToday : 0,
    totalLeads: (leads.items || []).length,
    pendingLeads: (leads.items || []).filter(item => item.followUp === 'new').length
  };
}

async function panelSnapshot() {
  const state = await publicState();
  return {
    enabled: state.behavior.enabled,
    dryRun: state.behavior.dryRun,
    current: state.current,
    pendingCount: state.pendingCount,
    total: state.stats.total,
    maxPerDay: state.behavior.maxPerDay,
    blockReason: state.blockReason,
    challenge: state.challenge,
    keywords: state.keywords,
    // 只传面板要显示的字段，避免把推文全文塞进消息里
    queue: state.queue.slice(-40).map(task => ({
      id: task.id,
      type: task.type,
      status: task.status,
      createdAt: task.createdAt,
      finishedAt: task.finishedAt,
      result: task.result,
      payload: {
        author: task.payload?.author,
        keyword: task.payload?.keyword,
        topic: task.payload?.topic
      }
    })),
    logs: state.logs.slice(0, 60)
  };
}

// ---------------------------------------------------------------- 状态操作

async function applyBehavior(patch) {
  return updateState(state => {
    const behavior = normalizeBehavior({ ...state.behavior, ...patch });
    const justEnabled = behavior.enabled && !state.behavior.enabled;
    return {
      ...state,
      behavior,
      nextRunAt: justEnabled ? 0 : state.nextRunAt,
      challenge: justEnabled ? null : state.challenge
    };
  });
}

async function setEnabled(enabled) {
  await applyBehavior({ enabled });
  await log('info', enabled ? '总开关已打开' : '总开关已关闭', '调度');
  if (enabled) {
    await setBadge('');
    await scheduleNext(0);
  } else {
    await setBadge('');
  }
  await pushPanel();
}

async function runNow() {
  const state = await getState();
  if (!state.behavior.enabled) throw new Error('请先打开总开关');
  await updateState(current => ({ ...current, nextRunAt: 0 }));
  await tick('manual');
  return getState();
}

async function removeTask(id) {
  return updateState(state => ({
    ...state,
    queue: state.queue.filter(task => task.id !== id)
  }));
}

// ---------------------------------------------------------------- 风控自保

async function pauseForChallenge(reason) {
  await updateState(state => ({
    ...state,
    behavior: { ...state.behavior, enabled: false },
    current: null,
    lastBlockReason: `风控：${reason}`,
    challenge: { reason, at: Date.now() }
  }));
  await log('error', `检测到风控，已自动停机：${reason}`, '风控');
  await setBadge('!', '#f4212e');
  await notify('养号助手已自动停机', reason);
  await pushPanel();
}

async function notify(title, message) {
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message: String(message).slice(0, 200)
    });
  } catch {
    // 通知失败不影响停机本身
  }
}

async function setBadge(text, color) {
  try {
    await chrome.action.setBadgeText({ text: text || '' });
    if (color) await chrome.action.setBadgeBackgroundColor({ color });
  } catch {
    // 忽略
  }
}

// ---------------------------------------------------------------- 调度

async function scheduleNext(delayMs) {
  const delay = Math.max(5000, Number(delayMs) || 0);
  await updateState(state => ({ ...state, nextRunAt: Date.now() + delay }));
  try {
    await chrome.alarms.clear(DUE_ALARM);
    await chrome.alarms.create(DUE_ALARM, { when: Date.now() + delay });
  } catch {
    // alarms 失败不影响周期 tick 兜底
  }
}

// 意向采集的独立节奏。用一次性闹钟而不是周期闹钟，因为间隔是可配的，
// 而且每轮结束后要按 paceSec 重新排下一次。
async function scheduleIntentNext(delayMs) {
  const delay = Math.max(5000, Number(delayMs) || 0);
  try {
    await chrome.alarms.clear(INTENT_ALARM);
    await chrome.alarms.create(INTENT_ALARM, { when: Date.now() + delay });
  } catch {
    // 起不来就等下一次 bootstrap 补
  }
}

async function tick(reason = 'alarm') {
  if (ticking) return;
  // 采集和互动任务共用同一个工作标签页，必须互斥：
  // 采集正在扫搜索页时启动一个任务，会把标签页导航走，扫描拿到的是错的页面。
  if (collecting) return;
  ticking = true;
  try {
    let state = await getState();
    const now = Date.now();

    await updateState(current => ({ ...current, lastTickAt: now, lastTickReason: reason }));

    // 已经被风控停过机，等人处理，不自动恢复
    if (state.challenge) return;

    // 有任务卡在"执行中"就等它跑完。超时作废交给 watchdog()——
    // 因为 tick 被防重入挡住时，这里的清理逻辑根本不会被执行到。
    if (state.current) return;

    if (!state.behavior.enabled) {
      await updateState(current => ({ ...current, lastBlockReason: '总开关已关闭' }));
      return;
    }

    // 发帖计划必须放在 nextRunAt 退避之前。
    // 实测踩过：队列一空调度器就退避 5 分钟，而退避检查在计划检查之前，
    // 于是 04:10 到点的计划帖被整个跳过，直到 04:14 退避结束才继续。
    // 定时发帖到点就得发，不该受互动任务的退避影响。
    if (postPlanDue(state.postPlan, state, now)) {
      await enqueuePlanPost();
      // 清掉退避，让这条帖子立刻执行
      await updateState(current => ({ ...current, nextRunAt: 0 }));
      state = await getState();
    }

    if ((state.nextRunAt || 0) > now) return;

    const gate = canRun({ behavior: state.behavior, stats: state.stats, action: null, now });
    if (!gate.allowed) {
      await updateState(current => ({ ...current, lastBlockReason: gate.reason }));
      await log('warn', `暂停：${gate.reason}`, '调度');
      await scheduleNext(BLOCK_RETRY_MS);
      return;
    }

    let task = pickTask(state);
    if (!task) {
      await refill();
      state = await getState();
      task = pickTask(state);
    }
    if (!task) {
      await log('info', '队列为空且没有可入队的新内容，稍后再试', '队列');
      await scheduleNext(BLOCK_RETRY_MS);
      return;
    }

    const perActionGate = canRun({ behavior: state.behavior, stats: state.stats, action: task.type, now });
    if (!perActionGate.allowed) {
      await updateState(current => ({ ...current, lastBlockReason: perActionGate.reason }));
      await log('warn', `暂停：${perActionGate.reason}`, '调度');
      await scheduleNext(BLOCK_RETRY_MS);
      return;
    }

    await executeTask(task);
  } catch (error) {
    await log('error', `调度出错：${error?.message || error}`, '调度');
    await scheduleNext(BLOCK_RETRY_MS);
  } finally {
    ticking = false;
  }
}

// 把发帖计划里最早的一条待发项入队
async function enqueuePlanPost() {
  const state = await getState();
  const item = state.postPlan.items.find(entry => entry.status === 'pending');
  if (!item) return false;

  // 幂等：这条计划帖可能已经在队列里排队了（比如被每小时发帖上限挡住）。
  // 不加这个判断的话，15 分钟宽限期内每分钟的 tick 都会再入队一份，
  // 等上限恢复后同一条文案会被连发很多次——对养号工具等于自曝 spam。
  // 实测：计划帖被 canRun 挡住时 lastPostAt 不更新、条目仍是 pending，
  // postPlanDue 在整个宽限期内持续返回 true。
  const alreadyQueued = state.queue.some(task =>
    task.payload?.planItemId === item.id && task.status !== 'done' && task.status !== 'failed');
  if (alreadyQueued) return false;

  const task = {
    id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'post',
    payload: { text: item.text, planItemId: item.id, topic: item.source },
    status: 'pending',
    attempts: 0,
    createdAt: Date.now()
  };

  await updateState(current => ({
    ...current,
    queue: appendTasks(current.queue, [task], current.behavior.queueLimit)
  }));
  await log('info', `发帖计划到期，入队：${item.text.slice(0, 40)}`, '发布', { action: 'post' });
  return true;
}

// 计划帖发出去之后：标记条目 + 累加当日计数
async function markPlanItemPublished(planItemId, outcome) {
  if (!planItemId) return;
  const now = Date.now();
  const today = new Date(now).toDateString();
  await updateState(state => ({
    ...state,
    lastPostAt: outcome.ok ? now : state.lastPostAt,
    postCountDate: today,
    postCountToday: (state.postCountDate === today ? state.postCountToday || 0 : 0) + (outcome.ok ? 1 : 0),
    postPlan: {
      ...state.postPlan,
      items: state.postPlan.items.map(item => (item.id === planItemId
        ? {
          ...item,
          status: outcome.ok ? 'published' : 'failed',
          publishedAt: outcome.ok ? now : 0,
          error: outcome.ok ? '' : (outcome.error || '未知错误')
        }
        : item))
    }
  }));
}

function pickTask(state) {
  return pickNextTask(state.queue);
}

function describeTask(task) {
  if (!task) return '空任务';
  const label = ACTION_LABELS[task.type] || task.type;
  const who = task.payload?.author ? `@${task.payload.author}` : task.payload?.keyword || task.payload?.topic || '';
  return `${label}${who ? ` ${who}` : ''}`;
}

function taskTag(type) {
  if (type === 'reply' || type === 'post') return '发布';
  if (type === 'browse') return '浏览';
  return '互动';
}

// ---------------------------------------------------------------- 补充队列

// 队列里会保留一部分已完成记录供界面查看，所以"队列长度"不等于"待办数量"。
// 任何跟 queueLimit 的比较都必须只看 pending。
// 实测踩过两个后果：①保留 40 条历史 + queueLimit 默认 30，跑满后补队列永久停止；
// ②[...queue, task].slice(0, queueLimit) 保留的是最旧的一批，会把刚入队的新任务截掉。
const FINISHED_KEEP = 40;

function pendingCount(queue) {
  return (queue || []).filter(task => task.status === 'pending').length;
}

// 追加任务时只保留最近一段，且保证新任务一定在——新任务在末尾，所以用 slice(-N)。
function appendTasks(queue, tasks, queueLimit) {
  const keep = Math.max(1, Number(queueLimit) || 30) + FINISHED_KEEP;
  return [...(queue || []), ...tasks].slice(-keep);
}

// 用对照词判断搜索是不是被限流了。正常账号搜对照词必然有结果。
// 实测连续约 17 次搜索导航后 X 会返回空页，冷却约 2 分钟恢复。
// 互动扫描和意向采集共用同一份搜索配额，所以两边都需要这个判断。
async function isSearchThrottled(tabId) {
  try {
    await navigate(tabId, `https://x.com/search?q=${encodeURIComponent(THROTTLE_CONTROL_KEYWORD)}&src=typed_query&f=live`);
    const control = await callTab(tabId, { type: 'X_SCAN_SEARCH' });
    return !(control?.results || []).length;
  } catch {
    return false;
  }
}

async function refill() {
  const state = await getState();
  const behavior = state.behavior;
  const keywords = state.keywords;

  if (!keywords.length) {
    await log('warn', '没有配置关键词，无法补充队列', '扫描');
    return;
  }
  if (pendingCount(state.queue) >= behavior.queueLimit) return;

  const keyword = keywords[state.keywordIndex % keywords.length];
  await updateState(current => ({
    ...current,
    keywordIndex: (current.keywordIndex + 1) % Math.max(1, keywords.length)
  }));

  const tabId = await ensureWorkerTab();
  const url = `https://x.com/search?q=${encodeURIComponent(keyword)}&src=typed_query&f=live`;
  await navigate(tabId, url);

  const scan = await callTab(tabId, { type: 'X_SCAN_SEARCH' });
  // 扫不到推文有两种可能：这个关键词真没结果，或者搜索被限流了。
  // 意向采集也在消耗同一份搜索配额，所以限流的概率比只跑互动时更高。
  // 不区分的话，限流会被当成"这个关键词没结果"并让整个调度器退避 5 分钟。
  if (!scan?.ok) {
    if (await isSearchThrottled(tabId)) {
      await log('warn', `关键词「${keyword}」扫不到结果，且对照词也为空 → 判定为搜索限流，本轮跳过`, '扫描');
      await scheduleNext(BLOCK_RETRY_MS);
      return;
    }
    throw new Error(scan?.error || '扫描搜索结果失败');
  }

  const now = Date.now();
  const candidates = [];
  for (const result of scan.results || []) {
    if (!result?.statusHref || !result.text) continue;
    if (state.seen[result.statusHref]) continue;
    const blocked = matchBlacklist(behavior, result);
    if (blocked) {
      await log('info', `跳过：${blocked}`, '扫描');
      continue;
    }
    candidates.push(result);
    if (candidates.length >= behavior.scanLimit) break;
  }

  if (!candidates.length) {
    await log('info', `关键词「${keyword}」没有新的可用结果`, '扫描');
    return;
  }

  const newTasks = [];
  let followed = 0;

  for (const candidate of candidates) {
    if (behavior.engage.like) {
      newTasks.push(makeTask('like', {
        statusHref: candidate.statusHref,
        author: candidate.author,
        sourceText: candidate.text
      }, behavior));
    }
    if (behavior.engage.reply) {
      newTasks.push(makeTask('reply', {
        statusHref: candidate.statusHref,
        author: candidate.author,
        sourceText: candidate.text,
        comment: ''
      }, behavior));
    }
    if (behavior.engage.follow && candidate.author && followed < behavior.maxFollowPerScan) {
      newTasks.push(makeTask('follow', { author: candidate.author }, behavior));
      followed += 1;
    }
    if (pendingCount(state.queue) + newTasks.length >= behavior.queueLimit) break;
  }

  if (behavior.engage.browse && pendingCount(state.queue) + newTasks.length < behavior.queueLimit) {
    newTasks.push(makeTask('browse', { keyword }, behavior));
  }
  if (behavior.engage.post && pendingCount(state.queue) + newTasks.length < behavior.queueLimit) {
    newTasks.push(makeTask('post', { topic: keyword }, behavior));
  }

  const seen = { ...state.seen };
  for (const candidate of candidates) seen[candidate.statusHref] = now;

  await updateState(current => ({
    ...current,
    queue: appendTasks(current.queue, newTasks, behavior.queueLimit),
    seen: pruneSeen({ ...current.seen, ...seen }, now)
  }));

  await log('info', `关键词「${keyword}」命中 ${candidates.length} 条帖子，入队 ${newTasks.length} 个任务`, '扫描');
}

// ---------------------------------------------------------------- 意向采集
// 只读采集：只往 xLeads 登记线索，绝不产生点赞/评论/关注/发帖。
// 私信由人工完成——这是刻意的：冷发链接和批量私信正是 X 判定 spam 的核心特征。

async function classifyIntent(text, lang) {
  const raw = await requestChat([
    { role: 'system', content: SYSTEM_INTENT_CLASSIFY },
    { role: 'user', content: `语种：${lang || '未知'}\n帖子正文：\n${String(text).slice(0, 500)}` }
  ]);
  return parseIntentVerdict(raw);
}

function todayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

async function collectIntent(options = {}) {
  if (collecting) return { ok: false, error: '采集已在进行中' };
  collecting = true;
  try {
    return await runCollectIntent(options);
  } finally {
    collecting = false;
  }
}

async function runCollectIntent({ manual = false } = {}) {
  const state = await getState();
  const config = normalizeIntentConfig(state.intentConfig);

  if (!config.enabled && !manual) return { ok: false, error: '意向采集未启用' };
  // 风控停机时一并停采集：虽然不写操作，但用的是同一个账号和同一份搜索配额
  if (state.challenge && !manual) return { ok: false, error: '账号处于风控停机状态' };
  // 养号任务正在执行 → 让开。两者共用同一个工作标签页，
  // 把标签页从正在评论的任务脚下导航走，会让它对着错误的页面操作。
  if (state.current) {
    if (manual) return { ok: false, error: '养号任务正在执行中，等它跑完再采集' };
    await scheduleIntentNext(60000);
    return { ok: true, skipped: 'busy' };
  }

  const keywords = normalizeIntentKeywords(state.intentKeywords).filter(item => item.enabled);
  if (!keywords.length) {
    await log('warn', '没有启用的意向关键词，采集无法进行', '意向');
    return { ok: false, error: '没有启用的意向关键词' };
  }

  const now = Date.now();
  const leads = await getLeads();
  const today = todayKey(now);
  const usedToday = leads.countDate === today ? leads.collectedToday : 0;
  const remaining = config.dailyLimit - usedToday;
  if (remaining <= 0) {
    await log('info', `今日意向线索已达上限 ${config.dailyLimit} 条，暂停采集`, '意向');
    await scheduleIntentNext(INTENT_RETRY_MS);
    return { ok: true, added: 0, capped: true };
  }

  const item = keywords[leads.keywordIndex % keywords.length];
  const behavior = state.behavior;
  const tabId = await ensureWorkerTab();

  await navigate(tabId, `https://x.com/search?q=${encodeURIComponent(item.keyword)}&src=typed_query&f=live`);
  const scan = await callTab(tabId, { type: 'X_SCAN_INTENT', scrollRounds: config.scrollRounds });
  if (!scan?.ok) throw new Error(scan?.error || '扫描搜索结果失败');

  const results = scan.results || [];

  // 采集同样会撞上验证码。养号那边靠 checkChallengeAfterTask 停机，这里必须也查一次——
  // 否则采集撞上验证码只会被后面的限流判定吞掉（"0 结果 → 判定为限流"），
  // 总开关还开着，养号继续跑，等于白白把风控信号放过去。
  await checkChallengeAfterTask(behavior);
  if ((await getState()).challenge) {
    await log('warn', '采集过程中检测到风控，已停机', '意向');
    return { ok: false, error: '检测到风控，已停机' };
  }

  // 限流感知：0 结果时拿对照词验一次，区分"真没结果"和"被限流"。
  // 现有 refill() 没有这一步，所以限流时它会写"没有新的可用结果"然后照常轮换，
  // 日志上完全看不出异常，实际是在静默漏采。
  if (!results.length && config.throttleGuard) {
    if (await isSearchThrottled(tabId)) {
      await log('warn', `「${item.keyword}」0 结果且对照词也为空 → 判定为搜索限流，本轮跳过`, '意向');
      await scheduleIntentNext(Math.max(config.paceSec * 1000, 120000));
      return { ok: true, added: 0, throttled: true };
    }
    await log('info', `「${item.keyword}」确实没有结果（对照词正常）`, '意向');
  }

  const cutoff = now - config.windowHours * 3600 * 1000;
  // 两层去重（帖子地址 + 作者）都收在 selectNewLeads 里，那边有单测覆盖。
  // 作者级去重是必须的：实测 @thegaming_gmr 一个人在一次扫描里就贡献了 5 条。
  const { fresh, skippedOld, skippedDupAuthor } = selectNewLeads(results, {
    knownHrefs: leads.items.map(entry => entry.statusHref),
    knownAuthors: leads.items.map(entry => entry.author),
    cutoff,
    isBlocked: result => !!matchBlacklist(behavior, result)
  });

  const collected = [];
  let classified = 0;
  let rejected = 0;
  let classifyFailed = 0;
  let lastClassifyError = '';

  for (const result of fresh) {
    if (collected.length >= remaining) break;
    let intentType = item.type;
    let confidence = 1;
    let reason = '按关键词归类';

    if (config.aiClassify) {
      try {
        const verdict = await classifyIntent(result.text, item.lang);
        classified += 1;
        if (verdict.type === 'none' || verdict.confidence < 0.5) { rejected += 1; continue; }
        intentType = verdict.type;
        confidence = verdict.confidence;
        reason = verdict.reason;
      } catch (error) {
        // 分类失败不能把线索丢掉：回落到关键词预设类型并压低置信度
        classifyFailed += 1;
        lastClassifyError = String(error?.message || error).slice(0, 60);
        confidence = 0.4;
        reason = `分类失败：${lastClassifyError}`;
      }
    }

    collected.push({
      statusHref: result.statusHref,
      author: result.author,
      text: result.text,
      postedAt: result.postedAt,
      keyword: item.keyword,
      lang: item.lang,
      intentType,
      confidence,
      reason,
      collectedAt: now
    });
  }

  const merged = mergeLeads(leads.items, collected, now);
  await updateLeads(current => ({
    ...current,
    items: merged.items,
    lastCollectAt: now,
    keywordIndex: (current.keywordIndex + 1) % Math.max(1, keywords.length),
    countDate: today,
    collectedToday: (current.countDate === today ? current.collectedToday : 0) + merged.added.length
  }));

  await log('info', `「${item.keyword}」扫到 ${results.length} 条 → 新增线索 ${merged.added.length} 条（过期 ${skippedOld} 条，同作者重复 ${skippedDupAuthor} 条，AI 判无关 ${rejected} 条）`, '意向');
  // 分类全失败时必须单独报一条：否则日志上「AI 判无关 0 条」看起来像"AI 说全都相关"，
  // 实际是 AI 根本没配上、全部按关键词预设类型降级登记了。
  if (classifyFailed) {
    await log('warn', `本轮 ${classifyFailed} 条帖子 AI 分类失败（${lastClassifyError}），已按关键词预设类型登记、置信度 0.40`, '意向');
  }
  await scheduleIntentNext(config.paceSec * 1000);
  return { ok: true, added: merged.added.length, scanned: results.length };
}

function makeTask(type, payload, behavior) {
  return {
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    payload,
    status: 'pending',
    attempts: 0,
    createdAt: Date.now()
  };
}

// ---------------------------------------------------------------- 执行任务

async function setStage(stage, progress) {
  await updateState(current => (current.current
    ? { ...current, current: { ...current.current, stage, progress } }
    : current));
  await pushPanel();
}

async function executeTask(task) {
  const state = await getState();
  const behavior = state.behavior;

  await updateState(current => ({
    ...current,
    current: { id: task.id, type: task.type, label: describeTask(task), stage: '准备中', progress: 5, startedAt: Date.now() },
    queue: current.queue.map(item => (item.id === task.id ? { ...item, status: 'running', attempts: (item.attempts || 0) + 1 } : item))
  }));
  await log('info', `开始 ${describeTask(task)}${behavior.dryRun ? '（演练）' : ''}`, taskTag(task.type), taskLogFields(task));
  await pushPanel();

  let outcome;
  const actionStartedAt = Date.now();
  try {
    outcome = await runByType(task, behavior);
  } catch (error) {
    outcome = { ok: false, error: error?.message || String(error) };
  }
  // 记下页面执行耗时：后台标签页被节流，慢起来非常离谱，
  // 没有这个数字根本看不出时间花在哪一步。
  outcome.elapsedSec = Math.round((Date.now() - actionStartedAt) / 1000);

  const now = Date.now();
  await updateState(current => {
    const updated = current.queue.map(item => (item.id === task.id
      ? { ...item, status: outcome.ok ? 'done' : 'failed', finishedAt: now, result: outcome.ok ? 'ok' : outcome.error }
      : item));

    // 只保留最近 FINISHED_KEEP 条已完成记录，避免队列无限增长
    const finished = updated
      .filter(item => item.status === 'done' || item.status === 'failed')
      .sort((a, b) => (a.finishedAt || 0) - (b.finishedAt || 0));
    const keepIds = new Set(finished.slice(-FINISHED_KEEP).map(item => item.id));
    const nextQueue = updated.filter(item => (item.status !== 'done' && item.status !== 'failed') || keepIds.has(item.id));

    return {
      ...current,
      current: null,
      queue: nextQueue,
      // 演练模式不消耗配额，否则演练完就没额度真跑了。
      // noop（已经赞过/已关注，什么都没做）同理——消耗配额会让演练提前停摆。
      stats: outcome.ok
        ? (outcome.dryRun || outcome.noop
          ? recordSuccess(current.stats)
          : recordAction(recordSuccess(current.stats), task.type, now))
        : recordError(current.stats, current.behavior, now, outcome.error || '未知错误'),
      // 只有真实发出去的评论才计入去重历史
      recentComments: outcome.ok && !outcome.dryRun && !outcome.noop && outcome.comment
        ? [{ at: now, text: outcome.comment }, ...current.recentComments].slice(0, 50)
        : current.recentComments
    };
  });

  // 计划帖：回写条目状态和当日计数
  await markPlanItemPublished(task.payload?.planItemId, outcome);

  if (outcome.ok) {
    const suffix = outcome.dryRun ? '（演练，未真实提交）' : '';
    await log('success', `${describeTask(task)} 完成${suffix} · 耗时 ${outcome.elapsedSec || 0} 秒`, taskTag(task.type), { ...taskLogFields(task), result: 'ok' });
    // 演练模式把生成的内容打出来——否则用户根本不知道"本来会发什么"
    if (outcome.dryRun && outcome.comment) {
      await log('info', `演练内容：${outcome.comment}`, taskTag(task.type), taskLogFields(task));
    }
  } else {
    await log('error', `${describeTask(task)} 失败：${outcome.error} · 耗时 ${outcome.elapsedSec || 0} 秒`, taskTag(task.type), { ...taskLogFields(task), result: 'failed' });
  }

  await checkChallengeAfterTask(behavior);
  await scheduleNext(randomDelayMs(behavior));
  await pushPanel();
}

// 任务跑完再确认一次风控状态：导航时正常、但操作过程中被弹出验证码的情况
async function checkChallengeAfterTask(behavior) {
  if (!behavior.pauseOnChallenge) return;
  const state = await getState();
  if (state.challenge) return; // 已经停机过了，别重复通知
  const tabId = await currentXTabId();
  if (!tabId) return;
  const check = await callTab(tabId, { type: 'X_CHECK_CHALLENGE' }).catch(() => null);
  if (check?.challenge) await pauseForChallenge(check.challenge);
}

async function runByType(task, behavior) {
  const tabId = await ensureWorkerTab();
  const humanize = {
    humanize: behavior.humanize,
    humanizeScrollMin: behavior.humanizeScrollMin,
    humanizeScrollMax: behavior.humanizeScrollMax,
    humanizePauseMinSec: behavior.humanizePauseMinSec,
    humanizePauseMaxSec: behavior.humanizePauseMaxSec
  };

  // 动作类调用：不重试。
  // 一是重试会把调度器阻塞时间翻倍；二是更危险——提交超时后重试可能造成重复发帖/重复评论。
  // 超时预算（后台标签页被节流，实测每一项都可能远超预期）：
  //   拟人化 ≤45s + 生图 ≤60s + 填表 ≤29s + 提交等待 10s + 提交验证 30s + 带图上传 若干
  // 实测踩过：拟人化 92s + 填表 60s + 生图 60s 就把 240 秒顶爆了，任务被判超时。
  const ACTION_CALL = { retries: 0, timeoutMs: 300000 };

  if (task.type === 'browse') {
    const url = task.payload.keyword
      ? `https://x.com/search?q=${encodeURIComponent(task.payload.keyword)}&src=typed_query&f=live`
      : 'https://x.com/home';
    await setStage('打开页面', 30);
    await navigate(tabId, url);
    await setStage('滚动浏览', 65);
    const result = await callTab(tabId, {
      type: 'X_BROWSE',
      scrolls: behavior.browseScrolls,
      pauseMinMs: behavior.humanizePauseMinSec * 1000,
      pauseMaxMs: behavior.humanizePauseMaxSec * 1000
    }, ACTION_CALL);
    if (!result?.ok) return { ok: false, error: result?.error || '浏览失败' };
    await setStage('完成', 100);
    // 浏览不产生内容，演练模式下也照做，但不消耗配额
    return { ok: true, dryRun: behavior.dryRun };
  }

  if (task.type === 'reply') {
    await setStage('打开帖子', 10);
    await navigate(tabId, `https://x.com${task.payload.statusHref}`);

    await setStage('生成评论', 30);
    const comment = task.payload.comment || await generateComment(task.payload.sourceText, behavior);

    // 刻意不做带图评论：几次实测都没在结果里看到图，但验证方法不可靠
    // （媒体异步附上 + tweetPhoto 懒加载，容易误判成"没图"），
    // 到底是 X 风控剥离还是验证误判没有定论。出于风控考虑先不做。
    await setStage('填写内容', 60);
    const result = await callTab(tabId, {
      type: 'X_REPLY',
      statusHref: task.payload.statusHref,
      text: comment,
      dryRun: behavior.dryRun,
      humanize
    }, ACTION_CALL);
    if (!result?.ok) return { ok: false, error: result?.error || '回复失败' };
    await setStage('完成', 100);
    return { ok: true, dryRun: !!result.dryRun, comment };
  }

  if (task.type === 'like') {
    await setStage('打开帖子', 30);
    await navigate(tabId, `https://x.com${task.payload.statusHref}`);
    await setStage('点赞', 65);
    const result = await callTab(tabId, { type: 'X_LIKE', statusHref: task.payload.statusHref, dryRun: behavior.dryRun, humanize }, ACTION_CALL);
    if (!result?.ok) return { ok: false, error: result?.error || '点赞失败' };
    await setStage('完成', 100);
    // 已经赞过就什么都没做，不该消耗配额（演练模式下尤其重要：
    // 否则配额会被"已赞"的任务耗光，演练提前停摆）
    if (result.alreadyLiked) return { ok: true, noop: true, dryRun: behavior.dryRun };
    return { ok: true, dryRun: !!result.dryRun };
  }

  if (task.type === 'follow') {
    await setStage('打开主页', 30);
    await navigate(tabId, `https://x.com/${encodeURIComponent(task.payload.author)}`);
    await setStage('关注', 65);
    const result = await callTab(tabId, { type: 'X_FOLLOW', username: task.payload.author, dryRun: behavior.dryRun, humanize }, ACTION_CALL);
    if (!result?.ok) return { ok: false, error: result?.error || '关注失败' };
    await setStage('完成', 100);
    if (result.alreadyFollowing) return { ok: true, noop: true, dryRun: behavior.dryRun };
    return { ok: true, dryRun: !!result.dryRun };
  }

  if (task.type === 'post') {
    await setStage('打开发帖页', 10);
    await navigate(tabId, 'https://x.com/home');
    await setStage('生成内容', 35);
    const text = task.payload.text || await generatePost(task.payload.topic || '');

    // 计划帖可以带图（配置在发帖计划里，不在行为参数里）
    const plan = (await getState()).postPlan;
    let mediaDataUrl = '';
    if (shouldAttachImage(plan.withImage, plan.imageChance)) {
      await setStage('生成配图', 50);
      try {
        mediaDataUrl = await generateMediaFor(text);
      } catch (error) {
        await log('warn', `配图生成失败，改为纯文字发帖：${error?.message || error}`, '生成');
      }
    }

    await setStage('填写内容', 65);
    // 最后一道保险：不管是计划帖还是自动生成，提交前再确认一次加权字数。
    // 超了就直接发不出去（按钮禁用），而且报错信息看不出原因。
    let finalText = text;
    if (weightedLength(finalText) > POST_WEIGHT_LIMIT) {
      finalText = fitTextHard(finalText, POST_WEIGHT_LIMIT);
      await log('warn', `文案超字数，已截断到 ${POST_WEIGHT_LIMIT} 加权单位后再发`, '发布', { action: 'post' });
    }
    const result = await callTab(tabId, { type: 'X_POST', text: finalText, mediaDataUrl, dryRun: behavior.dryRun, humanize }, ACTION_CALL);
    if (!result?.ok) return { ok: false, error: result?.error || '发帖失败' };
    await setStage('完成', 100);
    return { ok: true, dryRun: !!result.dryRun };
  }

  return { ok: false, error: `未知任务类型 ${task.type}` };
}

function shouldAttachImage(mode, chance) {
  if (mode === 'always') return true;
  if (mode === 'sometimes') return Math.random() < chance;
  return false;
}

// ---------------------------------------------------------------- 标签页驱动

async function currentXTabId() {
  const tabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] });
  const state = await getState();
  const worker = state.workerTabId ? tabs.find(tab => tab.id === state.workerTabId) : null;
  return (worker || tabs.find(tab => tab.active) || tabs[0])?.id ?? null;
}

async function activeXTabId() {
  const tabs = await chrome.tabs.query({
    url: ['https://x.com/*', 'https://twitter.com/*'],
    active: true,
    currentWindow: true
  });
  return tabs[0]?.id ?? null;
}

async function ensureWorkerTab() {
  const state = await getState();
  const behavior = state.behavior;
  const tabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] });

  let tab = behavior.dedicatedTab
    ? tabs.find(item => item.id === state.workerTabId)
    : (tabs.find(item => item.active) || tabs[0]);

  if (!tab) {
    tab = await chrome.tabs.create({ url: 'https://x.com/home', active: behavior.activateTab });
    await log('info', '已打开一个 X 工作标签页', '调度');
  }
  if (state.workerTabId !== tab.id) {
    await updateState(current => ({ ...current, workerTabId: tab.id }));
  }

  await waitForTabReady(tab.id);
  return tab.id;
}

async function navigate(tabId, url) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) throw new Error('X 工作标签页已关闭');
  if (tab.url !== url) {
    await chrome.tabs.update(tabId, { url });
  }
  await waitForTabReady(tabId, url.split('?')[0]);
}

async function waitForTabReady(tabId, expectedPrefix = '', timeout = 40000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error('X 工作标签页已关闭');
    const urlOk = !expectedPrefix || String(tab.url || '').startsWith(expectedPrefix);
    if (tab.status === 'complete' && urlOk) {
      const pong = await pingTab(tabId);
      if (pong?.ok) {
        await cacheAccount(pong.account);
        if (pong.challenge) {
          const behavior = (await getState()).behavior;
          if (behavior.pauseOnChallenge) await pauseForChallenge(pong.challenge);
          throw new Error(`风控拦截：${pong.challenge}`);
        }
        return tab;
      }
    }
    await wait(600);
  }
  throw new Error('等待 X 页面加载超时，请检查该标签页是否已登录');
}

async function pingTab(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'X_PING' });
  } catch {
    await injectContentScript(tabId);
    return null;
  }
}

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/x-content.js'] });
  } catch {
    // 页面不允许注入（例如未登录跳转页）时忽略，交给上层重试
  }
}

// chrome.tabs.sendMessage 没有超时：内容脚本要是卡住（等一个永远不出现的元素），
// 这个 Promise 永远不 settle，整个 executeTask 就挂在那里。
// 实测踩过：一个发帖任务卡了 343 秒没结束，还因为 tick 的防重入标记一直为 true，
// 把整个调度器堵死了。所以所有跨进程调用都必须带超时。
function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

async function callTab(tabId, message, { retries = 2, timeoutMs = 90000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await withTimeout(
        chrome.tabs.sendMessage(tabId, message),
        timeoutMs,
        `页面脚本 ${message.type} 超过 ${Math.round(timeoutMs / 1000)} 秒没响应`
      );
      if (!response) throw new Error('页面脚本没有返回结果');
      return response;
    } catch (error) {
      lastError = error;
      await injectContentScript(tabId);
      await wait(600);
    }
  }
  throw new Error(lastError?.message || '页面脚本调用失败');
}

// 只在账号真的变了的时候写存储，避免 600ms 轮询里反复读写
async function cacheAccount(account) {
  if (!account?.handle) return;
  const key = `${account.handle}|${account.avatar}`;
  if (key === lastAccountKey) return;
  lastAccountKey = key;
  await updateState(state => ({ ...state, account }));
}

// ---------------------------------------------------------------- AI

function buildCommentPrompt(behavior) {
  const styles = normalizeList(behavior.commentStyles);
  const language = behavior.commentLanguage || 'match';

  // 关键：默认跟随原帖语言。写死中文的话，在英文/日文推文下非常突兀，
  // 也更容易被看出是机器批量操作。
  const languageRule = language === 'match'
    ? '先判断原帖用什么语言写的，然后用同一种语言回复。原帖是英文就写英文，是日文就写日文，以此类推。'
    : `用${LANGUAGE_LABELS[language] || '中文'}回复。`;

  return [
    '你在帮用户写一条社交平台评论，目标是让它看起来完全像真人随手打的。',
    languageRule,
    '内容要求：贴着原帖的具体内容说话，可以补充一个细节、提一个问题、或表达真实的共鸣；不要泛泛而谈。',
    '绝对不要暴露你是 AI：',
    '  - 不要客服腔、不要"首先/其次/总之/总的来说"这类结构词',
    '  - 不要总结或复述原帖',
    '  - 不要过度礼貌（"感谢分享""很有启发"这种）',
    '  - 不要 emoji 堆砌、不要话题标签、不要加引号',
    '长度按语言习惯：中文 15-45 字，英文 5-20 个词，日文 15-40 字。',
    styles.length ? `语气倾向：${styles.join('、')}。` : '',
    '只输出评论正文，不要任何解释。'
  ].filter(Boolean).join('\n');
}

async function generateComment(sourceText, behavior) {
  const state = await getState();
  const config = await getConfig();
  const source = String(sourceText || '').slice(0, 800);
  const system = buildCommentPrompt(behavior || state.behavior);
  let candidate = '';

  for (let attempt = 0; attempt < 3; attempt++) {
    const hint = attempt === 0 ? '' : '上一版与最近已发过的评论太像了，请换一个完全不同的角度和句式。\n\n';
    candidate = String(await requestChat([
      { role: 'system', content: system },
      { role: 'user', content: `${hint}要评论的帖子：\n${source}` }
    ], config)).trim();
    if (candidate && !isTooSimilar(candidate, state.recentComments)) break;
  }

  if (!candidate) throw new Error('AI 没有返回评论内容');
  return candidate;
}

async function generatePost(topic, maxWeight = POST_WEIGHT_LIMIT) {
  const config = await getConfig();
  const text = String(await requestChat([
    { role: 'system', content: SYSTEM_POST },
    { role: 'user', content: `围绕这个话题写一条帖子：${topic || '日常分享'}` }
  ], config)).trim();
  if (!text) throw new Error('AI 没有返回帖子内容');
  // 必须卡字数：X 未开会员上限是 280 加权（CJK 算 2），超了按钮会禁用、提交直接失败。
  // 实测踩过：关键词驱动的自动发帖走的就是这条路，AI 写超了就一直发不出去，
  // 而且失败信息完全看不出是字数问题。计划帖走的是 translateAndFit，这里补上。
  return fitToWeight(text, '中文', maxWeight, config);
}

async function generateMediaFor(sourceText) {
  const config = await getConfig();
  let prompt = '';
  try {
    prompt = String(await requestChat([
      { role: 'system', content: SYSTEM_IMAGE_PROMPT },
      { role: 'user', content: String(sourceText).slice(0, 500) }
    ], config)).trim();
  } catch {
    prompt = '';
  }
  if (!prompt) prompt = `a calm natural photo related to: ${String(sourceText).slice(0, 200)}`;
  return requestImage(prompt, config);
}

// 字符二元组 Jaccard 相似度，用来防止 AI 反复输出同一句话被判定为垃圾内容
function bigrams(text) {
  const clean = String(text).replace(/\s+/g, '');
  const out = new Set();
  for (let index = 0; index < clean.length - 1; index += 1) out.add(clean.slice(index, index + 2));
  return out;
}

export function similarity(a, b) {
  const setA = bigrams(a);
  const setB = bigrams(b);
  if (!setA.size || !setB.size) return 0;
  let shared = 0;
  for (const gram of setA) if (setB.has(gram)) shared += 1;
  return shared / (setA.size + setB.size - shared);
}

function isTooSimilar(text, history, threshold = 0.7) {
  return (history || []).some(item => similarity(text, item.text) >= threshold);
}

function buildEndpoint(baseUrl, path) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return `${base.endsWith('/v1') ? base : `${base}/v1`}${path}`;
}

async function loadConfig(options = {}, purpose = 'chat') {
  const config = normalizeConfig({ ...CONFIG_DEFAULTS, ...(await getConfig()), ...options });
  if (!config.baseUrl) throw new Error('请先填写中转站地址');
  if (!pickApiKey(config, purpose)) {
    throw new Error(purpose === 'image' ? '请先填写生图 API Key' : '请先填写 API Key');
  }
  return config;
}

async function requestChat(messages, options) {
  const config = await loadConfig(options, 'chat');
  const response = await fetch(buildEndpoint(config.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pickApiKey(config, 'chat')}` },
    body: JSON.stringify({ model: config.chatModel, messages, temperature: 0.95 })
  });
  const data = await readJson(response);
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('中转站没有返回文字结果');
  return Array.isArray(content) ? content.map(item => item.text || '').join('') : String(content);
}

async function requestImage(prompt, options) {
  const config = await loadConfig(options, 'image');
  const response = await fetch(buildEndpoint(config.baseUrl, '/images/generations'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pickApiKey(config, 'image')}` },
    body: JSON.stringify({
      model: config.imageModel,
      prompt,
      size: config.imageSize,
      response_format: 'b64_json'
    })
  });
  const data = await readJson(response);
  const item = data.data?.[0];
  if (!item) throw new Error('中转站没有返回图片');
  if (item.b64_json) {
    // 不能硬编码 image/png：中转站可能返回 jpeg/webp，MIME 错了 X 会拒收
    return `data:${sniffMimeFromBase64(item.b64_json)};base64,${item.b64_json}`;
  }
  if (item.url) return downloadAsDataUrl(item.url);
  throw new Error('图片结果格式不受支持');
}

async function downloadAsDataUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`图片下载失败（${response.status}）`);
  const mime = response.headers.get('content-type') || 'image/png';
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

async function readJson(response) {
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`中转站返回了无效响应（${response.status}）`);
  }
  if (!response.ok) {
    throw new Error(data.error?.message || data.message || `中转站请求失败（${response.status}）`);
  }
  return data;
}

// ---------------------------------------------------------------- 日志与面板

// extra 里带上结构化字段（action / statusHref / author / result），日志页要用
async function log(level, message, tag = '调度', extra = {}) {
  const entry = await addLog(level, message, { tag, ...extra });
  pushPanel().catch(() => {});
  return entry;
}

// 从任务里抽出日志页需要的字段
function taskLogFields(task) {
  return {
    action: task.type,
    statusHref: task.payload?.statusHref || null,
    author: task.payload?.author || null
  };
}

// ---------------------------------------------------------------- 发帖计划

function makePostItem(source, text, language) {
  return {
    id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: String(source || '').slice(0, 2000),
    text: String(text || '').trim(),
    language,
    weight: weightedLength(text),
    status: 'pending',
    createdAt: Date.now(),
    publishedAt: 0,
    statusHref: '',
    error: ''
  };
}

// 超字数就要求 AI 压缩，最多两次；仍然超就硬截断，保证能发出去
async function fitToWeight(text, langLabel, maxWeight, config) {
  let current = String(text || '').trim();
  if (weightedLength(current) <= maxWeight) return current;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const weight = weightedLength(current);
    const raw = await requestChat([
      {
        role: 'system',
        content: `把下面这条${langLabel}帖子压缩到加权字数 ${maxWeight} 以内（当前 ${weight}）。`
          + '加权规则：CJK 字符算 2，拉丁字母算 1。保留核心意思、保持自然口语、不要话题标签。只输出压缩后的正文。'
      },
      { role: 'user', content: current }
    ], config);
    current = String(raw).trim();
    if (weightedLength(current) <= maxWeight) return current;
  }

  // 兜底：AI 压不下来就自己截断，否则永远发不出去
  return fitTextHard(current, maxWeight);
}

// 按加权字数硬截断。抽成独立函数，是因为提交前还要再兜一次底
// （计划帖可能是更早生成的，那时 maxWeight 跟现在不一样）。
function fitTextHard(text, maxWeight) {
  const source = String(text || '').trim();
  let out = '';
  let weight = 0;
  for (const char of source) {
    const cost = weightedLength(char);
    if (weight + cost > maxWeight) break;
    out += char;
    weight += cost;
  }
  return out.trim() || source.slice(0, Math.max(1, Math.floor(maxWeight / 2)));
}

async function translateAndFit(source, langLabel, maxWeight, config) {
  const raw = await requestChat([
    {
      role: 'system',
      content: `把用户给你的内容翻译成${langLabel}，并润色成一条自然的社交媒体帖子。`
        + '要求：像真人写的，不要翻译腔，不要话题标签，不要营销话术。'
        + `硬性限制：加权字数不超过 ${maxWeight}（CJK 字符算 2，拉丁字母算 1）。只输出帖子正文。`
    },
    { role: 'user', content: source }
  ], config);
  return fitToWeight(String(raw).trim(), langLabel, maxWeight, config);
}

async function generatePostItems({ mode = 'translate', sources = [], topic = '', count = 5, language = 'en' } = {}) {
  const config = await getConfig();
  const state = await getState();
  const maxWeight = state.postPlan.maxWeight || 280;
  const langLabel = LANGUAGE_LABELS[language] || language;
  const items = [];

  if (mode === 'translate') {
    const list = (Array.isArray(sources) ? sources : String(sources).split('\n')).map(s => String(s || '').trim()).filter(Boolean).slice(0, 20);
    for (const source of list) {
      items.push(makePostItem(source, await translateAndFit(source, langLabel, maxWeight, config), language));
    }
    return items;
  }

  const wanted = Math.max(1, Math.min(20, Number(count) || 1));
  const raw = await requestChat([
    {
      role: 'system',
      content: `你是社交媒体内容创作者。用${langLabel}写帖子：每条独立、角度不同、像真人分享，不要标题党、不要话题标签。`
        + `每条加权字数不超过 ${Math.floor(maxWeight * 0.9)}（CJK 字符算 2，拉丁字母算 1）。`
        + '只输出帖子正文，每条之间用单独一行 --- 分隔，不要编号。'
    },
    { role: 'user', content: `主题：${topic || '日常分享'}\n写 ${wanted} 条。` }
  ], config);

  for (const chunk of String(raw).split(/\n\s*-{3,}\s*\n/)) {
    const text = chunk.trim();
    if (!text) continue;
    items.push(makePostItem(`（AI 生成 · ${topic || '日常分享'}）`, await fitToWeight(text, langLabel, maxWeight, config), language));
    if (items.length >= wanted) break;
  }
  return items;
}

// ---------------------------------------------------------------- 发帖计划
async function pushPanel() {
  const tabId = await currentXTabId();
  if (!tabId) return;
  const panel = await panelSnapshot();
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'X_PANEL', payload: panel });
  } catch {
    // 面板不存在时忽略
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
