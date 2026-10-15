// 持久化层：配置 + 运行状态 + 队列 + 统计 + 日志。
// 只有 service worker 写这份状态，popup / options 一律通过消息读写，避免并发覆盖。

import { COMMENT_LANGUAGES, DEFAULT_BEHAVIOR, DEFAULT_PRESET, IMAGE_MODES, PRESET_ORDER, createStats, normalizeList, pickRhythm } from './guardrails.js';

const COMMENT_LANGUAGE_VALUES = COMMENT_LANGUAGES.map(item => item.value);

export const CONFIG_DEFAULTS = {
  baseUrl: '',
  apiKey: '',
  // 有些中转站文字和生图是两个 key，留空则复用 apiKey
  imageApiKey: '',
  chatModel: 'gpt-4o-mini',
  imageModel: 'gpt-image-1',
  imageSize: '1024x1024'
};

const CONFIG_KEY = 'xConfig';
const STATE_KEY = 'xState';

const LOG_LIMIT = 2000;
const SEEN_LIMIT = 5000;
const SEEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------- 意向线索
// 与"关键词（互动池）"完全分开：互动池的词用来找帖子点赞/评论/关注，
// 意向池的词只用来采集线索，绝不产生任何写操作。
const LEADS_KEY = 'xLeads';
const LEADS_LIMIT = 5000;
const LEADS_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export const INTENT_TYPES = ['player', 'creator'];
export const FOLLOW_UP_STATES = ['new', 'messaged', 'replied', 'converted', 'ignored'];

export const INTENT_TYPE_LABELS = {
  player: '找游戏',
  creator: '创作者'
};

export const FOLLOW_UP_LABELS = {
  new: '未处理',
  messaged: '已私信',
  replied: '已回复',
  converted: '已转化',
  ignored: '已忽略'
};

// 默认值全部偏保守：72 小时时间窗（实测 Latest 在结果稀少时会退化成全时段召回，
// 不过滤就会捞到几年前的帖子）、25 秒间隔（实测连续约 17 次搜索会触发限流）。
export const DEFAULT_INTENT_CONFIG = {
  enabled: false,
  windowHours: 72,
  paceSec: 25,
  dailyLimit: 40,
  scrollRounds: 3,
  aiClassify: true,
  throttleGuard: true
};

// 实测跑出来的高价值词（逐语种搜索采样，条/天和精度都是真实数据）。
// 内置成默认值的原因：这些词是逐个语种试出来的，手抄既容易漏、又容易抄错引号
// （比如 "review code" game 的引号是短语匹配的一部分，去掉就完全变味）。
//
// 排除在外的词（踩过的坑，别加回来）：
//   rekomendasi game (ID)      37.6 条/天，但全是老虎机博彩 bot 网络刷屏
//   游戏代理 / 代理 游戏 招募 (CN) 捞出来是"百家乐直招代理""盗号服务 + 实名卡"
//   games like this / games similar to (EN) 全是体育比赛（英文 game 的体育歧义）
//   おすすめのゲームありませんか (JA) 密度 949 条/天但精度 0%，是推荐贴标题不是求助
export const DEFAULT_INTENT_KEYWORDS = [
  // ---- 创作者意向：实测只有英文有效。其他语种的 review code 概念词跨度都是几个月到几年，
  //      创作者社群是英语化的，他们用 review code / key 而不是本地化说法 ----
  { keyword: '"review code" game', lang: 'EN', type: 'creator', enabled: true },    // ~4.7/天
  { keyword: '"review key" game', lang: 'EN', type: 'creator', enabled: true },     // ~1.8/天
  { keyword: '"send me your game"', lang: 'EN', type: 'creator', enabled: true },   // ~0.7/天
  { keyword: '"press key" game', lang: 'EN', type: 'creator', enabled: true },      // 量低但精度极高
  { keyword: 'keymailer', lang: 'EN', type: 'creator', enabled: true },             // 2 小时窗口，最实时

  // ---- 找游戏意向 ----
  { keyword: 'スマホゲーム おすすめ 教えて', lang: 'JA', type: 'player', enabled: true }, // ~5.9/天，精度高且全是手游
  { keyword: 'ゲーム おすすめ教えて', lang: 'JA', type: 'player', enabled: true },       // ~111/天，但精度仅 ~20%，必须靠 AI 过滤
  { keyword: 'recomienden juegos', lang: 'ES', type: 'player', enabled: true },          // ~5.4/天
  { keyword: '"what game should i play"', lang: 'EN', type: 'player', enabled: true },   // ~4.8/天
  { keyword: 'recomendem jogos', lang: 'PT', type: 'player', enabled: true },            // ~3.1/天
  { keyword: 'oyun önerisi', lang: 'TR', type: 'player', enabled: true },                // ~2.3/天
  { keyword: 'indiquem jogos', lang: 'PT', type: 'player', enabled: true },              // ~1.4/天
  { keyword: '"recommend me a game"', lang: 'EN', type: 'player', enabled: true },       // ~0.6/天
  { keyword: '"suggest me a game"', lang: 'EN', type: 'player', enabled: true },         // 采样 100% 命中
  { keyword: '"looking for a game like"', lang: 'EN', type: 'player', enabled: true },   // 采样高精度
  { keyword: 'recomienden juegos parecidos', lang: 'ES', type: 'player', enabled: true },// 采样 100% 命中
  { keyword: '"any good mobile games"', lang: 'EN', type: 'player', enabled: true },     // 量极小但精度极高
  { keyword: '"во что поиграть"', lang: 'RU', type: 'player', enabled: true }            // ~0.4/天
];

