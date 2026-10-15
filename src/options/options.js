import { presetLabel, weightedLength, POST_WEIGHT_LIMIT } from '../lib/guardrails.js';
import { FOLLOW_UP_LABELS, INTENT_TYPE_LABELS } from '../lib/store.js';

const $ = selector => document.querySelector(selector);

const ACTIONS = ['browse', 'like', 'reply', 'follow', 'post'];

let keywords = [];
let blacklistUsers = [];
let blacklistWords = [];
let commentStyles = [];
let intentKeywords = [];
let logPage = 1;
let leadPage = 1;
let planGenMode = 'translate';

document.addEventListener('DOMContentLoaded', init);

async function init() {
  for (const button of document.querySelectorAll('.nav button[data-pane]')) {
    button.addEventListener('click', () => showPane(button.dataset.pane));
  }

  $('#saveConfig').addEventListener('click', saveConfig);
  $('#testConfig').addEventListener('click', testConfig);
  $('#saveBehavior').addEventListener('click', saveBehavior);
  $('#saveAdvanced').addEventListener('click', saveBehavior);
  $('#resetBehavior').addEventListener('click', resetBehavior);
  $('#clearCooldown').addEventListener('click', clearCooldown);
  $('#clearSeen').addEventListener('click', clearSeen);
  $('#addKeyword').addEventListener('click', () => addToList('keywordInput', keywords, saveKeywords));
  $('#addUser').addEventListener('click', () => addToList('userInput', blacklistUsers, saveBlacklist));
  $('#addWord').addEventListener('click', () => addToList('wordInput', blacklistWords, saveBlacklist));
  $('#addStyle').addEventListener('click', () => addToList('styleInput', commentStyles, saveBehavior));

  // 意向线索
  $('#addIntentKeyword').addEventListener('click', addIntentKeyword);
  $('#fillRecommended').addEventListener('click', fillRecommended);
  $('#intentKeywordInput').addEventListener('keydown', event => {
    if (event.key === 'Enter') addIntentKeyword();
  });
  $('#saveIntentConfig').addEventListener('click', saveIntentConfig);
  $('#collectNow').addEventListener('click', collectNow);
  $('#exportLeads').addEventListener('click', exportLeads);
  $('#clearLeads').addEventListener('click', clearLeads);
  $('#leadApply').addEventListener('click', () => { leadPage = 1; loadLeads(); });
  $('#leadReset').addEventListener('click', () => {
    $('#leadFilterType').value = '';
    $('#leadFilterStatus').value = '';
    $('#leadSearch').value = '';
    leadPage = 1;
    loadLeads();
  });
  $('#leadRefresh').addEventListener('click', () => loadLeads());
  $('#leadPrev').addEventListener('click', () => { if (leadPage > 1) { leadPage -= 1; loadLeads(); } });
  $('#leadNext').addEventListener('click', () => { leadPage += 1; loadLeads(); });
  $('#leadSearch').addEventListener('keydown', event => {
    if (event.key === 'Enter') { leadPage = 1; loadLeads(); }
  });

  for (const button of document.querySelectorAll('#presetSeg button')) {
    button.addEventListener('click', () => switchPreset(button.dataset.preset));
  }
  $('#resetPreset').addEventListener('click', resetPreset);

  // 发帖计划
  $('#savePlan').addEventListener('click', savePlan);
  $('#generatePlan').addEventListener('click', generatePlan);
  $('#clearPlan').addEventListener('click', clearPlanItems);
  for (const button of document.querySelectorAll('#planGenMode button')) {
    button.addEventListener('click', () => setPlanGenMode(button.dataset.mode));
  }
  $('#planSources').addEventListener('input', updatePlanPreview);
  $('#planMaxWeight').addEventListener('input', updatePlanPreview);

  // 日志
  $('#logApply').addEventListener('click', () => { logPage = 1; loadLogs(); });
  $('#logReset').addEventListener('click', () => {
    $('#logAction').value = '';
    $('#logResult').value = '';
    $('#logLevel').value = '';
    $('#logSearch').value = '';
    logPage = 1;
    loadLogs();
  });
  $('#logRefresh').addEventListener('click', () => loadLogs());
  $('#logPrev').addEventListener('click', () => { if (logPage > 1) { logPage -= 1; loadLogs(); } });
  $('#logNext').addEventListener('click', () => { logPage += 1; loadLogs(); });
  $('#logSearch').addEventListener('keydown', event => {
    if (event.key === 'Enter') { logPage = 1; loadLogs(); }
  });

  await load();
}

