// 为什么计划没触发？读全部相关字段。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(2500);

const info = await page.eval(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    enabled: r.state.behavior.enabled,
    dryRun: r.state.behavior.dryRun,
    current: r.state.current,
    challenge: r.state.challenge,
    nextRunAt: r.state.nextRunAt,
    nextRunInMs: r.state.nextRunInMs,
    lastTickAt: r.state.lastTickAt,
    lastTickReason: r.state.lastTickReason,
    lastBlockReason: r.state.lastBlockReason,
    lastPostAt: r.state.lastPostAt,
    postCountDate: r.state.postCountDate,
    postCountToday: r.state.postCountToday,
    plan: {
      enabled: r.state.postPlan.enabled,
      scheduledTimes: r.state.postPlan.scheduledTimes,
      windowStart: r.state.postPlan.windowStart,
      windowEnd: r.state.postPlan.windowEnd,
      dailyLimit: r.state.postPlan.dailyLimit,
      withImage: r.state.postPlan.withImage,
      pending: r.state.postPlan.items.filter(i => i.status === 'pending').length,
      statuses: r.state.postPlan.items.map(i => i.status)
    },
    now: Date.now(),
    nowLocal: new Date().toLocaleString('zh-CN', { hour12: false }),
    logs: r.state.logs.slice(0, 8).map(l => new Date(l.at).toLocaleTimeString('zh-CN',{hour12:false}) + ' ' + l.tag + ' | ' + l.message.slice(0, 70))
  }, null, 2))
`);
console.log(info);

process.exit(0);
