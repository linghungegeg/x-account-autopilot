// 护栏核心：纯函数，不依赖 chrome API，可在 Node 下直接单测。
// 所有"该不该动手"的判断都收敛在这里，调度器只负责执行。

const PAD = value => String(value).padStart(2, '0');

export const ACTIONS = ['browse', 'like', 'reply', 'follow', 'post'];

export const ACTION_LABELS = {
  browse: '浏览',
  like: '点赞',
  reply: '评论',
  follow: '关注',
  post: '发帖'
};

// 浏览是纯滚动、不产生内容的动作，优先级最低、额度最大
export const ACTION_ICONS = {
  browse: '👁',
  like: '❤️',
  reply: '💬',
  follow: '➕',
  post: '🖼'
};

export const PRESET_ORDER = ['conservative', 'balanced', 'aggressive'];

// 三档预设只覆盖"节奏类"参数；冷却、队列长度、黑名单、工作标签页等与档位无关，保持独立配置。
export const PRESETS = {
  conservative: {
    label: '保守',
    delayMinSec: 180,
    delayMaxSec: 480,
    maxPerHour: 4,
    maxPerDay: 20,
    perAction: {
      browse: { maxPerHour: 8, maxPerDay: 40 },
      like: { maxPerHour: 4, maxPerDay: 15 },
      reply: { maxPerHour: 1, maxPerDay: 6 },
      follow: { maxPerHour: 2, maxPerDay: 10 },
      post: { maxPerHour: 0, maxPerDay: 0 }
    },
    activeHours: { start: 0, end: 0 },
    scanLimit: 5,
    maxFollowPerScan: 1
  },
  balanced: {
    label: '均衡',
    delayMinSec: 60,
    delayMaxSec: 240,
    maxPerHour: 10,
    maxPerDay: 60,
    perAction: {
      browse: { maxPerHour: 15, maxPerDay: 80 },
      like: { maxPerHour: 10, maxPerDay: 60 },
      reply: { maxPerHour: 4, maxPerDay: 20 },
      follow: { maxPerHour: 6, maxPerDay: 30 },
      post: { maxPerHour: 1, maxPerDay: 4 }
    },
    activeHours: { start: 0, end: 0 },
    scanLimit: 12,
    maxFollowPerScan: 2
  },
  aggressive: {
    label: '激进',
    delayMinSec: 30,
    delayMaxSec: 120,
    maxPerHour: 20,
    maxPerDay: 150,
    perAction: {
      browse: { maxPerHour: 30, maxPerDay: 200 },
      like: { maxPerHour: 20, maxPerDay: 120 },
      reply: { maxPerHour: 8, maxPerDay: 50 },
      follow: { maxPerHour: 12, maxPerDay: 80 },
      post: { maxPerHour: 2, maxPerDay: 8 }
    },
    activeHours: { start: 0, end: 0 },
    scanLimit: 20,
    maxFollowPerScan: 4
  }
};

export const DEFAULT_PRESET = 'balanced';

const balanced = PRESETS[DEFAULT_PRESET];

export const DEFAULT_BEHAVIOR = {
  enabled: false,          // 总开关，默认关：装完不会自己动
  dryRun: true,            // 演练模式，默认开：走完全流程但不真的点提交
  // 当前档位。这是存储字段：用户选哪档就是哪档，在里面改参数不会掉档。
  preset: DEFAULT_PRESET,
  // 每档各自记一套节奏参数。初始值就是 PRESETS 里那三套默认值；
  // 在某一档里改参数只写回那一档，切档时把对应那一套加载成当前生效参数。
  presetSets: Object.fromEntries(PRESET_ORDER.map(name => [name, pickRhythm(PRESETS[name], name)])),
  delayMinSec: balanced.delayMinSec,
  delayMaxSec: balanced.delayMaxSec,
  maxPerHour: balanced.maxPerHour,
  maxPerDay: balanced.maxPerDay,
  // 必须深拷贝：直接写 `perAction: balanced.perAction` 会让 DEFAULT_BEHAVIOR
  // 和 PRESETS.balanced 共享同一个对象，改任何一个都会污染另一个。
  perAction: Object.fromEntries(
    Object.entries(balanced.perAction).map(([action, cap]) => [action, { ...cap }])
  ),
  activeHours: { ...balanced.activeHours },
  scanLimit: balanced.scanLimit,
  maxFollowPerScan: balanced.maxFollowPerScan,
  // 以下参数与档位无关
  cooldownAfterErrorMin: 30,
  stopAfterConsecutiveErrors: 3,
  queueLimit: 30,

  // 风控自保
  pauseOnChallenge: true,   // 检测到验证码/账号受限立即停机

  // 拟人化
  humanize: true,           // 动作之间插入随机滚动/停顿
  // 后台标签页里 setTimeout 被节流，拟人化是动作耗时的大头。
  // 实测 2-8 秒的停顿在节流下能跑到 92 秒，把动作总时长顶过超时。
  // 1-4 秒已经足够"不像机器"，内容脚本里另有 45 秒总预算兜底。
  humanizeScrollMin: 2,
  humanizeScrollMax: 5,
  humanizePauseMinSec: 1,
  humanizePauseMaxSec: 4,
  browseScrolls: 3,

  // 评论语言：match = 跟随原帖语言；其它值 = 强制指定语言
  commentLanguage: 'match',

  // 评论风格
  commentStyles: ['真诚互动', '提问式', '简短共鸣'],

  engage: { browse: true, like: true, reply: true, follow: true, post: false },
  dedicatedTab: true,
  activateTab: false,
  blacklistUsers: [],
  blacklistWords: []
};