function showPane(name) {
  for (const button of document.querySelectorAll('.nav button[data-pane]')) {
    button.classList.toggle('on', button.dataset.pane === name);
  }
  for (const pane of document.querySelectorAll('.pane[data-pane]')) {
    pane.hidden = pane.dataset.pane !== name;
  }
  if (name === 'logs') loadLogs();
  if (name === 'intent') loadLeads();
}

// chrome.runtime.sendMessage 在后台崩溃、扩展刚重载、或 SW 没响应时会 reject。
// 不接住的话调用方会抛未捕获异常，界面什么都不显示——用户看到的就是"点了没反应"。
// 统一转成 { ok: false, error }，走正常的错误提示路径。
async function send(message) {
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (!response) return { ok: false, error: '后台没有响应，请重新加载扩展' };
    return response;
  } catch (error) {
    return { ok: false, error: `后台没有响应：${error?.message || error}` };
  }
}

// ------------------------------------------------------------------ 档位

// 切档：后台把目标档存下来的那套参数加载成当前生效参数，然后整表回填。
async function switchPreset(name) {
  const response = await send({ type: 'SET_PRESET', preset: name });
  if (!response.ok) return setStatus(response.error, 'err');
  fillBehavior(response.state.behavior);
  renderPreset(response.state.behavior);
  setStatus(`已切到「${presetLabel(response.state.behavior.preset)}」档`, 'ok');
}

// 把当前档的参数还原成该档内置默认值（其它档不动）
async function resetPreset() {
  const response = await send({ type: 'RESET_PRESET' });
  if (!response.ok) return setStatus(response.error, 'err');
  fillBehavior(response.state.behavior);
  renderPreset(response.state.behavior);
  setStatus(`「${presetLabel(response.state.behavior.preset)}」档参数已恢复默认`, 'ok');
}

// 档位是存下来的，不是拿参数反推的：改参数不会掉档，只有点档位按钮才换档。
function renderPreset(behavior) {
  const current = behavior.preset;

  for (const button of document.querySelectorAll('#presetSeg button')) {
    button.classList.toggle('on', button.dataset.preset === current);
  }

  // 显示当前档实际生效的参数（用户可能改过），而不是内置默认值
  const rhythm = behavior.presetSets?.[current] || behavior;
  const hours = Number(rhythm.activeHours?.start) === Number(rhythm.activeHours?.end)
    ? '全天'
    : `${rhythm.activeHours.start}-${rhythm.activeHours.end} 点`;

  $('#presetHint').textContent = [
    `${presetLabel(current)}档：动作间隔 ${rhythm.delayMinSec}–${rhythm.delayMaxSec} 秒`,
    `总上限 ${rhythm.maxPerHour}/时 · ${rhythm.maxPerDay}/日`,
    `活跃时段 ${hours}`,
    `浏览 ${rhythm.perAction.browse.maxPerHour}/时`,
    `点赞 ${rhythm.perAction.like.maxPerHour}/时`,
    `评论 ${rhythm.perAction.reply.maxPerHour}/时`,
    `关注 ${rhythm.perAction.follow.maxPerHour}/时`
  ].join(' · ');
}

// ------------------------------------------------------------------ 读写

async function load() {
  const response = await send({ type: 'GET_ALL' });
  if (!response?.ok) return setStatus(response?.error || '读取配置失败', 'err');

  fillConfig(response.config);
  fillBehavior(response.state.behavior);
  fillPlan(response.state.postPlan);

  keywords = response.state.keywords || [];
  blacklistUsers = response.state.behavior.blacklistUsers || [];
  blacklistWords = response.state.behavior.blacklistWords || [];
  commentStyles = response.state.behavior.commentStyles || [];
  intentKeywords = response.state.intentKeywords || [];

  fillIntentConfig(response.state.intentConfig || {});
  // AI 没配却开着分类，会让每条帖子都分类失败、全部按关键词硬归类——
  // 必须在界面上说清楚，否则用户只会觉得"这功能捞出来全是噪音"。
  renderIntentAiHint(response.config, response.state.intentConfig || {});

  renderChips('#keywordChips', keywords, index => { keywords.splice(index, 1); saveKeywords(); });
  renderChips('#userChips', blacklistUsers, index => { blacklistUsers.splice(index, 1); saveBlacklist(); });
  renderChips('#wordChips', blacklistWords, index => { blacklistWords.splice(index, 1); saveBlacklist(); });
  renderChips('#styleChips', commentStyles, index => { commentStyles.splice(index, 1); saveBehavior(); });
  renderIntentKeywords();

  renderPreset(response.state.behavior);
  renderPlanItems(response.state.postPlan);
  setPlanGenMode(planGenMode);
  updatePlanPreview();
  setStatus('就绪');
}

