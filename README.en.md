<div align="center">

<p><a href="README.md">简体中文</a> | <strong>English</strong></p>

<p><strong>Full-quality GPT and full-capability Claude API access:</strong> <a href="https://www.1openai.icu/">https://www.1openai.icu/</a><br>High quality, no watered-down models, and great value. You're welcome to try it and put it to the test.</p>

<h1>X Nurture Helper</h1>

<p><strong>An AI-powered browser extension for fully automated X (Twitter) account activity and content publishing</strong></p>
<p>Automated search · Browsing · Likes · AI replies · Follows · Scheduled image posts · Lead collection</p>

<p>
  <img src="https://img.shields.io/badge/version-0.6.1-1d9bf0?style=flat-square" alt="Version 0.6.1">
  <img src="https://img.shields.io/badge/Chrome-Manifest_V3-4285F4?style=flat-square&amp;logo=googlechrome&amp;logoColor=white" alt="Chrome Manifest V3">
  <img src="https://img.shields.io/badge/JavaScript-ES_Modules-F7DF1E?style=flat-square&amp;logo=javascript&amp;logoColor=black" alt="JavaScript ES Modules">
  <img src="https://img.shields.io/badge/AI-OpenAI_Compatible-10a37f?style=flat-square" alt="OpenAI-compatible API">
  <img src="https://img.shields.io/badge/runtime_dependencies-0-22c55e?style=flat-square" alt="Zero third-party runtime dependencies">
</p>

<p><a href="dist/x-nurture-helper-0.6.1.zip"><strong>Download extension ZIP (v0.6.1)</strong></a> · <a href="#quick-start">Quick start</a> · <a href="#screenshots">Screenshots</a> · <a href="#tech-stack">Tech stack</a> · <a href="#community-and-support">Community and support</a></p>

</div>

## Overview

X Nurture Helper is a Chrome Manifest V3 extension that runs in your browser. Configure your keywords, AI endpoint, and activity limits, and it will search, filter results, queue tasks, generate content, perform interactions, and check results on pages where you are already signed in to X.

**Full automation is the core feature: once enabled, the scheduler continuously handles browsing, likes, AI replies, follows, and posting without requiring confirmation for each task.** Choose which actions to enable, or run only content publishing or lead collection.

The extension uses your existing browser session and operates through the page DOM. No backend deployment or X developer API key is required. AI replies, translation, content generation, and image generation use the OpenAI-compatible endpoint you configure.

> On first install, the main switch is off and dry-run mode is on. Real interactions begin only after you finish configuration and explicitly enable them. Keep your browser running and your X account signed in.

## Features

| Feature | Description |
| --- | --- |
| Fully automated interactions | Rotate through keywords, search recent posts, and queue browsing, likes, replies, and follows |
| AI-generated replies | Generate replies based on the original post, match its language by default, or choose a language and writing style |
| Automated content publishing | Generate posts in batches from a topic, or translate and polish existing copy into a publishing queue |
| Scheduled and randomized posting | Schedule `HH:MM` time slots, or publish at intervals within a chosen time window |
| AI-generated images | Disable images, attach them probabilistically, or always request them; image failures are logged and fall back to text-only posts |
| Lead collection | Filter by intent keywords, post age, and AI classification; track follow-up status, add notes, and export CSV |
| Three activity presets | Conservative, Balanced, and Aggressive, each with saved settings for delays, total quotas, and per-action quotas |
| Random scrolling and pauses | Insert configurable scrolling and pauses between actions |
| Automatic pause on account challenges | Pause when verification flows, CAPTCHAs, or account restrictions are detected, then log the reason and send a notification |
| Live status and logs | Extension popup, in-page console, task progress, daily statistics, categorized logs, and post links |
| Deduplication and blocklists | Skip processed posts, check reply similarity, and filter blocked authors and content keywords |
| Dry-run mode | Navigate, scan, and generate content while skipping actual likes, follows, and submission |

## Screenshots

### Extension popup

View status, daily statistics, and the task queue. Control the main switch, dry-run mode, and single-task execution.