export const IMAGE_MODES = ['off', 'sometimes', 'always'];

export const IMAGE_MODE_LABELS = {
  off: '关闭',
  sometimes: '按概率',
  always: '总是'
};

// 评论语言：match = 跟随原帖；其余为强制指定
export const COMMENT_LANGUAGES = [
  { value: 'match', label: '跟随原帖语言' },
  { value: 'zh', label: '强制中文' },
  { value: 'en', label: '强制英文' },
  { value: 'ja', label: '强制日文' },
  { value: 'ko', label: '强制韩文' },
  { value: 'es', label: '强制西班牙文' }
];

export const LANGUAGE_LABELS = {
  zh: '中文', en: '英文', ja: '日文', ko: '韩文', es: '西班牙文',
  fr: '法文', de: '德文', pt: '葡萄牙文', ru: '俄文', ar: '阿拉伯文'
};

// ---------------------------------------------------------------- 加权字数
//
// X 的字数不是按字符数算的，规则来自 twitter-text 的 weightedLength 配置：
//   defaultWeight = 2，只有下面 4 个区间是 1。
// 也就是说"绝大多数非拉丁字符都算 2"——CJK、emoji、箭头、各种符号、国旗全在内。
//
// 之前这里写反了（默认 1 + 手列 emoji 区间），结果漏掉一大片：
// 🚀 U+1F680 / → U+2192 / ☀ U+2600 / ⭐ U+2B50 / ❤ U+2764 / 🫠 U+1FAE0
// 全被算成 1，导致 a*279 + 🚀 被判成 280"可发"，而 X 实际算 281 直接拒收。
// 20 个抽样字符里错了 15 个。改成"默认 2 + 列出 1"就不会再漏。
//
// 实测校准（probe/probe-weight-and-defaults.mjs）：
//   279 个 a   → "1 character remaining"
//   281 个 a   → "exceeded by 1"
//   139 个 中  → "2 characters remaining"
//   140 个 中  → "0 characters remaining"
//   141 个 中  → "exceeded by 2"
export const POST_WEIGHT_LIMIT = 280;

// twitter-text 里 weight=1 的全部区间（十进制 4351/8205/8223/8247）
const WEIGHT_1_RANGES = [
  [0x0000, 0x10ff],   // 基本拉丁、拉丁扩展、希腊、西里尔……
  [0x2000, 0x200d],   // 通用标点的一部分
  [0x2010, 0x201f],   // 连字符、引号
  [0x2032, 0x2037]    // 角分符、插入符
];