function fillConfig(config) {
  $('#baseUrl').value = config.baseUrl || '';
  $('#apiKey').value = config.apiKey || '';
  $('#imageApiKey').value = config.imageApiKey || '';
  $('#chatModel').value = config.chatModel || 'gpt-4o-mini';
  $('#imageModel').value = config.imageModel || 'gpt-image-1';
  $('#imageSize').value = config.imageSize || '1024x1024';
}

function fillBehavior(behavior) {
  $('#delayMinSec').value = behavior.delayMinSec;
  $('#delayMaxSec').value = behavior.delayMaxSec;
  $('#maxPerHour').value = behavior.maxPerHour;
  $('#maxPerDay').value = behavior.maxPerDay;
  $('#activeStart').value = behavior.activeHours.start;
  $('#activeEnd').value = behavior.activeHours.end;

  for (const action of ACTIONS) {
    const cap = behavior.perAction[action];
    $(`#${action}Hour`).value = cap.maxPerHour;
    $(`#${action}Day`).value = cap.maxPerDay;
  }

  $('#engageBrowse').checked = !!behavior.engage.browse;
  $('#engageLike').checked = !!behavior.engage.like;
  $('#engageReply').checked = !!behavior.engage.reply;
  $('#engageFollow').checked = !!behavior.engage.follow;
  $('#engagePost').checked = !!behavior.engage.post;

  $('#commentLanguage').value = behavior.commentLanguage || 'match';

  $('#pauseOnChallenge').checked = behavior.pauseOnChallenge !== false;
  $('#humanize').checked = behavior.humanize !== false;
  $('#humanizeScrollMin').value = behavior.humanizeScrollMin;
  $('#humanizeScrollMax').value = behavior.humanizeScrollMax;
  $('#humanizePauseMinSec').value = behavior.humanizePauseMinSec;
  $('#humanizePauseMaxSec').value = behavior.humanizePauseMaxSec;
  $('#browseScrolls').value = behavior.browseScrolls;

  $('#dedicatedTab').checked = behavior.dedicatedTab !== false;
  $('#activateTab').checked = !!behavior.activateTab;

  $('#queueLimit').value = behavior.queueLimit;
  $('#scanLimit').value = behavior.scanLimit;
  $('#maxFollowPerScan').value = behavior.maxFollowPerScan;
  $('#cooldownAfterErrorMin').value = behavior.cooldownAfterErrorMin;
  $('#stopAfterConsecutiveErrors').value = behavior.stopAfterConsecutiveErrors;
}

function readConfig() {
  return {
    baseUrl: $('#baseUrl').value,
    apiKey: $('#apiKey').value,
    imageApiKey: $('#imageApiKey').value,
    chatModel: $('#chatModel').value,
    imageModel: $('#imageModel').value,
    imageSize: $('#imageSize').value
  };
}

function readBehavior() {
  const number = selector => Number($(selector).value);
  const perAction = {};
  for (const action of ACTIONS) {
    perAction[action] = { maxPerHour: number(`#${action}Hour`), maxPerDay: number(`#${action}Day`) };
  }
  return {
    delayMinSec: number('#delayMinSec'),
    delayMaxSec: number('#delayMaxSec'),
    maxPerHour: number('#maxPerHour'),
    maxPerDay: number('#maxPerDay'),
    activeHours: { start: number('#activeStart'), end: number('#activeEnd') },
    perAction,
    engage: {
      browse: $('#engageBrowse').checked,
      like: $('#engageLike').checked,
      reply: $('#engageReply').checked,
      follow: $('#engageFollow').checked,
      post: $('#engagePost').checked
    },
    commentLanguage: $('#commentLanguage').value,
    commentStyles,
    pauseOnChallenge: $('#pauseOnChallenge').checked,
    humanize: $('#humanize').checked,
    humanizeScrollMin: number('#humanizeScrollMin'),
    humanizeScrollMax: number('#humanizeScrollMax'),
    humanizePauseMinSec: number('#humanizePauseMinSec'),
    humanizePauseMaxSec: number('#humanizePauseMaxSec'),
    browseScrolls: number('#browseScrolls'),
    dedicatedTab: $('#dedicatedTab').checked,
    activateTab: $('#activateTab').checked,
    queueLimit: number('#queueLimit'),
    scanLimit: number('#scanLimit'),
    maxFollowPerScan: number('#maxFollowPerScan'),
    cooldownAfterErrorMin: number('#cooldownAfterErrorMin'),
    stopAfterConsecutiveErrors: number('#stopAfterConsecutiveErrors')
  };
}