// 一键把推荐词补进现有词池：只加缺的，不动用户已经改过的
export function mergeRecommendedKeywords(current) {
  const list = normalizeIntentKeywords(current);
  const have = new Set(list.map(item => item.keyword));
  const added = DEFAULT_INTENT_KEYWORDS
    .filter(item => !have.has(item.keyword))
    .map(item => ({ ...item }));
  return { keywords: [...list, ...added].slice(0, 100), added: added.length };
}

// 发帖计划：输入文案 → 翻译到目标语言 → 卡字数 → 可选配图 → 定时/随机发布
export const DEFAULT_POST_PLAN = {
  enabled: false,
  dailyLimit: 3,
  windowStart: 9,
  windowEnd: 23,
  scheduledTimes: ['09:30', '15:00', '21:00'],
  language: 'en',              // 目标语言
  withImage: 'sometimes',      // off | sometimes | always
  imageChance: 0.5,
  maxWeight: 280,              // 加权字数上限（会员账号可以调高）
  items: []                    // { id, source, text, status, createdAt, publishedAt, statusHref, error }
};

export function normalizePostPlan(plan = {}) {
  const merged = { ...DEFAULT_POST_PLAN, ...plan };
  const times = Array.isArray(merged.scheduledTimes) ? merged.scheduledTimes : [];
  return {
    ...merged,
    enabled: !!merged.enabled,
    dailyLimit: clampInt(merged.dailyLimit, 0, 50, DEFAULT_POST_PLAN.dailyLimit),
    // 同样允许 windowEnd 填 24；起止相同仍然表示全天
    windowStart: clampInt(merged.windowStart, 0, 23, DEFAULT_POST_PLAN.windowStart),
    windowEnd: clampInt(merged.windowEnd, 0, 24, DEFAULT_POST_PLAN.windowEnd),
    scheduledTimes: times
      .map(item => String(item || '').trim())
      .map(item => {
        const match = item.match(/^(\d{1,2}):(\d{2})$/);
        if (!match) return null;
        const hour = Number(match[1]);
        const minute = Number(match[2]);
        // 光靠正则 \d{1,2} 会放过 "25:00"，必须再校验取值范围
        if (hour > 23 || minute > 59) return null;
        return `${String(hour).padStart(2, '0')}:${match[2]}`;
      })
      .filter(Boolean)
      .slice(0, 20),
    language: LANGUAGE_VALUES.includes(merged.language) ? merged.language : DEFAULT_POST_PLAN.language,
    withImage: IMAGE_MODES.includes(merged.withImage) ? merged.withImage : DEFAULT_POST_PLAN.withImage,
    imageChance: clampNumber(merged.imageChance, 0, 1, DEFAULT_POST_PLAN.imageChance),
    maxWeight: clampInt(merged.maxWeight, 20, 25000, DEFAULT_POST_PLAN.maxWeight),
    items: (Array.isArray(merged.items) ? merged.items : []).slice(-500)
  };
}