// X 会把任意链接按 23 个字符计（twitter-text 的 transformedURLLength）
const URL_PATTERN = /https?:\/\/[^\s\u3000]+/g;
const URL_WEIGHT = 23;
// 链接末尾常紧跟标点（"看这个 https://x.com。"），那些标点不属于链接，
// 不能一起替换成 23 个占位符，否则会漏算它们的权重。
const URL_TRAILING_PUNCT = /[.,;:!?、。，；：！？）】」』"')\]}>]+$/;

export function weightedLength(text) {
  const source = String(text || '');
  // 先把链接换成 23 个占位字符再逐字符算，否则长链接会被高估、短链接会被低估
  const normalized = source.replace(URL_PATTERN, match => {
    const url = match.replace(URL_TRAILING_PUNCT, '');
    const trailing = match.slice(url.length);
    return 'x'.repeat(URL_WEIGHT) + trailing;
  });

  let total = 0;
  for (const char of normalized) {
    const code = char.codePointAt(0);
    total += WEIGHT_1_RANGES.some(([low, high]) => code >= low && code <= high) ? 1 : 2;
  }
  return total;
}

export function fitsWeightLimit(text, limit = POST_WEIGHT_LIMIT) {
  return weightedLength(text) <= limit;
}

// ---------------------------------------------------------------- 任务优先级
//
// 发帖排最前：计划帖是定时的，被普通互动任务饿死就失去意义了。
// 实测踩过这个坑——队列里 14 个互动任务排在前面，到点的计划帖一直没轮到。
// 浏览排最后：它是纯滚动的填充动作，不该跟真正的互动抢位置。
export const TASK_ORDER = { post: 0, reply: 1, like: 2, follow: 3, browse: 4 };

export function pickNextTask(queue) {
  const pending = (queue || []).filter(task => task.status === 'pending');
  if (!pending.length) return null;
  return [...pending].sort((a, b) =>
    (TASK_ORDER[a.type] ?? 9) - (TASK_ORDER[b.type] ?? 9) || (a.createdAt || 0) - (b.createdAt || 0)
  )[0];
}

// ---------------------------------------------------------------- 发帖计划

// 现在是不是该发计划里的帖子。纯函数，便于单测。
//
// 发布时机由"有没有指定时间点"决定，不再单独设一个模式开关：
//   指定了时间点  → 按指定时间点发（到点后 15 分钟内都算该发）
//   没指定时间点  → 在设定的时间段内随机发
export function postPlanDue(plan, state, now = Date.now()) {
  if (!plan?.enabled) return false;
  if (!(plan.items || []).some(item => item.status === 'pending')) return false;

  const today = new Date(now).toDateString();
  const usedToday = state?.postCountDate === today ? (state.postCountToday || 0) : 0;
  if (usedToday >= Number(plan.dailyLimit)) return false;

  const lastPostAt = state?.lastPostAt || 0;
  const times = (plan.scheduledTimes || []).filter(Boolean);

  if (times.length) {
    // 不用"精确匹配某一分钟"：tick 每分钟才跑一次，SW 还可能休眠，
    // 精确匹配会整点跳过。改成到点后 15 分钟内都算该发，且这段时间还没发过。
    const graceMs = 15 * 60 * 1000;
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    return times.some(hhmm => {
      const [h, m] = String(hhmm).split(':').map(Number);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return false;
      const at = dayStart.getTime() + h * 3600000 + m * 60000;
      return now >= at && now - at < graceMs && lastPostAt < at;
    });
  }

  // 没指定时间点：在时间段内随机发，且距上次发帖超过最小间隔
  const hour = new Date(now).getHours();
  const start = Number(plan.windowStart);
  const end = Number(plan.windowEnd);
  const inWindow = start === end
    ? true
    : (start < end ? hour >= start && hour < end : hour >= start || hour < end);
  if (!inWindow) return false;

  const dailyLimit = Math.max(1, Number(plan.dailyLimit) || 1);
  const minGapMs = Math.max(30 * 60 * 1000, Math.floor((24 * 60 * 60 * 1000) / dailyLimit));
  return now - lastPostAt >= minGapMs;
}

export const COMMENT_STYLE_SUGGESTIONS = ['真诚互动', '提问式', '简短共鸣', '专业补充', '轻松调侃', '经验分享'];

// 抽出一档的节奏参数（深拷贝）。source 里缺失或非法的字段回落到该档内置默认值。
// 与档位无关的参数（冷却、队列长度、黑名单、工作标签页等）不在这里，保持独立配置。
export function pickRhythm(source, name = DEFAULT_PRESET) {
  const fallback = PRESETS[name] || PRESETS[DEFAULT_PRESET];
  const num = (value, def) => {
    if (value === undefined || value === null || value === '') return def;
    const number = Number(value);
    return Number.isFinite(number) ? number : def;
  };

  const perAction = {};
  for (const action of ACTIONS) {
    const cap = source?.perAction?.[action] || {};
    const def = fallback.perAction[action];
    perAction[action] = {
      maxPerHour: num(cap.maxPerHour, def.maxPerHour),
      maxPerDay: num(cap.maxPerDay, def.maxPerDay)
    };
  }

  return {
    delayMinSec: num(source?.delayMinSec, fallback.delayMinSec),
    delayMaxSec: num(source?.delayMaxSec, fallback.delayMaxSec),
    maxPerHour: num(source?.maxPerHour, fallback.maxPerHour),
    maxPerDay: num(source?.maxPerDay, fallback.maxPerDay),
    perAction,
    activeHours: {
      start: num(source?.activeHours?.start, fallback.activeHours.start),
      end: num(source?.activeHours?.end, fallback.activeHours.end)
    },
    scanLimit: num(source?.scanLimit, fallback.scanLimit),
    maxFollowPerScan: num(source?.maxFollowPerScan, fallback.maxFollowPerScan)
  };
}

// 返回档位对应的那一套内置默认节奏参数
export function presetValues(name) {
  const key = PRESETS[name] ? name : DEFAULT_PRESET;
  return { preset: key, ...pickRhythm(PRESETS[key], key) };
}

export function presetLabel(name) {
  return PRESETS[name]?.label || PRESETS[DEFAULT_PRESET].label;
}

export function zeroByAction() {
  const out = {};
  for (const action of ACTIONS) out[action] = { hour: 0, day: 0 };
  return out;
}

export function localDateKey(now = Date.now()) {
  const date = new Date(now);
  return `${date.getFullYear()}-${PAD(date.getMonth() + 1)}-${PAD(date.getDate())}`;
}

export function localHourKey(now = Date.now()) {
  const date = new Date(now);
  return `${localDateKey(now)}T${PAD(date.getHours())}`;
}

export function createStats(now = Date.now()) {
  return {
    dateKey: localDateKey(now),
    hourKey: localHourKey(now),
    byAction: zeroByAction(),
    consecutiveErrors: 0,
    cooldownUntil: 0,
    lastActionAt: 0,
    lastError: '',
    lastErrorAt: 0
  };
}

// 跨天清日计数，跨小时清小时计数。防御性地补齐缺失字段。
export function rollStats(stats, now = Date.now()) {
  const base = stats && typeof stats === 'object' ? stats : createStats(now);
  const byAction = { ...zeroByAction(), ...(base.byAction || {}) };
  for (const action of ACTIONS) {
    byAction[action] = { hour: 0, day: 0, ...(byAction[action] || {}) };
  }

  const dateKey = localDateKey(now);
  const hourKey = localHourKey(now);
  const next = { ...createStats(now), ...base, byAction, dateKey, hourKey };

  if (base.dateKey !== dateKey) {
    next.byAction = zeroByAction();
  } else if (base.hourKey !== hourKey) {
    for (const action of ACTIONS) {
      next.byAction[action] = { ...next.byAction[action], hour: 0 };
    }
  }
  return next;
}

export function totalCount(stats) {
  const source = (stats && stats.byAction) || {};
  // 必须 Number()：storage 里如果存的是字符串（旧版本、手工改、外部写入），
  // 直接相加会变成字符串拼接（'3' + '3' = '33'），上限判断永远不触发。
  return ACTIONS.reduce(
    (acc, action) => ({
      hour: acc.hour + (Number(source[action]?.hour) || 0),
      day: acc.day + (Number(source[action]?.day) || 0)
    }),
    { hour: 0, day: 0 }
  );
}

// 支持跨午夜时段，例如 22:00 - 06:00
export function isWithinActiveHours(now = Date.now(), activeHours = DEFAULT_BEHAVIOR.activeHours) {
  const start = Number(activeHours?.start);
  const end = Number(activeHours?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return true;
  if (start === end) return true;
  const hour = new Date(now).getHours();
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

export function randomDelayMs(behavior = DEFAULT_BEHAVIOR, random = Math.random) {
  const min = Math.max(1, Number(behavior.delayMinSec) || 1);
  const max = Math.max(min, Number(behavior.delayMaxSec) || min);
  return Math.round((min + random() * (max - min)) * 1000);
}

function block(reason) {
  return { allowed: false, reason };
}

// 返回 { allowed, reason }。action 传 null 表示只做全局检查。
export function canRun({ behavior = DEFAULT_BEHAVIOR, stats, action = null, now = Date.now() }) {
  const rolled = rollStats(stats, now);

  if (!behavior.enabled) return block('总开关已关闭');
  if (rolled.cooldownUntil > now) {
    const minutes = Math.ceil((rolled.cooldownUntil - now) / 60000);
    return block(`连续失败进入冷却，${minutes} 分钟后恢复`);
  }
  if (!isWithinActiveHours(now, behavior.activeHours)) {
    return block(`不在活跃时段（${behavior.activeHours.start}:00 - ${behavior.activeHours.end}:00）`);
  }

  const total = totalCount(rolled);
  if (total.hour >= Number(behavior.maxPerHour)) {
    return block(`本小时总动作已达上限 ${behavior.maxPerHour}`);
  }
  if (total.day >= Number(behavior.maxPerDay)) {
    return block(`今日总动作已达上限 ${behavior.maxPerDay}`);
  }

  if (action) {
    const cap = behavior.perAction?.[action];
    const used = rolled.byAction[action] || { hour: 0, day: 0 };
    const label = ACTION_LABELS[action] || action;
    if (cap) {
      // 上限为 0 表示"这类动作已关闭"。直接报"已达上限 0"用户看不懂，
      // 会以为是 bug（保守档预设的 post 就是 0，计划帖会一直被挡）。
      if (Number(cap.maxPerHour) <= 0 || Number(cap.maxPerDay) <= 0) {
        return block(`${label}已在行为参数里关闭（上限为 0）`);
      }
      if (used.hour >= Number(cap.maxPerHour)) return block(`${label}本小时已达上限 ${cap.maxPerHour}`);
      if (used.day >= Number(cap.maxPerDay)) return block(`${label}今日已达上限 ${cap.maxPerDay}`);
    }
  }

  return { allowed: true, reason: '' };
}

export function recordAction(stats, action, now = Date.now()) {
  const next = rollStats(stats, now);
  const current = next.byAction[action] || { hour: 0, day: 0 };
  return {
    ...next,
    // 同样要 Number()：字符串计数 + 1 会变成拼接（'3' + 1 = '31'）
    byAction: {
      ...next.byAction,
      [action]: { hour: (Number(current.hour) || 0) + 1, day: (Number(current.day) || 0) + 1 }
    },
    lastActionAt: now,
    consecutiveErrors: 0
  };
}

export function recordError(stats, behavior = DEFAULT_BEHAVIOR, now = Date.now(), message = '') {
  const next = rollStats(stats, now);
  const threshold = Math.max(1, Number(behavior.stopAfterConsecutiveErrors) || 3);
  const cooldownMinutes = Math.max(0, Number(behavior.cooldownAfterErrorMin) || 0);
  const consecutiveErrors = (Number(next.consecutiveErrors) || 0) + 1;
  const tripped = consecutiveErrors >= threshold;
  return {
    ...next,
    consecutiveErrors: tripped ? 0 : consecutiveErrors,
    cooldownUntil: tripped && cooldownMinutes > 0 ? now + cooldownMinutes * 60000 : next.cooldownUntil || 0,
    lastError: String(message || '').slice(0, 200),
    lastErrorAt: now
  };
}

export function recordSuccess(stats) {
  return { ...stats, consecutiveErrors: 0 };
}

// 纯 ASCII 的词按"词边界"匹配。直接 includes 的话，屏蔽词 `AI` 会命中
// said / email / wait / again，把大量正常帖子误杀。
// 中日韩没有词边界概念，仍然用子串匹配。
function matchesBlacklistWord(haystack, word) {
  if (!word) return false;
  if (/^[\x00-\x7f]+$/.test(word)) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`, 'i').test(haystack);
  }
  return haystack.includes(word);
}

export function matchBlacklist(behavior = DEFAULT_BEHAVIOR, { author = '', text = '' } = {}) {
  const users = normalizeList(behavior.blacklistUsers).map(user => user.replace(/^@/, '').toLowerCase());
  const words = normalizeList(behavior.blacklistWords).map(word => word.toLowerCase());
  const handle = String(author).replace(/^@/, '').trim().toLowerCase();

  if (handle && users.includes(handle)) return `作者 @${handle} 在黑名单`;
  const haystack = String(text || '').toLowerCase();
  const hit = words.find(word => matchesBlacklistWord(haystack, word));
  if (hit) return `内容命中黑名单词「${hit}」`;
  return '';
}

export function normalizeList(list) {
  return [...new Set((Array.isArray(list) ? list : [])
    .map(item => String(item ?? '').trim())
    .filter(Boolean))];
}

export function describeCaps(behavior = DEFAULT_BEHAVIOR) {
  return ACTIONS.map(action => {
    const cap = behavior.perAction?.[action] || { maxPerHour: 0, maxPerDay: 0 };
    return `${ACTION_LABELS[action]} ${cap.maxPerHour}/时 ${cap.maxPerDay}/日`;
  }).join(' · ');
}