// ------------------------------------------------------------------ 保存

async function saveConfig() {
  const response = await send({ type: 'SAVE_CONFIG', config: readConfig() });
  if (response.ok) renderIntentAiHint(readConfig(), { aiClassify: $('#intentAiClassify').checked });
  setStatus(response.ok ? '接口配置已保存' : response.error, response.ok ? 'ok' : 'err');
}

async function testConfig() {
  setStatus('测试中…');
  const response = await send({
    type: 'AI_CHAT',
    options: readConfig(),
    messages: [{ role: 'user', content: '只回复两个字：可用' }]
  });
  if (!response.ok) return setStatus(response.error, 'err');
  setStatus(`连接正常：${String(response.text).trim().slice(0, 20)}`, 'ok');
}

async function saveBehavior() {
  const response = await send({ type: 'SAVE_BEHAVIOR', behavior: readBehavior() });
  if (!response.ok) return setStatus(response.error, 'err');
  fillBehavior(response.state.behavior);
  commentStyles = response.state.behavior.commentStyles || [];
  renderChips('#styleChips', commentStyles, index => { commentStyles.splice(index, 1); saveBehavior(); });
  renderPreset(response.state.behavior);
  setStatus(`已保存到「${presetLabel(response.state.behavior.preset)}」档`, 'ok');
}

async function clearCooldown() {
  const response = await send({ type: 'CLEAR_COOLDOWN' });
  if (!response.ok) return setStatus(response.error, 'err');
  setStatus('冷却已清除，调度器可以立刻继续', 'ok');
}

async function clearSeen() {
  const response = await send({ type: 'CLEAR_SEEN' });
  if (!response.ok) return setStatus(response.error, 'err');
  setStatus('已清除已处理记录，同样的帖子可以重新入队', 'ok');
}

async function resetBehavior() {
  if (!window.confirm('恢复默认会把所有节奏/护栏参数还原（总开关会关闭、演练模式会打开），关键词、黑名单和发帖计划不受影响。继续？')) return;
  const response = await send({ type: 'RESET_BEHAVIOR' });
  if (!response.ok) return setStatus(response.error, 'err');
  fillBehavior(response.state.behavior);
  renderPreset(response.state.behavior);
  setStatus('已恢复默认', 'ok');
}

async function saveKeywords() {
  const response = await send({ type: 'SAVE_KEYWORDS', keywords });
  if (!response.ok) return setStatus(response.error, 'err');
  keywords = response.state.keywords;
  renderChips('#keywordChips', keywords, index => { keywords.splice(index, 1); saveKeywords(); });
  setStatus('关键词已保存', 'ok');
}

async function saveBlacklist() {
  const response = await send({ type: 'SAVE_BEHAVIOR', behavior: { blacklistUsers, blacklistWords } });
  if (!response.ok) return setStatus(response.error, 'err');
  setStatus('黑名单已保存', 'ok');
}

// ------------------------------------------------------------------ 发帖计划

function fillPlan(plan) {
  $('#planEnabled').checked = !!plan.enabled;
  $('#planLanguage').value = plan.language;
  $('#planDailyLimit').value = plan.dailyLimit;
  $('#planMaxWeight').value = plan.maxWeight;
  $('#planWindowStart').value = plan.windowStart;
  $('#planWindowEnd').value = plan.windowEnd;
  $('#planWithImage').value = plan.withImage;
  $('#planImageChance').value = plan.imageChance;
  $('#planTimes').value = (plan.scheduledTimes || []).join('\n');
}

function readPlan() {
  return {
    enabled: $('#planEnabled').checked,
    language: $('#planLanguage').value,
    dailyLimit: Number($('#planDailyLimit').value),
    maxWeight: Number($('#planMaxWeight').value),
    windowStart: Number($('#planWindowStart').value),
    windowEnd: Number($('#planWindowEnd').value),
    withImage: $('#planWithImage').value,
    imageChance: Number($('#planImageChance').value),
    scheduledTimes: $('#planTimes').value.split('\n').map(line => line.trim()).filter(Boolean)
  };
}

async function savePlan() {
  const response = await send({ type: 'SAVE_POST_PLAN', plan: readPlan() });
  if (!response.ok) return setStatus(response.error, 'err');
  fillPlan(response.state.postPlan);
  setStatus('发帖计划已保存', 'ok');
}