<table align="center">
  <tr><td align="center"><img src="img/Snipaste_2026-10-15_12-40-56.png" alt="Extension popup with activity switches, statistics, and task queue" width="380"></td></tr>
</table>

### Lead collection

A separate intent keyword pool, time window, AI classification, and throttling detection help find players seeking game recommendations and creators looking for review opportunities.

<table align="center">
  <tr><td align="center"><img src="img/Snipaste_2026-10-15_12-41-10.png" alt="Lead collection settings with AI classification and multilingual intent keywords" width="900"></td></tr>
</table>

### Automated posting plan

Choose the target language, daily limit, publishing times, and image policy. Prepare content in batches and let the extension publish it automatically.

<table align="center">
  <tr><td align="center"><img src="img/Snipaste_2026-10-15_12-41-20.png" alt="Posting plan with scheduled publishing, AI images, and batch content generation" width="900"></td></tr>
</table>

### Activity logs

Filter by action, result, level, or keyword to inspect execution details and failure reasons.

<table align="center">
  <tr><td align="center"><img src="img/Snipaste_2026-10-15_12-41-29.png" alt="Activity logs with action and result filters" width="900"></td></tr>
</table>

## Quick start

The current extension interface is in Chinese. The instructions below include the relevant Chinese labels to help you find each control.

### 1. Install the extension

1. Download the [extension ZIP (v0.6.1)](dist/x-nurture-helper-0.6.1.zip) and extract it to a folder you intend to keep.
2. Open Chrome and enter `chrome://extensions/` in the address bar.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the extracted folder **containing `manifest.json`**.
5. Open `https://x.com/`, sign in to your account, and click **X 养号助手** in the browser toolbar.

When using the source code, you can load the repository root directly. No npm dependency installation or build step is required. Extract the ZIP before loading it as an unpacked extension.

### 2. Configure the AI endpoint

Open **Settings → AI endpoint** (设置 → AI 接口), fill in the following fields, and save:

| Setting | Description |
| --- | --- |
| Base URL | An OpenAI-compatible endpoint, with or without a trailing `/v1` |
| Text API key (API Key（文字模型）) | Used for AI replies, translation, content generation, and intent classification |
| Image API key (生图 API Key) | Used for post images; leave empty to reuse the text API key |
| Text model (文本模型) | A model ID supported by your provider; the code defaults to `gpt-4o-mini` |
| Image model (生图模型) | An image-generation model ID supported by your provider; the code defaults to `gpt-image-1` |
| Image size (图片尺寸) | `1024x1024`, `1536x1024`, or `1024x1536`, subject to provider support |

Click **Test connection** (测试连接) to check the text endpoint. This button tests only the text model; image generation must be checked separately through an image-enabled posting workflow.

The endpoint must support `/v1/chat/completions`. Image generation also requires `/v1/images/generations`. You can change model IDs in settings without editing the source.

### 3. Set up automated interactions

1. Add topics under **Keywords** (关键词). The scheduler rotates through these keywords when searching.
2. Under **Behavior settings** (行为参数), choose a preset, enable the browsing, likes, replies, follows, or posting actions you want, and save.
3. Return to the popup and turn on the **Main switch** (总开关). On your first run, you can keep **Dry-run mode** (演练模式) enabled to inspect the queue and logs.
4. Once the configuration looks right, turn off dry-run mode to start real actions at the configured pace.

Dry runs still navigate pages, scan posts, and may call your AI endpoint, which can incur charges. They skip actual interactions and publishing submissions. Without interaction keywords, keyword scans cannot generate interaction tasks.

### 4. Set up automated publishing

Open **Posting plan** (发帖计划) and prepare queued content using either mode:

- **Translate my copy** (翻译我给的文案): enter one source text per line and translate and polish it into the target language in batches.
- **Generate by topic** (按主题生成): enter a topic and a post count to generate posts in the target language.

Set the daily limit, image policy, and publishing times, then save and enable the plan. Enter `HH:MM` values for scheduled slots; clear the time slots to publish at intervals within the configured time window.

