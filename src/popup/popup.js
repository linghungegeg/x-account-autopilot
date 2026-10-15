const $ = selector => document.querySelector(selector);

const TYPE_LABELS = { browse: '浏览', like: '点赞', reply: '评论', follow: '关注', post: '发帖' };
const STATUS_LABELS = {
  pending: '待执行',
  running: '执行中',
  done: '已完成',
  failed: '失败'
};

let pollTimer = null;
let busy = false;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bind('#enabled', 'change', () => toggleEnabled($('#enabled').checked));
  bind('#dryRun', 'change', () => saveBehavior({ dryRun: $('#dryRun').checked }));
  bind('#runNow', 'click', runNow);
  bind('#scanNow', 'click', scanNow);
  bind('#clearQueue', 'click', clearQueue);
  bind('#openPanel', 'click', openPanel);
  bind('#openOptions', 'click', () => chrome.runtime.openOptionsPage());

  await refresh();
  // 主动问一次 X 页面：后台只有在跑任务时才会缓存账号信息，
  // 不主动问的话弹窗会一直显示"未连接 X 页面"。
  send({ type: 'X_GET_STATE' })
    .then(response => { if (response?.ok) refresh(); })
    .catch(() => {});

  pollTimer = setInterval(() => { if (!busy) refresh(); }, 1500);
  window.addEventListener('unload', () => clearInterval(pollTimer));
}

function bind(selector, event, handler) {
  $(selector).addEventListener(event, async () => {
    busy = true;
    try {
      await handler();
    } catch (error) {
      showStatus(error?.message || String(error), 'error');
    } finally {
      busy = false;
      await refresh();
    }
  });
}

// 同 options.js：sendMessage 在后台崩溃或扩展重载后会 reject，
// 统一转成 { ok: false, error } 让调用方走正常的错误提示。
async function send(message) {
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (!response) return { ok: false, error: '后台没有响应，请重新加载扩展' };
    return response;
  } catch (error) {
    return { ok: false, error: `后台没有响应：${error?.message || error}` };
  }
}

// ------------------------------------------------------------------ 操作

async function toggleEnabled(enabled) {
  const response = await send({ type: 'SET_ENABLED', enabled });
  if (!response.ok) return showStatus(response.error, 'error');
  showStatus(enabled ? '已启动' : '已暂停');
}

async function saveBehavior(patch) {
  const response = await send({ type: 'SAVE_BEHAVIOR', behavior: patch });
  if (!response.ok) return showStatus(response.error, 'error');
  if (patch.dryRun !== undefined) showStatus(patch.dryRun ? '演练模式已开启，不会真实提交' : '演练模式已关闭，动作会真实生效');
}

async function runNow() {
  const response = await send({ type: 'RUN_NOW' });
  if (!response.ok) return showStatus(response.error, 'error');
  showStatus('已触发一次执行，请看下方日志');
}

async function scanNow() {
  showStatus('正在扫描关键词搜索页…');
  const response = await send({ type: 'SCAN_NOW' });
  if (!response.ok) return showStatus(response.error, 'error');
  showStatus('扫描完成，已按需补充队列');
}

async function clearQueue() {
  const response = await send({ type: 'CLEAR_QUEUE' });
  if (!response.ok) return showStatus(response.error, 'error');
  showStatus('队列已清空');
}

async function openPanel() {
  const response = await send({ type: 'OPEN_PANEL' });
  if (!response.ok) return showStatus(response.error, 'error');
  showStatus('已在 X 页面右侧展开控制台');
}

async function removeTask(id) {
  const response = await send({ type: 'REMOVE_TASK', id });
  if (!response.ok) return showStatus(response.error, 'error');
  showStatus('已移除该任务');
}

// ------------------------------------------------------------------ 渲染

async function refresh() {
  let response;
  try {
    response = await send({ type: 'GET_ALL' });
  } catch {
    return showStatus('后台未响应，请重新加载扩展', 'error');
  }
  if (!response?.ok) return showStatus(response?.error || '读取状态失败', 'error');

  render(response.state);
}

function render(state) {
  const behavior = state.behavior || {};

  $('#enabled').checked = !!behavior.enabled;
  $('#dryRun').checked = behavior.dryRun !== false;

  renderAccount(state);
  renderStatus(state);
  renderTask(state);
  renderStats(state);
  renderQueue(state);
  renderLogs(state);
}