function setPlanGenMode(mode) {
  planGenMode = mode === 'topics' ? 'topics' : 'translate';
  for (const button of document.querySelectorAll('#planGenMode button')) {
    button.classList.toggle('on', button.dataset.mode === planGenMode);
  }
  $('#planTranslateBlock').hidden = planGenMode !== 'translate';
  $('#planTopicBlock').hidden = planGenMode !== 'topics';
  updatePlanPreview();
}

// 让用户直接看到"这条会不会超字数"
function updatePlanPreview() {
  const limit = Number($('#planMaxWeight').value) || POST_WEIGHT_LIMIT;
  if (planGenMode !== 'translate') {
    $('#planGenStatus').textContent = `按主题生成。加权字数上限 ${limit}（中文/日文/韩文 1 字 = 2 单位）。`;
    return;
  }
  const lines = $('#planSources').value.split('\n').map(line => line.trim()).filter(Boolean);
  if (!lines.length) {
    $('#planGenStatus').textContent = `每行一条文案。加权字数上限 ${limit}（中文 1 字 = 2 单位，未开会员 X 上限是 280）。`;
    return;
  }
  const over = lines.filter(line => weightedLength(line) > limit);
  $('#planGenStatus').textContent = over.length
    ? `${lines.length} 条待生成；其中 ${over.length} 条原文本身就超过 ${limit} 加权单位，翻译时会被压缩。`
    : `${lines.length} 条待生成，加权字数上限 ${limit}。`;
}

async function generatePlan() {
  const plan = readPlan();
  $('#generatePlan').disabled = true;
  $('#planGenStatus').textContent = '正在调用中转站生成…（条数越多越慢，请勿关闭页面）';

  try {
    const payload = planGenMode === 'translate'
      ? { mode: 'translate', sources: $('#planSources').value.split('\n').map(line => line.trim()).filter(Boolean), language: plan.language }
      : { mode: 'topics', topic: $('#planTopic').value.trim(), count: Number($('#planCount').value) || 5, language: plan.language };

    const response = await send({ type: 'GENERATE_POSTS', ...payload });
    if (!response.ok) {
      $('#planGenStatus').textContent = '生成失败：' + response.error;
      return;
    }
    renderPlanItems(response.state.postPlan);
    $('#planGenStatus').textContent = `已生成 ${response.created} 条，见下方待发列表。`;
    setStatus(`批量生成完成（${response.created} 条）`, 'ok');
  } finally {
    $('#generatePlan').disabled = false;
  }
}

async function clearPlanItems() {
  if (!window.confirm('清空所有待发条目？已发布的记录也会一起清掉。')) return;
  const response = await send({ type: 'CLEAR_POST_ITEMS' });
  if (!response.ok) return setStatus(response.error, 'err');
  renderPlanItems(response.state.postPlan);
  setStatus('待发列表已清空', 'ok');
}

async function deletePlanItem(id) {
  const response = await send({ type: 'DELETE_POST_ITEM', id });
  if (!response.ok) return setStatus(response.error, 'err');
  renderPlanItems(response.state.postPlan);
}

function renderPlanItems(plan) {
  const container = $('#planItems');
  container.replaceChildren();
  const items = [...(plan.items || [])].reverse();

  const pending = items.filter(item => item.status === 'pending').length;
  $('#planCountLabel').textContent = `（待发 ${pending} · 共 ${items.length}）`;

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'log-empty';
    empty.textContent = '还没有条目，先用上面的「批量生成」造几条。';
    container.append(empty);
    return;
  }

  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'plan-item';

    const head = document.createElement('div');
    head.className = 'plan-head';
    const title = document.createElement('b');
    title.textContent = `${item.language} · ${item.weight || weightedLength(item.text)}/${plan.maxWeight}`;
    const pill = document.createElement('span');
    const status = item.status === 'published' ? 'published' : item.status === 'failed' ? 'failed' : 'pending';
    pill.className = `pill ${status}`;
    pill.textContent = item.status === 'published' ? '已发布' : item.status === 'failed' ? '失败' : '待发';
    head.append(title, pill);

    const text = document.createElement('div');
    text.className = 'plan-text';
    text.textContent = item.text;

    const meta = document.createElement('div');
    meta.className = 'plan-meta';
    meta.append(document.createTextNode(`原文：${(item.source || '').slice(0, 60)}`));
    if (item.status === 'published' && item.statusHref) {
      const link = document.createElement('a');
      link.href = `https://x.com${item.statusHref}`;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = ' 查看帖子';
      meta.append(link);
    }
    if (item.status === 'failed' && item.error) {
      meta.append(document.createTextNode(` · 失败：${item.error}`));
    }

    const del = document.createElement('button');
    del.className = 'act secondary';
    del.style.marginTop = '8px';
    del.textContent = '删除';
    del.addEventListener('click', () => deletePlanItem(item.id));

    card.append(head, text, meta, del);
    container.append(card);
  }
}

