// 日志筛选与分页：纯函数，不依赖 chrome API，可在 Node 下直接单测。

export const LOG_PAGE_SIZE = 20;

export function filterLogs(logs, { action = '', result = '', level = '', search = '' } = {}) {
  const keyword = String(search || '').trim().toLowerCase();
  return (logs || []).filter(entry => {
    if (action && entry.action !== action) return false;
    if (result && entryResult(entry) !== result) return false;
    if (level && entry.level !== level) return false;
    if (keyword) {
      const haystack = `${entry.message || ''} ${entry.author || ''} ${entry.statusHref || ''}`.toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });
}

// 只有任务类日志才有 result 字段（ok/failed）。调度、扫描、队列这些日志没有，
// 但它们里也有 error 级别的（比如"调度出错"）。
// 以前统一按 'ok' 兜底，导致按"失败"筛选时这些错误日志全被过滤掉——
// 而用户查问题恰恰要看它们。所以没有 result 时按 level 推断。
function entryResult(entry) {
  if (entry.result) return entry.result;
  return entry.level === 'error' ? 'failed' : 'ok';
}

export function paginateLogs(logs, { page = 1, pageSize = LOG_PAGE_SIZE, ...filters } = {}) {
  const filtered = filterLogs(logs, filters);
  const size = Math.max(1, Math.min(100, Number(pageSize) || LOG_PAGE_SIZE));
  const pageCount = Math.max(1, Math.ceil(filtered.length / size));
  const current = Math.max(1, Math.min(pageCount, Number(page) || 1));
  return {
    total: filtered.length,
    page: current,
    pageCount,
    pageSize: size,
    entries: filtered.slice((current - 1) * size, current * size)
  };
}