function renderAccount(state) {
  const account = state.account;
  const avatar = $('#acctAvatar');

  // 没有头像时清掉 src，让 CSS 的渐变圆形当占位符
  if (account?.avatar) avatar.src = account.avatar;
  else avatar.removeAttribute('src');

  if (account?.handle) {
    $('#acctName').textContent = account.name || `@${account.handle}`;
    $('#acctHandle').textContent = `@${account.handle}`;
    $('#acctDays').textContent = `已养 ${state.raiseDays || 1} 天`;
    return;
  }

  $('#acctName').textContent = '未连接 X 页面';
  $('#acctHandle').textContent = '请先打开并登录 x.com';
  $('#acctDays').textContent = '—';
}

function renderStatus(state) {
  const behavior = state.behavior || {};
  const preset = state.presetLabel || '未知';

  if (state.challenge) {
    return showStatus(`已被风控停机：${state.challenge.reason}。请手动确认账号状态后再打开总开关`, 'error');
  }
  if (!behavior.enabled) return showStatus(`总开关已关闭（${preset}档），不会自动执行任何动作`, 'warn');
  if (state.blockReason) return showStatus(`已暂停：${state.blockReason}`, 'warn');
  if (state.current) return showStatus(`正在${state.current.label}…`);

  const seconds = Math.round((state.nextRunInMs || 0) / 1000);
  const when = seconds > 0 ? `下一次动作约 ${seconds} 秒后` : '随时可以执行下一条';
  const dry = behavior.dryRun ? ' · 演练模式' : '';
  showStatus(`运行中（${preset}档${dry}），${when}`);
}

function renderTask(state) {
  const box = $('#taskBox');
  if (!state.current) {
    box.hidden = true;
    return;
  }
  const progress = Math.max(0, Math.min(100, Number(state.current.progress) || 0));
  box.hidden = false;
  $('#taskLabel').textContent = state.current.label || '执行中';
  $('#taskBar').style.width = `${progress}%`;
  $('#taskStage').textContent = state.current.stage || '执行中';
  $('#taskPercent').textContent = `${progress}%`;
}

function renderStats(state) {
  const byAction = state.stats?.byAction || {};
  const today = action => byAction[action]?.day || 0;
  $('#statBrowse').textContent = today('browse');
  $('#statLike').textContent = today('like');
  $('#statReply').textContent = today('reply');
  $('#statFollow').textContent = today('follow');
}

function renderQueue(state) {
  const container = $('#queueList');
  const all = state.queue || [];
  $('#pendingCount').textContent = state.pendingCount || 0;

  const tasks = all
    .slice(-6)
    .reverse();
  container.replaceChildren();

  if (!tasks.length) {
    container.append(empty('队列为空，等调度器扫描关键词后自动补充'));
    return;
  }

  for (const task of tasks) {
    const item = document.createElement('div');
    item.className = 'item';

    const head = document.createElement('div');
    head.className = 'item-head';
    const title = document.createElement('b');
    title.textContent = `${TYPE_LABELS[task.type] || task.type} · ${task.payload?.author ? `@${task.payload.author}` : task.payload?.keyword || task.payload?.topic || ''}`;
    const status = document.createElement('span');
    status.textContent = STATUS_LABELS[task.status] || task.status;
    head.append(title, status);

    const text = document.createElement('div');
    text.className = 'item-text';
    text.textContent = task.status === 'failed' && task.result
      ? `失败：${task.result}`
      : (task.payload?.comment || task.payload?.sourceText || task.payload?.text || '').slice(0, 120);

    item.append(head, text);

    if (task.status === 'failed' || task.status === 'pending') {
      const actions = document.createElement('div');
      actions.className = 'item-actions';
      const remove = document.createElement('button');
      remove.className = 'tiny secondary';
      remove.textContent = '移除';
      remove.addEventListener('click', () => removeTask(task.id));
      actions.append(remove);
      item.append(actions);
    }

    container.append(item);
  }
}

function renderLogs(state) {
  const container = $('#logs');
  const logs = (state.logs || []).slice(0, 8);
  container.replaceChildren();

  if (!logs.length) {
    container.append(empty('暂无日志'));
    return;
  }

  for (const entry of logs) {
    const row = document.createElement('div');
    row.className = `log ${entry.level || 'info'}`;
    const time = document.createElement('i');
    time.textContent = new Date(entry.at).toLocaleTimeString('zh-CN', { hour12: false });
    const tag = document.createElement('u');
    tag.textContent = `[${entry.tag || '调度'}]`;
    const text = document.createElement('em');
    text.textContent = entry.message;
    row.append(time, tag, text);
    container.append(row);
  }
}

function empty(text) {
  const node = document.createElement('div');
  node.className = 'empty';
  node.textContent = text;
  return node;
}

function showStatus(message, tone = '') {
  const element = $('#status');
  element.className = `status${tone ? ` ${tone}` : ''}`;
  element.textContent = message;
}