// ------------------------------------------------------------------ 日志

async function loadLogs() {
  const response = await send({
    type: 'GET_LOGS',
    page: logPage,
    pageSize: 20,
    action: $('#logAction').value,
    result: $('#logResult').value,
    level: $('#logLevel').value,
    search: $('#logSearch').value.trim()
  });
  if (!response.ok) return setStatus(response.error, 'err');

  logPage = response.page;
  $('#logSummary').textContent = `共 ${response.total} 条，第 ${response.page} / ${response.pageCount} 页`;
  $('#logPageInfo').textContent = `${response.page} / ${response.pageCount}`;
  $('#logPrev').disabled = response.page <= 1;
  $('#logNext').disabled = response.page >= response.pageCount;

  const container = $('#logList');
  container.replaceChildren();

  if (!response.entries.length) {
    const empty = document.createElement('div');
    empty.className = 'log-empty';
    empty.textContent = '没有符合条件的记录。';
    container.append(empty);
    return;
  }

  for (const entry of response.entries) {
    const row = document.createElement('div');
    row.className = `log-row ${entry.level || 'info'}`;

    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = new Date(entry.at).toLocaleString('zh-CN', {
      hour12: false, month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    const tag = document.createElement('span');
    tag.className = 'log-tag';
    tag.textContent = `[${entry.tag || '调度'}]`;

    const msg = document.createElement('span');
    msg.className = 'log-msg';
    msg.append(document.createTextNode(entry.message || ''));
    if (entry.author) msg.append(document.createTextNode(` · @${entry.author}`));
    if (entry.statusHref) {
      const link = document.createElement('a');
      link.href = `https://x.com${entry.statusHref}`;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = '帖子';
      msg.append(document.createTextNode(' · '));
      msg.append(link);
    }

    row.append(time, tag, msg);
    container.append(row);
  }
}

// ------------------------------------------------------------------ 意向线索

function fillIntentConfig(config) {
  $('#intentEnabled').checked = !!config.enabled;
  $('#intentWindowHours').value = config.windowHours ?? 72;
  $('#intentPaceSec').value = config.paceSec ?? 25;
  $('#intentDailyLimit').value = config.dailyLimit ?? 40;
  $('#intentScrollRounds').value = config.scrollRounds ?? 3;
  $('#intentAiClassify').checked = config.aiClassify !== false;
  $('#intentThrottleGuard').checked = config.throttleGuard !== false;
}

function renderIntentAiHint(config, intentConfig) {
  const hint = $('#intentAiHint');
  const needsAi = intentConfig?.aiClassify !== false;
  const missing = !config?.baseUrl || !config?.apiKey;
  if (needsAi && missing) {
    hint.hidden = false;
    hint.textContent = 'AI 分类开着，但「AI 接口」里还没填中转站地址或 API Key。'
      + '这样每条帖子都会分类失败，全部按关键词预设类型登记（置信度 0.40），列表会塞满噪音——'
      + '尤其是「ゲーム おすすめ教えて」这种量大精度低的词。先去「AI 接口」配好再采集。';
  } else {
    hint.hidden = true;
  }
}

function readIntentConfig() {
  const number = selector => Number($(selector).value);
  return {
    enabled: $('#intentEnabled').checked,
    windowHours: number('#intentWindowHours'),
    paceSec: number('#intentPaceSec'),
    dailyLimit: number('#intentDailyLimit'),
    scrollRounds: number('#intentScrollRounds'),
    aiClassify: $('#intentAiClassify').checked,
    throttleGuard: $('#intentThrottleGuard').checked
  };
}

async function saveIntentConfig() {
  const response = await send({ type: 'SAVE_INTENT_CONFIG', config: readIntentConfig() });
  if (!response.ok) return setStatus(response.error, 'err');
  fillIntentConfig(response.state.intentConfig);
  renderIntentAiHint(readConfig(), response.state.intentConfig);
  setStatus(response.state.intentConfig.enabled ? '采集设置已保存，采集已启动' : '采集设置已保存（当前是关闭状态）', 'ok');
}

function addIntentKeyword() {
  const input = $('#intentKeywordInput');
  const keyword = input.value.trim();
  if (!keyword) return;
  if (intentKeywords.some(item => item.keyword === keyword)) {
    return setStatus('这个词已经在词池里了', 'err');
  }
  intentKeywords.push({
    keyword,
    lang: $('#intentLangSelect').value,
    type: $('#intentTypeSelect').value,
    enabled: true
  });
  input.value = '';
  saveIntentKeywords();
}

// 一键补入实测推荐词：只加缺的，不动已经改过的
async function fillRecommended() {
  const response = await send({ type: 'ADD_RECOMMENDED_KEYWORDS' });
  if (!response.ok) return setStatus(response.error, 'err');
  intentKeywords = response.state.intentKeywords || [];
  renderIntentKeywords();
  setStatus(response.added ? `已补入 ${response.added} 个推荐词` : '推荐词都已经在词池里了', 'ok');
}

async function saveIntentKeywords() {
  const response = await send({ type: 'SAVE_INTENT_KEYWORDS', keywords: intentKeywords });
  if (!response.ok) return setStatus(response.error, 'err');
  intentKeywords = response.state.intentKeywords;
  renderIntentKeywords();
  setStatus(`意向词池已保存（${intentKeywords.length} 个词）`, 'ok');
}

function renderIntentKeywords() {
  const container = $('#intentKeywordList');
  container.replaceChildren();

  if (!intentKeywords.length) {
    const empty = document.createElement('span');
    empty.className = 'log-empty';
    empty.style.padding = '10px';
    empty.textContent = '还没有意向关键词，上面有实测有效的词可以直接抄。';
    container.append(empty);
    return;
  }

  intentKeywords.forEach((item, index) => {
    const chip = document.createElement('span');
    chip.className = `intent-kw${item.enabled === false ? ' off' : ''}`;

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = item.enabled !== false;
    toggle.title = '启用 / 停用';
    toggle.addEventListener('change', () => {
      intentKeywords[index].enabled = toggle.checked;
      saveIntentKeywords();
    });

    const label = document.createElement('span');
    label.textContent = item.keyword;

    const tag = document.createElement('span');
    tag.className = `tag ${item.type}`;
    tag.textContent = `${item.lang} · ${INTENT_TYPE_LABELS[item.type] || item.type}`;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.addEventListener('click', () => { intentKeywords.splice(index, 1); saveIntentKeywords(); });

    chip.append(toggle, label, tag, remove);
    container.append(chip);
  });
}

function leadQuery() {
  return {
    page: leadPage,
    pageSize: 20,
    intentType: $('#leadFilterType').value,
    followUp: $('#leadFilterStatus').value,
    search: $('#leadSearch').value.trim()
  };
}

async function collectNow() {
  $('#collectNow').disabled = true;
  setStatus('正在采集一轮…（要导航搜索页并调用 AI 分类，可能需要十几秒）');
  try {
    const response = await send({ type: 'COLLECT_NOW', ...leadQuery() });
    if (!response.ok) return setStatus(response.error, 'err');
    if (response.leads) renderLeads(response.leads);
    if (response.result?.throttled) return setStatus('这一轮被判定为搜索限流，已自动延后重试', 'err');
    if (response.result?.capped) return setStatus('今日线索已达上限', 'err');
    setStatus(`采集完成：扫到 ${response.result?.scanned ?? 0} 条，新增线索 ${response.result?.added ?? 0} 条`, 'ok');
  } finally {
    $('#collectNow').disabled = false;
  }
}

async function loadLeads() {
  const response = await send({ type: 'GET_LEADS', ...leadQuery() });
  if (!response.ok) return setStatus(response.error, 'err');
  renderLeads(response.leads);
}

function renderLeads(leads) {
  leadPage = leads.page;
  const last = leads.lastCollectAt
    ? new Date(leads.lastCollectAt).toLocaleString('zh-CN', { hour12: false })
    : '从未';
  $('#leadSummary').textContent = `（共 ${leads.totalLeads} 条 · 未处理 ${leads.pendingLeads} 条 · 今日新增 ${leads.collectedToday} · 上次采集 ${last}）`;
  $('#leadPageInfo').textContent = `${leads.page} / ${leads.pageCount}`;
  $('#leadPrev').disabled = leads.page <= 1;
  $('#leadNext').disabled = leads.page >= leads.pageCount;

  const container = $('#leadList');
  container.replaceChildren();

  if (!leads.entries.length) {
    const empty = document.createElement('div');
    empty.className = 'log-empty';
    empty.textContent = leads.totalLeads
      ? '没有符合筛选条件的线索。'
      : '还没有线索。先在上面配置意向词池，然后点「立即采集一轮」。';
    container.append(empty);
    return;
  }

  for (const lead of leads.entries) container.append(renderLeadCard(lead));
}

function renderLeadCard(lead) {
  const card = document.createElement('div');
  card.className = 'lead-card';

  const head = document.createElement('div');
  head.className = 'lead-head';

  const who = document.createElement('span');
  who.className = 'lead-who';
  const profile = document.createElement('a');
  profile.href = `https://x.com/${lead.author}`;
  profile.target = '_blank';
  profile.rel = 'noreferrer';
  profile.textContent = `@${lead.author || '未知'}`;
  who.append(profile);

  const pill = document.createElement('span');
  pill.className = `pill ${lead.intentType === 'creator' ? 'pending' : 'published'}`;
  pill.textContent = `${INTENT_TYPE_LABELS[lead.intentType] || lead.intentType} · ${Number(lead.confidence || 0).toFixed(2)}`;
  head.append(who, pill);

  const text = document.createElement('div');
  text.className = 'lead-text';
  text.textContent = lead.text;

  const meta = document.createElement('div');
  meta.className = 'lead-meta';
  const posted = lead.postedAt
    ? new Date(lead.postedAt).toLocaleString('zh-CN', { hour12: false })
    : '时间未知';
  meta.append(document.createTextNode(`发布 ${posted}`));
  meta.append(document.createTextNode(`· 关键词「${lead.keyword}」`));
  if (lead.reason) meta.append(document.createTextNode(`· ${lead.reason}`));
  const link = document.createElement('a');
  link.href = `https://x.com${lead.statusHref}`;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = '打开帖子';
  meta.append(link);

  const actions = document.createElement('div');
  actions.className = 'lead-actions';

  // 跟进状态是这份列表最重要的字段：没有它第二天就分不清哪条已经私信过，
  // 重复私信同一个人是 X 判定骚扰的第一信号。
  const status = document.createElement('select');
  for (const value of Object.keys(FOLLOW_UP_LABELS)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = FOLLOW_UP_LABELS[value];
    option.selected = value === lead.followUp;
    status.append(option);
  }
  status.addEventListener('change', () => updateLead(lead.id, { followUp: status.value }));

  const note = document.createElement('input');
  note.placeholder = '备注（例如：已私信，等回复）';
  note.value = lead.note || '';
  note.addEventListener('change', () => updateLead(lead.id, { note: note.value }));

  const del = document.createElement('button');
  del.type = 'button';
  del.textContent = '删除';
  del.addEventListener('click', () => deleteLead(lead.id));

  actions.append(status, note, del);
  card.append(head, text, meta, actions);
  return card;
}

async function updateLead(id, patch) {
  const response = await send({ type: 'UPDATE_LEAD', id, patch, ...leadQuery() });
  if (!response.ok) return setStatus(response.error, 'err');
  renderLeads(response.leads);
  setStatus('已更新跟进状态', 'ok');
}

async function deleteLead(id) {
  const response = await send({ type: 'DELETE_LEAD', id, ...leadQuery() });
  if (!response.ok) return setStatus(response.error, 'err');
  renderLeads(response.leads);
}

async function clearLeads() {
  if (!window.confirm('清空所有线索？\n\n会一起清掉：已登记的去重记录（同样的帖子/作者会被重新采集）、今日采集计数（归零，可以继续采）。')) return;
  const response = await send({ type: 'CLEAR_LEADS', page: 1, pageSize: 20 });
  if (!response.ok) return setStatus(response.error, 'err');
  leadPage = 1;
  renderLeads(response.leads);
  setStatus('线索已清空', 'ok');
}

async function exportLeads() {
  const response = await send({ type: 'EXPORT_LEADS' });
  if (!response.ok) return setStatus(response.error, 'err');
  if (!response.count) return setStatus('还没有线索可导出', 'err');
  // BOM 让 Excel 正确识别 UTF-8，否则中日文会乱码
  const blob = new Blob([`\ufeff${response.csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `x-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  setStatus(`已导出 ${response.count} 条线索`, 'ok');
}

// ------------------------------------------------------------------ 小组件

function addToList(inputId, list, persist) {
  const input = $(`#${inputId}`);
  const value = input.value.trim().replace(/^@/, '');
  if (!value) return;
  if (!list.includes(value)) list.push(value);
  input.value = '';
  persist();
}

function renderChips(selector, list, onRemove) {
  const container = $(selector);
  container.replaceChildren();
  list.forEach((value, index) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const label = document.createElement('span');
    label.textContent = value;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.addEventListener('click', () => onRemove(index));
    chip.append(label, remove);
    container.append(chip);
  });
}

function setStatus(message, tone = '') {
  const element = $('#status');
  element.className = tone;
  element.textContent = message;
}