const LANGUAGE_VALUES = ['zh', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru', 'ar'];

// 深拷贝：`{...DEFAULT_BEHAVIOR}` 只复制第一层，perAction / engage / commentStyles
// 这些嵌套对象仍和模块常量共享引用。首次安装时 getState() 直接返回 defaultState()，
// 之后任何原地修改（state.postPlan.items.push(...)）都会永久污染 DEFAULT_* 常量，
// 让后续所有新状态都带着被改过的值。这里逐层展开，彻底断开引用。
export function defaultState(now = Date.now()) {
  return {
    behavior: {
      ...DEFAULT_BEHAVIOR,
      activeHours: { ...DEFAULT_BEHAVIOR.activeHours },
      perAction: Object.fromEntries(
        Object.entries(DEFAULT_BEHAVIOR.perAction).map(([action, cap]) => [action, { ...cap }])
      ),
      engage: { ...DEFAULT_BEHAVIOR.engage },
      presetSets: Object.fromEntries(
        Object.entries(DEFAULT_BEHAVIOR.presetSets).map(([name, rhythm]) => [name, pickRhythm(rhythm, name)])
      ),
      commentStyles: [...DEFAULT_BEHAVIOR.commentStyles],
      blacklistUsers: [...DEFAULT_BEHAVIOR.blacklistUsers],
      blacklistWords: [...DEFAULT_BEHAVIOR.blacklistWords]
    },
    stats: createStats(now),
    keywords: [],
    // 逐层展开而不是直接引用：DEFAULT_INTENT_KEYWORDS 是模块常量，
    // 共享引用的话原地改一下就会永久污染后续所有新状态。
    intentKeywords: DEFAULT_INTENT_KEYWORDS.map(item => ({ ...item })),
    intentConfig: { ...DEFAULT_INTENT_CONFIG },
    queue: [],
    current: null,
    nextRunAt: 0,
    keywordIndex: 0,
    seen: {},
    recentComments: [],
    logs: [],
    workerTabId: null,
    lastTickAt: 0,
    lastTickReason: '',
    lastBlockReason: '',
    firstRunAt: now,
    account: null,
    challenge: null,
    postPlan: {
      ...DEFAULT_POST_PLAN,
      scheduledTimes: [...DEFAULT_POST_PLAN.scheduledTimes],
      items: []
    },
    lastPostAt: 0,
    postCountDate: '',
    postCountToday: 0
  };
}

export function normalizeConfig(config = {}) {
  return {
    baseUrl: String(config.baseUrl || '').trim().replace(/\/+$/, ''),
    apiKey: String(config.apiKey || '').trim(),
    imageApiKey: String(config.imageApiKey || '').trim(),
    chatModel: String(config.chatModel || CONFIG_DEFAULTS.chatModel).trim(),
    imageModel: String(config.imageModel || CONFIG_DEFAULTS.imageModel).trim(),
    imageSize: String(config.imageSize || CONFIG_DEFAULTS.imageSize).trim()
  };
}

export function normalizeKeywords(keywords) {
  return normalizeList(keywords).slice(0, 50);
}

// 意向词池：每条带语种和类型，因为玩家词和创作者词的分类规则、私信话术都不同。
export function normalizeIntentKeywords(list) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    // 允许直接塞字符串（老配置 / 手工导入），按默认值补齐
    if (typeof item === 'string') {
      const keyword = item.trim();
      if (keyword) out.push({ keyword, lang: 'EN', type: 'player', enabled: true });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const keyword = String(item.keyword || '').trim();
    if (!keyword) continue;
    out.push({
      keyword,
      lang: String(item.lang || 'EN').trim().toUpperCase().slice(0, 4) || 'EN',
      type: INTENT_TYPES.includes(item.type) ? item.type : 'player',
      enabled: item.enabled !== false
    });
  }
  return out.slice(0, 100);
}

export function normalizeIntentConfig(config = {}) {
  const merged = { ...DEFAULT_INTENT_CONFIG, ...(config || {}) };
  return {
    enabled: !!merged.enabled,
    windowHours: clampInt(merged.windowHours, 1, 720, DEFAULT_INTENT_CONFIG.windowHours),
    paceSec: clampInt(merged.paceSec, 5, 600, DEFAULT_INTENT_CONFIG.paceSec),
    dailyLimit: clampInt(merged.dailyLimit, 0, 500, DEFAULT_INTENT_CONFIG.dailyLimit),
    scrollRounds: clampInt(merged.scrollRounds, 0, 10, DEFAULT_INTENT_CONFIG.scrollRounds),
    aiClassify: merged.aiClassify !== false,
    throttleGuard: merged.throttleGuard !== false
  };
}