Scheduled posts also require the main switch to be on and dry-run mode to be off. They remain subject to active hours, total quotas, and posting quotas in Behavior settings. **The Conservative preset has a posting quota of 0 by default**, so adjust it before publishing.

Before submission, the current implementation limits text to **280 weighted units**. Chinese characters and most emoji count as 2 units; ordinary Latin letters count as 1. Although the plan page allows a higher generation limit, the actual automated submission still truncates text to the 280-unit limit in the code.

## Lead collection

Lead collection has its own switch and keyword pool. Run it independently or let it alternate with automated interactions. The built-in categories are players looking for games and content creators, with multilingual intent keywords included.

- Filter by publication time to reduce outdated leads.
- Collect posts as the page scrolls and deduplicate by post URL and author.
- Reuse the AI endpoint to classify intent and retain the reason and confidence score.
- Track New, Messaged, Replied, Converted, and Ignored statuses.
- Search, add notes, and export CSV for further follow-up.

**Lead collection screens and records candidates; direct-message follow-up is manual.** Intent keywords are separate from interaction keywords, and collection itself does not like, reply, or follow. If AI classification fails, the extension logs the error and records the lead using the keyword's preset category at a lower confidence level.

## Activity limits and safeguards

| Setting | Conservative | Balanced (default) | Aggressive |
| --- | --- | --- | --- |
| Random action delay | 180–480 seconds | 60–240 seconds | 30–120 seconds |
| Total actions per hour | 4 | 10 | 20 |
| Total actions per day | 20 | 60 | 150 |
| Target posts scanned per round | 5 | 12 | 20 |
| Maximum follows per round | 1 | 2 | 4 |
| Posting quota (per hour / per day) | 0 / 0 | 1 / 4 | 2 / 8 |

Each preset saves its own parameters, so switching presets restores your previous settings for that preset. Total and per-action quotas both apply; reaching either limit pauses the affected execution. Dry runs do not consume action quotas.

Additional safeguards include cooldowns after consecutive failures, active hours, content similarity checks, blocklists, and CAPTCHA detection. When an account challenge is detected, the extension turns off the main switch, shows a notification, and records the reason. Check your account before manually enabling it again.

After page actions, the extension checks like, follow, or submission status. Timeouts and page errors are logged. Check the account's actual state alongside the page-level detection results.

## Tech stack

| Layer | Implementation |
| --- | --- |
| Extension platform | Chrome Extensions Manifest V3 |
| Languages | Vanilla JavaScript with ES Modules; HTML and CSS interfaces |
| Background scheduling | Service Worker, `chrome.alarms`, and a persistent task queue |
| Page automation | Content Script with DOM queries, input, clicks, and scrolling |
| Messaging | `chrome.runtime` messages, with state writes centralized in the background worker |
| Local persistence | `chrome.storage.local` for configuration, queue, statistics, logs, and leads |
| AI integration | `fetch` requests to OpenAI-compatible text and image-generation endpoints |
| Testing | Node.js built-in `node:test` and `assert` |
| Packaging | Native Node.js filesystem APIs and `zlib` to produce a ZIP and an unpacked directory |
| Dependencies | No third-party runtime dependencies, frontend framework, or bundler |

Automation flow:

```text
Keyword rotation → Search and filter → Deduplicate and apply blocklists → Task queue
                                                                            ↓
                          Check delays / active hours / quotas → Page action → Check result
                                                                            ↓
                                                            Statistics, logs, next run

Posting plan → Queue due posts → Same execution flow
Intent keywords → Separate collection → AI classification → Lead list / CSV
```

### Project structure

```text
├── manifest.json          # Extension manifest and permissions
├── src/
│   ├── background/        # Scheduling, task orchestration, and AI requests
│   ├── content/           # X page DOM automation and in-page console
│   ├── popup/             # Toolbar popup
│   ├── options/           # Settings, posting plans, leads, and logs
│   └── lib/               # Safeguards, storage, image utilities, and logs
├── icons/                 # Extension icons
├── img/                   # README screenshots and contact / donation QR codes
├── scripts/               # Packaging and verification scripts
├── tests/                 # Automated tests
├── probe/                 # Browser probes used during development
└── dist/                  # Extension ZIP and local unpacked directory
```