export function defaultLeads() {
  return { items: [], lastCollectAt: 0, keywordIndex: 0, collectedToday: 0, countDate: '' };
}

export function normalizeLeads(raw) {
  const base = defaultLeads();
  if (!raw || typeof raw !== 'object') return base;
  return {
    items: (Array.isArray(raw.items) ? raw.items : []).slice(-LEADS_LIMIT),
    lastCollectAt: Number(raw.lastCollectAt) || 0,
    keywordIndex: Number(raw.keywordIndex) || 0,
    collectedToday: Number(raw.collectedToday) || 0,
    countDate: String(raw.countDate || '')
  };
}

// 线索保留 90 天并限制总量：chrome.storage.local 有配额，而且几个月前的线索
// 去私信也已经没有意义了（帖子早沉了）。
export function pruneLeads(items, now = Date.now()) {
  return (items || [])
    .filter(item => item && item.statusHref && now - Number(item.collectedAt || 0) < LEADS_TTL_MS)
    .slice(-LEADS_LIMIT);
}

export function normalizeLead(item = {}) {
  const href = String(item.statusHref || '').trim();
  return {
    id: String(item.id || `lead-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    statusHref: href,
    author: String(item.author || '').replace(/^@/, '').slice(0, 60),
    text: String(item.text || '').slice(0, 1000),
    postedAt: String(item.postedAt || ''),
    keyword: String(item.keyword || ''),
    lang: String(item.lang || ''),
    intentType: INTENT_TYPES.includes(item.intentType) ? item.intentType : 'player',
    confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0)),
    reason: String(item.reason || '').slice(0, 60),
    collectedAt: Number(item.collectedAt) || Date.now(),
    followUp: FOLLOW_UP_STATES.includes(item.followUp) ? item.followUp : 'new',
    note: String(item.note || '').slice(0, 500)
  };
}

export function normalizeBehavior(behavior = {}) {
  const perAction = {};
  for (const [action, defaults] of Object.entries(DEFAULT_BEHAVIOR.perAction)) {
    const incoming = behavior.perAction?.[action] || {};
    perAction[action] = {
      maxPerHour: clampInt(incoming.maxPerHour, 0, 200, defaults.maxPerHour),
      maxPerDay: clampInt(incoming.maxPerDay, 0, 2000, defaults.maxPerDay)
    };
  }

  // 结束时段允许填 24（表示到午夜），开始时段仍是 0-23。
  // 上界都卡在 23 的话，用户填 24 会被夹成 23，若开始也是 23 就变成 {23,23}——
  // 而 start === end 的含义是"全天"，护栏会 fail-open 成 24 小时放行，跟本意相反。
  const start = clampInt(behavior.activeHours?.start, 0, 23, DEFAULT_BEHAVIOR.activeHours.start);
  const end = clampInt(behavior.activeHours?.end, 0, 24, DEFAULT_BEHAVIOR.activeHours.end);

  const normalized = {
    ...DEFAULT_BEHAVIOR,
    ...behavior,
    enabled: !!behavior.enabled,
    dryRun: behavior.dryRun !== false,
    delayMinSec: clampInt(behavior.delayMinSec, 5, 3600, DEFAULT_BEHAVIOR.delayMinSec),
    delayMaxSec: clampInt(behavior.delayMaxSec, 5, 7200, DEFAULT_BEHAVIOR.delayMaxSec),
    maxPerHour: clampInt(behavior.maxPerHour, 0, 200, DEFAULT_BEHAVIOR.maxPerHour),
    maxPerDay: clampInt(behavior.maxPerDay, 0, 2000, DEFAULT_BEHAVIOR.maxPerDay),
    perAction,
    activeHours: { start, end },
    cooldownAfterErrorMin: clampInt(behavior.cooldownAfterErrorMin, 0, 1440, DEFAULT_BEHAVIOR.cooldownAfterErrorMin),
    stopAfterConsecutiveErrors: clampInt(behavior.stopAfterConsecutiveErrors, 1, 20, DEFAULT_BEHAVIOR.stopAfterConsecutiveErrors),
    queueLimit: clampInt(behavior.queueLimit, 1, 200, DEFAULT_BEHAVIOR.queueLimit),
    scanLimit: clampInt(behavior.scanLimit, 1, 50, DEFAULT_BEHAVIOR.scanLimit),
    maxFollowPerScan: clampInt(behavior.maxFollowPerScan, 0, 50, DEFAULT_BEHAVIOR.maxFollowPerScan),
    engage: { ...DEFAULT_BEHAVIOR.engage, ...(behavior.engage || {}) },
    dedicatedTab: behavior.dedicatedTab !== false,
    activateTab: !!behavior.activateTab,
    pauseOnChallenge: behavior.pauseOnChallenge !== false,
    humanize: behavior.humanize !== false,
    humanizeScrollMin: clampInt(behavior.humanizeScrollMin, 0, 20, DEFAULT_BEHAVIOR.humanizeScrollMin),
    humanizeScrollMax: clampInt(behavior.humanizeScrollMax, 0, 30, DEFAULT_BEHAVIOR.humanizeScrollMax),
    humanizePauseMinSec: clampInt(behavior.humanizePauseMinSec, 0, 120, DEFAULT_BEHAVIOR.humanizePauseMinSec),
    humanizePauseMaxSec: clampInt(behavior.humanizePauseMaxSec, 0, 300, DEFAULT_BEHAVIOR.humanizePauseMaxSec),
    browseScrolls: clampInt(behavior.browseScrolls, 1, 30, DEFAULT_BEHAVIOR.browseScrolls),
    commentLanguage: COMMENT_LANGUAGE_VALUES.includes(behavior.commentLanguage)
      ? behavior.commentLanguage
      : DEFAULT_BEHAVIOR.commentLanguage,
    // 用 ?? 而不是 ||：用户主动清空风格时要尊重空数组，只有字段缺失才回落到默认
    commentStyles: normalizeList(behavior.commentStyles ?? DEFAULT_BEHAVIOR.commentStyles).slice(0, 10),
    blacklistUsers: normalizeList(behavior.blacklistUsers).slice(0, 200),
    blacklistWords: normalizeList(behavior.blacklistWords).slice(0, 200)
  };

  // 上下限要保证 min <= max，否则用户填的小值会被静默忽略
  if (normalized.delayMaxSec < normalized.delayMinSec) {
    normalized.delayMaxSec = normalized.delayMinSec;
  }
  if (normalized.humanizeScrollMax < normalized.humanizeScrollMin) {
    normalized.humanizeScrollMax = normalized.humanizeScrollMin;
  }
  if (normalized.humanizePauseMaxSec < normalized.humanizePauseMinSec) {
    normalized.humanizePauseMaxSec = normalized.humanizePauseMinSec;
  }

  // 档位是存储字段：用户选哪档就是哪档，在里面改参数不会掉档。
  // 以前是 detectPreset 拿参数反推出来的，手改任何一项就变成"自定义"，与用户预期不符。
  normalized.preset = PRESET_ORDER.includes(behavior.preset) ? behavior.preset : DEFAULT_PRESET;

  // 每档各自记一套节奏参数。本次提交的扁平字段属于"当前档"，其它档沿用已存下来的那套。
  normalized.presetSets = Object.fromEntries(PRESET_ORDER.map(name => [
    name,
    name === normalized.preset
      ? pickRhythm(normalized, name)
      : pickRhythm(behavior.presetSets?.[name], name)
  ]));

  // 这些功能已移除，顺手丢掉历史配置里可能残留的字段，避免旧值一直挂在存储里。
  // 带图评论（X 风控存疑）、发帖带图（改由发帖计划管理）、先审后发（已整体删除）。
  delete normalized.replyImage;
  delete normalized.replyImageChance;
  delete normalized.postImage;
  delete normalized.postImageChance;
  delete normalized.mode;

  return normalized;
}

// 空值必须先判掉再 Number()：Number('') === 0、Number(null) === 0、
// Number([]) === 0、Number(false) === 0，全都是"有限数"，会绕过 fallback 变成 0。
// 实测踩过：用户把"每小时总上限"输入框清空后保存 → 上限变成 0 →
// canRun 里 `used >= 0` 恒真 → 所有动作被封死，日志一直刷"已达上限 0"。
const isBlank = value => value === '' || value === null || value === undefined
  || value === false || Array.isArray(value);

function clampInt(value, min, max, fallback) {
  if (isBlank(value)) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function clampNumber(value, min, max, fallback) {
  if (isBlank(value)) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function mergeState(raw, now = Date.now()) {
  const base = defaultState(now);
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    ...raw,
    behavior: normalizeBehavior({ ...base.behavior, ...(raw.behavior || {}) }),
    stats: raw.stats ? { ...base.stats, ...raw.stats } : base.stats,
    keywords: normalizeKeywords(raw.keywords),
    // 字段缺失（从旧版本升级上来）才补推荐词；用户主动清空过就是 []，要尊重
    intentKeywords: normalizeIntentKeywords(
      raw.intentKeywords === undefined ? DEFAULT_INTENT_KEYWORDS : raw.intentKeywords
    ),
    intentConfig: normalizeIntentConfig(raw.intentConfig),
    queue: Array.isArray(raw.queue) ? raw.queue : [],
    seen: raw.seen && typeof raw.seen === 'object' ? raw.seen : {},
    recentComments: Array.isArray(raw.recentComments) ? raw.recentComments : [],
    logs: Array.isArray(raw.logs) ? raw.logs : [],
    postPlan: normalizePostPlan(raw.postPlan)
  };
}

export async function getConfig() {
  const stored = await chrome.storage.local.get(CONFIG_KEY);
  return normalizeConfig({ ...CONFIG_DEFAULTS, ...(stored[CONFIG_KEY] || {}) });
}

// 有些中转站文字和生图用不同的 key；生图 key 留空时复用文字 key。
export function pickApiKey(config, purpose = 'chat') {
  if (purpose === 'image') return config?.imageApiKey || config?.apiKey || '';
  return config?.apiKey || '';
}

export async function saveConfig(patch) {
  const next = normalizeConfig({ ...(await getConfig()), ...patch });
  await chrome.storage.local.set({ [CONFIG_KEY]: next });
  return next;
}

export async function getState() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  return mergeState(stored[STATE_KEY]);
}

export async function saveState(state) {
  const next = { ...state, updatedAt: Date.now() };
  await chrome.storage.local.set({ [STATE_KEY]: next });
  return next;
}

// 串行化的读改写，避免 service worker 内部并发写互相覆盖。
let writeChain = Promise.resolve();

export function updateState(mutator) {
  const run = writeChain.then(async () => {
    const state = await getState();
    const result = await mutator(state);
    const next = result || state;
    await saveState(next);
    return next;
  });
  // 链条自身吞掉错误并复位，否则一次失败会让后续所有写入永久 reject；
  // 错误仍然通过 run 抛给调用方。
  writeChain = run.then(() => undefined, () => undefined);
  return run;
}

export async function addLog(level, message, extra = {}) {
  const entry = { at: Date.now(), level, message, ...extra };
  await updateState(state => ({
    ...state,
    logs: [entry, ...state.logs].slice(0, LOG_LIMIT)
  }));
  return entry;
}

// 已处理过的帖子只保留 14 天，且限制总量，避免 storage 无限膨胀。
export function pruneSeen(seen, now = Date.now()) {
  const entries = Object.entries(seen || {})
    .filter(([, at]) => now - Number(at || 0) < SEEN_TTL_MS)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, SEEN_LIMIT);
  return Object.fromEntries(entries);
}

export async function resetQueue() {
  return updateState(state => ({ ...state, queue: [], current: null }));
}

// ---------------------------------------------------------------- 线索持久化
// 单独一个 storage key：xState 里已经有 2000 条日志 + 5000 条 seen，
// 线索量级更大，混进去会让每次状态读写都变慢。

export async function getLeads() {
  const stored = await chrome.storage.local.get(LEADS_KEY);
  return normalizeLeads(stored[LEADS_KEY]);
}

export async function saveLeads(leads) {
  const next = normalizeLeads(leads);
  await chrome.storage.local.set({ [LEADS_KEY]: next });
  return next;
}

// 和 updateState 一样串行化，避免并发读改写互相覆盖
let leadsChain = Promise.resolve();

export function updateLeads(mutator) {
  const run = leadsChain.then(async () => {
    const leads = await getLeads();
    const result = await mutator(leads);
    const next = result || leads;
    await saveLeads(next);
    return next;
  });
  leadsChain = run.then(() => undefined, () => undefined);
  return run;
}

// 按 statusHref 去重后追加。已存在的链接一律不重复登记——
// 重复私信同一个人是 X 判定骚扰的第一信号。
export function mergeLeads(existing, incoming, now = Date.now()) {
  const known = new Set((existing || []).map(item => item.statusHref));
  const added = [];
  for (const item of incoming || []) {
    const lead = normalizeLead({ ...item, collectedAt: item.collectedAt || now });
    if (!lead.statusHref || known.has(lead.statusHref)) continue;
    known.add(lead.statusHref);
    added.push(lead);
  }
  return { added, items: pruneLeads([...(existing || []), ...added], now) };
}

// 解析 AI 返回的意向判定。模型经常不老实：包在 ```json 里、前后加解释、
// 或者干脆返回一段话。这里只认第一个 {...}，解析不出来一律当 none（宁可不采，不可错采）。
export function parseIntentVerdict(raw) {
  const match = String(raw ?? '').match(/\{[\s\S]*\}/);
  if (!match) return { type: 'none', confidence: 0, reason: '' };
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return { type: 'none', confidence: 0, reason: '' };
  }
  return {
    type: parsed.type === 'player' || parsed.type === 'creator' ? parsed.type : 'none',
    confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0)),
    reason: String(parsed.reason || '').slice(0, 40)
  };
}

// 从一次扫描结果里挑出可以登记的新线索。两层去重：帖子地址 + 作者。
// 作者级去重是必须的：实测同一个人一次扫描就能贡献 5 条，列表被刷屏，
// 而且很容易导致重复私信——重复私信是 X 判定骚扰的第一信号。
export function selectNewLeads(results, { knownHrefs = [], knownAuthors = [], cutoff = 0, isBlocked } = {}) {
  const hrefs = new Set(knownHrefs);
  const authors = new Set((knownAuthors || []).filter(Boolean));
  const fresh = [];
  let skippedOld = 0;
  let skippedDupAuthor = 0;

  for (const result of results || []) {
    if (!result?.statusHref || !result.text) continue;
    if (hrefs.has(result.statusHref)) continue;
    const posted = Date.parse(result.postedAt);
    // 没有时间戳的一律当过期处理：Latest 在结果稀少时会退化成全时段召回，
    // 判不了新旧的帖子不该进线索表。
    if (!Number.isFinite(posted) || posted < cutoff) { skippedOld += 1; continue; }
    if (typeof isBlocked === 'function' && isBlocked(result)) continue;
    // 同一次扫描内也要去重，所以命中后立刻登记作者
    if (result.author && authors.has(result.author)) { skippedDupAuthor += 1; continue; }
    if (result.author) authors.add(result.author);
    hrefs.add(result.statusHref);
    fresh.push(result);
  }

  return { fresh, skippedOld, skippedDupAuthor };
}