## Local development and packaging

Development scripts require a recent Node.js version that supports `import.meta.dirname`. Node.js 22 or newer is recommended. No third-party dependencies are required; run:

```bash
npm test                         # Run the existing automated tests
npm run check                    # Check JavaScript syntax
npm run package                  # Build the ZIP and unpacked extension directory
node scripts/verify-package.mjs   # Verify extraction, files, and icons on Windows / PowerShell
```

Artifacts for the current version:

```text
dist/x-nurture-helper-0.6.1.zip
dist/x-nurture-helper-0.6.1/
```

The distribution includes extension runtime files, both README versions, and documentation images. Browser debug profiles, probe scripts, and tests are excluded. After changing the source, rebuild the package, click **Reload** on the extension management page, and refresh X.

## Data and permissions

Configuration, API keys, task state, logs, and leads are stored locally in `chrome.storage.local`. AI features send the relevant post text, copy, or prompts to your configured endpoint. The extension uses the X session already present in your browser.

| Permission | Purpose |
| --- | --- |
| `storage` | Save endpoint configuration and activity data |
| `tabs` | Find and manage X worker tabs |
| `alarms` | Wake the scheduler and process planned tasks |
| `scripting` | Inject the page execution script when needed |
| `notifications` | Send system notifications, such as account-challenge pauses |
| X / Twitter site access | Scan pages and perform interactions |
| `<all_urls>` | Reach user-configured AI endpoints and download returned images; automatic content-script matching is limited to X / Twitter pages |

Remove API keys, cookies, and personal data before submitting issues, sharing screenshots, or sharing configuration.

## FAQ

**Why is nothing happening after I enable it?**

Check the main switch, dry-run mode, interaction keywords, and action switches. Then inspect the logs for exhausted quotas, cooldowns, active-hour restrictions, or account verification. Posting plans also need pending content and an available posting quota.

**Will it keep running after I close the browser?**

No. Automation depends on the browser running, pages being available, and your X session remaining signed in. Execution at the scheduled time cannot be guaranteed while the computer is asleep or the browser is closed.

**Why are tasks slow in a background tab?**

Browsers may throttle rendering and timers in background pages. Under **Advanced settings** (高级设置), enable the option to bring the worker tab to the foreground during execution, then check the logs again.

**Can I use another AI provider?**

Yes, if it exposes the OpenAI-compatible endpoints required by the extension. Set the text and image model IDs to models supported by the provider. Separate API keys can be used for text and image generation.

**Does it support multiple accounts or automated DMs?**

The extension uses the X session in its browser profile. There is no built-in account switching or automated direct messaging. Follow up on collected leads manually.

## Feedback and contributions

Issues and focused pull requests are welcome. Include the extension version, browser version, reproduction steps, and sanitized logs when reporting a problem. Run the relevant tests and syntax checks after making changes.

Automation can trigger platform restrictions. Users are responsible for assessing activity frequency, generated content, and account usage. Random pauses, quotas, and challenge detection do not guarantee account safety, follower growth, or conversions. This project is not affiliated with X / Twitter.

## Community and support

Scan the codes below to share feedback or discuss the project. If you find it useful, optional donations help support ongoing maintenance.

<table align="center">
  <tr>
    <th align="center">WeChat</th>
    <th align="center">Support development</th>
  </tr>
  <tr>
    <td align="center"><img src="img/wx.jpg" alt="WeChat contact QR code" width="280"></td>
    <td align="center"><img src="img/zhanshang.png" alt="WeChat donation QR code" width="280"></td>
  </tr>
  <tr>
    <td align="center">Scan to connect and share feedback</td>
    <td align="center">Thank you. Donations are entirely optional.</td>
  </tr>
</table>