export function applyLeadPatch(items, id, patch = {}) {
  return (items || []).map(item => {
    if (item.id !== id) return item;
    const next = { ...item };
    if (patch.followUp !== undefined && FOLLOW_UP_STATES.includes(patch.followUp)) next.followUp = patch.followUp;
    if (patch.note !== undefined) next.note = String(patch.note).slice(0, 500);
    return next;
  });
}

// CSV 导出：人工私信时在扩展里一条条点效率太低，必须能拿出去。
// 字段里带引号和换行，所以按 RFC4180 转义，否则 Excel 会错行。
export function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function leadsToCsv(items) {
  const header = ['帖子地址', '作者', '意向类型', '置信度', '发布时间', '命中关键词', '语种', '原文', '跟进状态', '备注', '采集时间'];
  const rows = (items || []).map(item => [
    item.statusHref ? `https://x.com${item.statusHref}` : '',
    item.author ? `@${item.author}` : '',
    INTENT_TYPE_LABELS[item.intentType] || item.intentType,
    Number(item.confidence || 0).toFixed(2),
    item.postedAt || '',
    item.keyword || '',
    item.lang || '',
    item.text || '',
    FOLLOW_UP_LABELS[item.followUp] || item.followUp,
    item.note || '',
    item.collectedAt ? new Date(item.collectedAt).toISOString() : ''
  ]);
  return [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}
