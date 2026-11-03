#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const STYLE = `
:root{--bg:#f5f6f3;--surface:#fff;--ink:#1c1d1f;--muted:#676c70;--line:#e2e4df;--line2:#c9ccc5;--accent:#0f766e;--accent-soft:#e6f2f0;--warm:#b45309;--warm-soft:#fdf1e3;--code:#3f4a48}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;letter-spacing:0}
a{color:#155e75;text-decoration:none;word-break:break-all}
a:hover{text-decoration:underline}
header{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.96);border-bottom:1px solid var(--line)}
.bar{max-width:1280px;margin:0 auto;padding:12px 20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.brand{font-weight:700;font-size:16px;white-space:nowrap}
.brand small{display:block;font-weight:400;color:var(--muted);font-size:12px}
.links{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
.pill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line2);background:var(--surface);border-radius:8px;padding:5px 10px;font-size:12px;color:var(--muted)}
.pill b{color:var(--ink);font-weight:600}
.wrap{max-width:1280px;margin:0 auto;padding:22px 20px 60px}
.hero{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:18px 20px;margin-bottom:16px}
.hero h1{margin:0 0 6px;font-size:22px;line-height:1.3}
.hero p{margin:4px 0;color:var(--muted);max-width:1000px}
.sources{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px;margin-top:14px}
.source{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px 12px;font-size:13px}
.source .k{color:var(--muted);font-size:12px;margin-bottom:2px}
.source .v{word-break:break-all}
.tag{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;font-size:11px;font-weight:600}
.tag.ok{background:var(--accent-soft);color:var(--accent)}
.tag.no{background:var(--warm-soft);color:var(--warm)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:16px 0}
.stat{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
.stat b{display:block;font-size:20px;line-height:1.2}
.stat span{color:var(--muted);font-size:12px}
nav.tabs{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0;position:sticky;top:57px;z-index:10;background:var(--bg);padding:6px 0}
nav.tabs button{border:1px solid var(--line2);background:var(--surface);color:var(--ink);border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer}
nav.tabs button.active{background:var(--accent);border-color:var(--accent);color:#fff}
section.tab{display:none}
section.tab.active{display:block}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:16px 18px;margin-bottom:16px}
.panel h2{margin:0 0 10px;font-size:18px}
.panel h3{margin:22px 0 8px;font-size:15px;border-bottom:1px solid var(--line);padding-bottom:6px}
.panel h3:first-child{margin-top:0}
.panel p{margin:6px 0}
.muted{color:var(--muted)}
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%;min-width:860px;font-size:13px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{background:#f2f3f0;font-weight:600;white-space:nowrap}
tr:last-child td{border-bottom:none}
.fld{font-family:Consolas,"Courier New",monospace;font-size:12px;color:var(--code);word-break:break-all}
.val{word-break:break-word}
.null{color:#a3a8a3;font-style:italic}
.msg{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin-bottom:12px}
.msg .meta{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;font-size:12px;color:var(--muted)}
.msg .meta b{color:var(--ink)}
.msg.user{border-left:4px solid var(--warm)}
.msg.assistant{border-left:4px solid var(--accent)}
.answer{white-space:normal;line-height:1.7}
.cite{display:inline-block;min-width:22px;padding:1px 5px;margin:0 2px;border:1px solid var(--accent);border-radius:6px;background:var(--accent-soft);color:var(--accent);font-size:11px;font-weight:700;cursor:pointer;text-align:center}
.cite:hover{background:var(--accent);color:#fff}
.ref-row.flash{outline:3px solid var(--warm);outline-offset:2px}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}
.card{border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:12px 14px}
.card h4{margin:0 0 6px;font-size:14px}
.card ul{margin:6px 0 0;padding-left:18px}
.bar-row{display:grid;grid-template-columns:110px 1fr 52px;gap:8px;align-items:center;font-size:13px;margin-bottom:6px}
.bar-track{background:#eceeea;border-radius:8px;height:16px;overflow:hidden}
.bar-fill{height:100%;background:var(--accent);border-radius:8px}
.bar-row .n{text-align:right;color:var(--muted)}
pre.json{background:#101412;color:#d7e0da;border-radius:8px;padding:14px;overflow:auto;font:12px/1.5 Consolas,"Courier New",monospace;max-height:70vh}
.copy{float:right;margin:0 0 8px 8px;border:1px solid var(--line2);background:var(--surface);border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer}
.note{background:var(--warm-soft);border:1px solid #e7c9a0;border-radius:8px;padding:10px 14px;font-size:13px;color:#6b3a00}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-top:10px}
footer{margin-top:24px;color:var(--muted);font-size:12px}
.json-inline{background:#f2f4f1;border:1px solid var(--line);border-radius:6px;padding:8px;overflow:auto;font:12px/1.5 Consolas,"Courier New",monospace;max-height:260px;margin:2px 0;white-space:pre;word-break:break-all}
.kv-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px;margin-top:10px}
@media (max-width:760px){.bar{padding:10px 14px}.links{margin-left:0;width:100%}header{position:static}nav.tabs{position:sticky;top:0}.hero h1{font-size:19px}.stat b{font-size:18px}}
`;

function domainFromUrl(url) {
  try {
    return new URL(String(url || '')).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function escHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function jsonText(value) {
  return JSON.stringify(value == null ? null : value, null, 2);
}

function collectAnchors(text) {
  const anchors = new Set();
  const patterns = [/\[(\d+)\]/g, /【(\d+)】/g, /\^(\d+)/g];
  for (const pattern of patterns) {
    for (const match of String(text || '').matchAll(pattern)) {
      anchors.add(match[1]);
    }
  }
  return anchors;
}

function withCiteFlags(cards, answer) {
  const anchors = collectAnchors(answer);
  return (cards || []).map((card) => {
    const index = String(card.index || '');
    const cited = typeof card.cited === 'boolean' ? card.cited : Boolean(index && anchors.has(index));
    return {
      ...card,
      cited,
      cite_anchor: cited && index ? '[' + index + ']' : String(card.cite_anchor || ''),
    };
  });
}

function pickEntity(record) {
  const target = String((record && (record.extraction && record.extraction.target)) || (record && record.options && record.options.target) || '').trim();
  if (target) return target;
  const title = String((record && record.share_info && record.share_info.share_name) || (record && record.page && record.page.title) || '')
    .replace(/[（(].*[)）]/g, '')
    .trim();
  return title.length <= 24 ? title : '';
}

export function buildFieldMapPayload(record, meta = {}) {
  const source = record || {};
  const answer = String((source.answer && source.answer.text) || '');
  const refs = ((source.references && source.references.items) || []).map((item, index) => ({
    number: item.number == null ? item.index || index + 1 : item.number,
    source: String(item.source || item.sitename || ''),
    domain: String(item.domain || domainFromUrl(item.url)),
    title: String(item.title || ''),
    date: String(item.date || item.publish_time_second || ''),
    url: String(item.url || ''),
    summary: String(item.summary || ''),
  }));
  const full = withCiteFlags(source.references_full || (source.references && source.references.full) || [], answer);
  const queries = [];
  for (const block of source.search_blocks || []) {
    for (const query of block.queries || []) {
      const text = String(query || '').trim();
      if (text && !queries.includes(text)) queries.push(text);
    }
  }
  const suggest = (source.suggest_questions || []).map((item) => {
    if (typeof item === 'string') return item;
    return String(item.title || item.content || item.question || item.text || '');
  }).filter(Boolean);
  const shareInfo = source.share_info || {};
  const page = source.page || {};
  const timing = source.timing || {};
  return {
    question: String(source.question || meta.question || ''),
    answer,
    brief: String((source.answer && source.answer.brief) || ''),
    refs,
    full,
    queries,
    suggestQuestions: suggest,
    suggestCount: suggest.length,
    entity: pickEntity(source),
    share: {
      share_id: String(page.share_id || shareInfo.share_id || ''),
      share_name: String(page.title || shareInfo.share_name || ''),
      share_status: shareInfo.share_status == null ? '' : shareInfo.share_status,
      share_time: String(timing.share_time || shareInfo.share_time || ''),
      message_index_end: String(shareInfo.message_index_end || ''),
      share_platform: String(shareInfo.share_platform || ''),
      share_biz_type: shareInfo.share_biz_type == null ? '' : shareInfo.share_biz_type,
      bot: shareInfo.bot || {},
      page_url: String(page.url || ''),
      conversation_id: String(page.conversation_id || ''),
      collected_at: String(source.collected_at || ''),
      transport: String(source.transport || ''),
      ok: Boolean(source.ok),
    },
    raw: source,
  };
}

function fmt(value) {
  if (value == null || value === '') return '<span class="null">—</span>';
  if (typeof value === 'object') {
    const text = jsonText(value);
    return `<pre class="json-inline">${escHtml(text)}</pre>`;
  }
  return escHtml(String(value));
}

function fmtUrl(value) {
  if (value == null || value === '') return '<span class="null">—</span>';
  return `<a href="${escHtml(String(value))}" target="_blank" rel="noopener">${escHtml(String(value))}</a>`;
}

function table(headers, rows) {
  const head = headers.map((item) => `<th>${escHtml(item)}</th>`).join('');
  const body = rows.map((row) => {
    const cells = Array.isArray(row) ? row : row.cells;
    const id = row && row.id ? ` id="${escHtml(row.id)}"` : '';
    const cls = row && row.cls ? ` class="${escHtml(row.cls)}"` : '';
    return `<tr${id}${cls}>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
  }).join('');
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

const SESSION_FIELDS = [
  { source: '分享接口', field: 'share_id', meaning: '分享链接唯一标识', usage: '样本 ID / 去重键', get: (r) => (r.page && r.page.share_id) || (r.share_info && r.share_info.share_id) },
  { source: '分享接口', field: 'share_name', meaning: '分享标题', usage: '识别主题，辅助报告归类', get: (r) => (r.page && r.page.title) || (r.share_info && r.share_info.share_name) },
  { source: '分享接口', field: 'share_status', meaning: '分享状态码', usage: '判断分享是否有效可读', get: (r) => r.share_info && r.share_info.share_status },
  { source: '分享接口', field: 'share_time', meaning: '分享导出时间', usage: '与提问时间区分，评估快照时效', get: (r) => r.timing && r.timing.share_time },
  { source: '分享接口', field: 'message_index_end', meaning: '分享覆盖的最后消息序号', usage: '判断单轮或连续多轮', get: (r) => r.share_info && r.share_info.message_index_end },
  { source: '分享接口', field: 'share_platform', meaning: '分享来源平台', usage: '区分 web / app 渠道', get: (r) => r.share_info && r.share_info.share_platform },
  { source: '分享接口', field: 'share_biz_type', meaning: '分享业务类型', usage: '内部兼容判断', get: (r) => r.share_info && r.share_info.share_biz_type },
  { source: '分享接口', field: 'bot', meaning: '机器人信息', usage: '确认回答引擎及 bot 标识', get: (r) => r.share_info && r.share_info.bot },
  { source: '分享接口', field: 'page.url', meaning: '分享链接', usage: '可重访、可核验、可入库', get: (r) => r.page && r.page.url },
  { source: '消息推导', field: 'conversation_id', meaning: '会话 ID', usage: '关联同一会话的不同轮次', get: (r) => r.page && r.page.conversation_id },
  { source: '采集过程', field: 'collected_at', meaning: '采集时间', usage: '记录数据何时入库', get: (r) => r.collected_at },
  { source: '采集过程', field: 'transport', meaning: '采集通道', usage: 'opencli-doubao-adapter / doubao-thread-http', get: (r) => r.transport },
  { source: '采集配置', field: 'options.doubao_mode', meaning: '豆包回答模式', usage: '快速 / 专家 / 工作任务 Turbo / 工作任务 Pro', get: (r) => (r.options && r.options.doubao_mode) || (r.page && r.page.doubao_mode) },
];

const MESSAGE_FIELDS = [
  { field: 'message_id', meaning: '消息唯一标识', usage: '消息级去重键', get: (m) => m.message_id },
  { field: 'user_type', meaning: '角色', usage: '1 为用户，2 为助手', get: (m) => m.user_type },
  { field: 'status', meaning: '消息状态', usage: '0 通常表示正常', get: (m) => m.status },
  { field: 'content_type', meaning: '内容类型', usage: '判断内容形态', get: (m) => m.content_type },
  { field: 'content_status', meaning: '内容状态', usage: '辅助判断是否生成完毕', get: (m) => m.content_status },
  { field: 'index_in_conv', meaning: '会话内序号', usage: '还原消息顺序', get: (m) => m.index_in_conv },
  { field: 'create_time', meaning: '消息创建时间', usage: '精确到提问时刻', get: (m) => m.create_time },
  { field: 'update_time', meaning: '最后更新时间', usage: '回答完成时刻参考', get: (m) => m.update_time },
  { field: 'thinking_content', meaning: '思考过程文本', usage: '保留模型思考过程', get: (m) => m.thinking_content },
  { field: 'content_block', meaning: '内容块原始数组', usage: '保留全部块级结构', get: (m) => m.content_block },
  { field: 'conversation_id', meaning: '会话 ID', usage: '消息到会话的关联', get: (m) => m.conversation_id },
  { field: 'sec_sender', meaning: '发送者标识', usage: '脱敏后仅保留占位', get: (m) => m.sec_sender },
];
const ANSWER_FIELDS = [
  { source: '回答正文', field: 'answer.text', meaning: '助手回答全文', usage: '全文留存、分词、提及统计', get: (r) => r.answer && r.answer.text },
  { source: '回答摘要', field: 'answer.brief', meaning: 'brief 摘要字段', usage: '快速理解与报告摘要，不参与信源分析', get: (r) => r.answer && r.answer.brief },
  { source: '推荐问题', field: 'suggest_questions', meaning: '推荐查看问题', usage: '记录追问路径与泛需求', get: (r) => r.suggest_questions },
  { source: '引用', field: 'references.items', meaning: '规范化引用列表', usage: '信源站点 / 域名 / 时间统计', get: (r) => r.references && r.references.items },
  { source: '引用', field: 'references.full', meaning: '完整信源卡片', usage: '保留 doc_id / search_id / logo 等全字段', get: (r) => r.references && r.references.full },
  { source: '引用', field: 'references_full', meaning: 'ask 模式附加信源卡片', usage: '与 thread 快照全字段对齐', get: (r) => r.references_full },
  { source: '搜索', field: 'search_blocks', meaning: '搜索子查询块', usage: '还原模型检索过程', get: (r) => r.search_blocks },
  { source: '完成状态', field: 'completion', meaning: '回答完成标志', usage: '判断采集是否完整', get: (r) => r.completion },
  { source: '时间信息', field: 'timing', meaning: '提问 / 完成 / 分享时间', usage: '时效与批次分析', get: (r) => r.timing },
  { source: '统计', field: 'extraction', meaning: '字数 / 行数 / 标题', usage: '回答结构分析', get: (r) => r.extraction },
  { source: '数据合规', field: 'redacted', meaning: '是否已脱敏', usage: '确认分享快照仅含脱敏值', get: (r) => r.redacted },
];

function renderSessionRows(record) {
  return table(
    ['数据来源', '字段', '含义', '本次示例的具体内容', '如何分析 / 用途'],
    SESSION_FIELDS.map((item) => [escHtml(item.source), `<span class="fld">${escHtml(item.field)}</span>`, escHtml(item.meaning), fmt(item.get(record)), escHtml(item.usage)])
  );
}

function roleText(value) {
  if (value === 1 || value === '1') return '用户';
  if (value === 2 || value === '2') return '助手';
  return value == null || value === '' ? '未知' : String(value);
}

function renderMessageRows(record) {
  const messages = record.message_list || [];
  if (!messages.length) {
    return '<p class="muted">未取到消息级快照。若为 ask 模式采集，可运行 <span class="fld">--capture-threads</span> 补采分享快照。</p>';
  }
  const rows = [];
  messages.forEach((message, messageIndex) => {
    for (const item of MESSAGE_FIELDS) {
      rows.push([
        escHtml(String(messageIndex + 1)),
        escHtml(roleText(message.user_type)),
        `<span class="fld">${escHtml(item.field)}</span>`,
        escHtml(item.meaning),
        fmt(item.get(message)),
        escHtml(item.usage),
      ]);
    }
  });
  return table(
    ['消息序号', '角色', '字段', '含义', '具体内容', '如何分析 / 用途'],
    rows
  );
}

function renderAnswerRows(record) {
  return table(
    ['数据来源', '字段', '含义', '本次示例的具体内容', '如何分析 / 用途'],
    ANSWER_FIELDS.map((item) => [escHtml(item.source), `<span class="fld">${escHtml(item.field)}</span>`, escHtml(item.meaning), fmt(item.get(record)), escHtml(item.usage)])
  );
}

function answerHtml(text) {
  let out = escHtml(text).replace(/\r?\n/g, '<br>');
  out = out.replace(/\[(\d+)\]/g, '<span class="cite" data-ref="$1">$1</span>');
  out = out.replace(/【(\d+)】/g, '<span class="cite" data-ref="$1">$1</span>');
  out = out.replace(/\^(\d+)/g, '<span class="cite" data-ref="$1">$1</span>');
  return out;
}

function renderMessages(payload) {
  const html = [];
  if (payload.question) {
    html.push('<div class="msg user"><div class="meta"><b>用户消息</b><span>提问</span></div><div class="answer">' + escHtml(payload.question) + '</div></div>');
  }
  if (payload.answer) {
    html.push('<div class="msg assistant"><div class="meta"><b>助手回答</b><span>' + escHtml(String(payload.answer.length)) + ' 字</span></div><div class="answer">' + answerHtml(payload.answer) + '</div></div>');
  }
  return html.length ? html.join('') : '<p class="muted">无消息正文。</p>';
}

function renderBrief(payload) {
  if (!payload.brief) return '<p class="muted">该样本未取到 brief 摘要字段。</p>';
  return '<div class="note"><b>brief 摘要：</b><br>' + escHtml(payload.brief).replace(/\r?\n/g, '<br>') + '</div>';
}

function renderSuggest(payload) {
  if (!payload.suggestQuestions.length) return '<p class="muted">该分享快照未返回推荐查看问题（可能需网页端 DOM 采集补充）。</p>';
  return '<ol>' + payload.suggestQuestions.map((item) => '<li>' + escHtml(item) + '</li>').join('') + '</ol>';
}

function renderHeadings(payload) {
  const headings = (payload.raw && payload.raw.extraction && payload.raw.extraction.headings) || [];
  if (!headings.length) return '<p class="muted">未提取到 Markdown 标题结构。</p>';
  return '<ol>' + headings.map((item) => '<li>' + escHtml(item) + '</li>').join('') + '</ol>';
}

function renderSearchBlocks(payload) {
  const blocks = (payload.raw && payload.raw.search_blocks) || [];
  if (!blocks.length) return '<p class="muted">未取到搜索子查询块。</p>';
  return blocks.map((block, index) => {
    const queries = (block.queries || []).map((item) => '<li>' + escHtml(item) + '</li>').join('');
    const summary = block.summary ? '<p>' + escHtml(block.summary) + '</p>' : '';
    return '<div class="msg assistant"><div class="meta"><b>搜索块 ' + escHtml(String(index + 1)) + '</b><span>' + escHtml(String(block.scene == null ? '' : block.scene)) + ' / type ' + escHtml(String(block.search_type == null ? '' : block.search_type)) + '</span></div>' + summary + '<ol>' + queries + '</ol></div>';
  }).join('');
}

function renderTiming(payload) {
  const raw = payload.raw || {};
  const timing = raw.timing || {};
  const completion = raw.completion || {};
  const rows = [
    ['asked_at', '提问时间', timing.asked_at],
    ['completed_at', '回答完成时间', timing.completed_at],
    ['collected_at', '采集时间', timing.collected_at || raw.collected_at],
    ['share_time', '分享导出时间', timing.share_time],
    ['finished', '完成标志', completion.finished],
    ['signals', '完成信号', completion.signals],
  ];
  return table(['字段', '含义', '值'], rows.map((row) => [`<span class="fld">${escHtml(row[0])}</span>`, escHtml(row[1]), fmt(row[2])]));
}

function renderRefs(payload) {
  if (!payload.refs.length) return '<p class="muted">未取到结构化引用信源。</p>';
  const rows = payload.refs.map((item) => [
    escHtml(String(item.number)),
    escHtml(item.source),
    escHtml(item.domain),
    `<span class="val">${escHtml(item.title)}</span>`,
    item.date ? escHtml(item.date) : '<span class="null">—</span>',
    `<span class="val">${escHtml((item.summary || '').slice(0, 160))}${(item.summary || '').length > 160 ? '…' : ''}</span>`,
    item.url ? `<a href="${escHtml(item.url)}" target="_blank" rel="noopener">打开</a>` : '<span class="null">—</span>',
  ]);
    return table(
    ['序号', '信源', '域名', '标题', '发布时间', '摘要', '链接'],
    rows.map((cells, index) => ({
      id: 'ref-' + String(payload.refs[index].number),
      cls: 'ref-row',
      cells,
    }))
  );
}
function buildHtml(payload, meta) {
  const raw = payload.raw || {};
  const shareId = payload.share.share_id || meta.sampleId || '';
  const messageCount = (raw.message_list || []).length || (payload.answer ? 2 : 0);
  const domainCount = new Set(payload.refs.map((item) => item.domain).filter(Boolean)).size;
  const shareTime = payload.share.share_time;
  const title = payload.question || '豆包分享链接 · 数据字段地图';
  const heroTitle = payload.question ? escHtml(payload.question) : '一份豆包分享链接里到底有哪些数据';
  const heroDesc = payload.question
    ? '本页把该分享链接解析出的每一个字段、它在本次回答中的具体内容，以及后续如何用于分析一一对应展示。分享快照数据来自公开页面，不需要登录。'
    : '本页把公开分享页面能解析到的字段、具体内容与分析方法一一对应展示。分享快照数据来自公开页面，不需要登录。';
  const shareTag = shareId ? '<span class="tag ok">已取到</span>' : '<span class="tag no">未取到</span>';
  const stats = [
    ['消息数', messageCount, '1 问 1 答为 2'],
    ['引用信源', payload.refs.length, 'references.items'],
    ['唯一域名', domainCount, '去重后域名数'],
    ['搜索子查询', payload.queries.length, 'search_blocks'],
    ['回答字数', payload.answer.length, 'answer.text'],
    ['分享导出时间', shareTime || '—', 'timing.share_time'],
  ];
  const payloadJson = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)} · 数据字段地图</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <div class="bar">
    <div class="brand">Doubao 分享链接 · 数据字段地图<small>字段 → 示例值 → 分析方法</small></div>
    <div class="links">
      <span class="pill">样本 <b>${escHtml(shareId || meta.sampleId || '—')}</b></span>
      <span class="pill">消息 <b>${escHtml(String(messageCount))}</b></span>
      <span class="pill">引用 <b>${escHtml(String(payload.refs.length))}</b></span>
    </div>
  </div>
</header>
<div class="wrap">
  <div class="hero">
    <h1>${heroTitle}</h1>
    <p>${heroDesc}</p>
    <div class="sources">
      <div class="source"><div class="k">分享链接（公开可解析）</div><div class="v">${payload.share.page_url ? `<a href="${escHtml(payload.share.page_url)}" target="_blank" rel="noopener">${escHtml(payload.share.page_url)}</a>` : '<span class="null">—</span>'}${shareTag}</div></div>
      <div class="source"><div class="k">会话 ID / 标题</div><div class="v">${escHtml(payload.share.conversation_id || '—')}${payload.share.share_name ? ' / ' + escHtml(payload.share.share_name) : ''}</div></div>
      <div class="source"><div class="k">采集时间 / 通道</div><div class="v">${escHtml(payload.share.collected_at || '—')} / <span class="fld">${escHtml(payload.share.transport || '—')}</span></div></div>
      <div class="source"><div class="k">分享元数据</div><div class="v">status ${escHtml(String(payload.share.share_status))} · platform ${escHtml(String(payload.share.share_platform))} · biz_type ${escHtml(String(payload.share.share_biz_type))}</div></div>
    </div>
    <div class="stats">
      ${stats.map((item) => `<div class="stat"><b>${escHtml(String(item[1]))}</b><span>${escHtml(item[0])}</span><span class="muted">${escHtml(item[2])}</span></div>`).join('')}
    </div>
  </div>
  <nav class="tabs">
    <button class="active" data-tab="map">字段地图</button>
    <button data-tab="answer">回答正文映射</button>
    <button data-tab="refs">引用明细</button>
    <button data-tab="derive">推导分析</button>
    <button data-tab="raw">原始 JSON</button>
  </nav>
  <section class="tab active" id="tab-map">
    <div class="panel">
      <h2>一、会话级字段</h2>
      <p class="muted">这些字段描述“这条分享本身”是什么，决定它能否作为一次独立样本进入测评库。</p>
      ${renderSessionRows(raw)}
    </div>
    <div class="panel">
      <h2>二、消息级字段</h2>
      <p class="muted">每个消息对象都带状态、内容和扩展字段；这些字段回答“这条回答是怎么生成的、用了什么能力”。</p>
      ${renderMessageRows(raw)}
    </div>
    <div class="panel">
      <h2>三、回答与引用字段</h2>
      <p class="muted">回答正文、brief 摘要、推荐问题、搜索子查询和引用信源是后续分析的主要数据面。</p>
      ${renderAnswerRows(raw)}
    </div>
  </section>
  <section class="tab" id="tab-answer">
    <div class="panel">
      <h2>一问一答正文</h2>
      <div id="msgList">${renderMessages(payload)}</div>
    </div>
    <div class="panel">
      <h2>brief 摘要</h2>
      ${renderBrief(payload)}
    </div>
    <div class="panel">
      <h2>推荐查看问题</h2>
      ${renderSuggest(payload)}
    </div>
    <div class="panel">
      <h2>回答结构（Markdown 标题）</h2>
      ${renderHeadings(payload)}
    </div>
    <div class="panel">
      <h2>搜索子查询</h2>
      ${renderSearchBlocks(payload)}
    </div>
    <div class="panel">
      <h2>时间与完成状态</h2>
      ${renderTiming(payload)}
    </div>
  </section>
  <section class="tab" id="tab-refs">
    <div class="panel">
      <h2>引用信源明细</h2>
      <p class="muted">共 ${escHtml(String(payload.refs.length))} 条；点击回答正文中的引用角标可跳转到对应信源。</p>
      ${renderRefs(payload)}
    </div>
  </section>
  <section class="tab" id="tab-derive">
    <div class="panel">
      <h2>推导分析</h2>
      <p class="muted">基于引用信源和回答正文的自动汇总，用于品牌可见度、信源结构、时效性等判断。</p>
      <div class="grid2">
        <div class="card"><h4>信源站点分布</h4><div id="siteBars"></div></div>
        <div class="card"><h4>信源域名分布</h4><div id="domainBars"></div></div>
        <div class="card"><h4>信源新旧分布</h4><div id="recencyBars"></div><p class="muted" style="margin-top:8px">按信源发布时间计算。</p></div>
        <div class="card"><h4>搜索子查询</h4><div id="queryList"></div></div>
        <div class="card"><h4>实体提及</h4><div id="entityStats"></div></div>
        <div class="card"><h4>引用状态</h4><div id="citeStats"></div></div>
      </div>
    </div>
  </section>
  <section class="tab" id="tab-raw">
    <div class="panel">
      <h2>原始解析 JSON</h2>
      <p class="muted">这是解析分享链接后的完整记录，已脱敏。</p>
      <button class="copy" onclick="copyRaw()">复制原始 JSON</button>
      <pre class="json" id="rawJson"></pre>
    </div>
  </section>
  <footer>由 <span class="fld">scripts/render_field_maps.mjs</span> 生成；数据来自公开分享快照，敏感字段已脱敏。</footer>
</div>
<script type="application/json" id="payload">${payloadJson}</script>
<script>
(function(){
  var data = JSON.parse(document.getElementById('payload').textContent);
  var esc = function(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); };
  function fmtDate(v){
    if(!v) return '<span class="null">—</span>';
    var d = new Date(v);
    if(isNaN(d.getTime())) return esc(v);
    return d.toLocaleString('zh-CN', {timeZone:'Asia/Shanghai', hour12:false});
  }
  function barChart(elId, rows){
    var el = document.getElementById(elId);
    var max = 1;
    rows.forEach(function(r){ if(r.v > max) max = r.v; });
    el.innerHTML = rows.map(function(r){
      return '<div class="bar-row"><span>'+esc(r.k)+'</span><div class="bar-track"><div class="bar-fill" style="width:'+Math.round(r.v/max*100)+'%"></div></div><span class="n">'+r.v+'</span></div>';
    }).join('');
  }
  var siteCount = {};
  data.refs.forEach(function(r){ siteCount[r.source] = (siteCount[r.source]||0)+1; });
  barChart('siteBars', Object.keys(siteCount).map(function(k){return {k:k, v:siteCount[k]};}).sort(function(a,b){return b.v-a.v;}));
  var domainCount = {};
  data.refs.forEach(function(r){ domainCount[r.domain] = (domainCount[r.domain]||0)+1; });
  barChart('domainBars', Object.keys(domainCount).map(function(k){return {k:k, v:domainCount[k]};}).sort(function(a,b){return b.v-a.v;}));
  var now = Date.now();
  var buckets = {'近1年':0,'近2年':0,'2年以上':0,'无时间':0};
  data.refs.forEach(function(r){
    if(!r.date){ buckets['无时间']++; return; }
    var t = new Date(r.date).getTime();
    if(isNaN(t)){ buckets['无时间']++; return; }
    var age = now - t;
    if(age <= 365*86400000) buckets['近1年']++;
    else if(age <= 2*365*86400000) buckets['近2年']++;
    else buckets['2年以上']++;
  });
  barChart('recencyBars', Object.keys(buckets).map(function(k){return {k:k, v:buckets[k]};}).sort(function(a,b){return a.k.localeCompare(b.k,'zh');}));
  document.getElementById('queryList').innerHTML = data.queries.length
    ? '<ol>' + data.queries.map(function(q){return '<li>'+esc(q)+'</li>';}).join('') + '</ol>'
    : '<p class="muted">未取到搜索子查询。</p>';
  var entity = data.entity;
  if(entity){
    var pattern = entity.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
    var mentions = (data.answer.match(new RegExp(pattern, 'g')) || []).length;
    document.getElementById('entityStats').innerHTML = '<p><b>' + esc(entity) + '</b> 在回答中出现 <b>' + mentions + '</b> 次</p><p class="muted">可用于品牌提及次数、上下文相关性判断。</p>';
  } else {
    document.getElementById('entityStats').innerHTML = '<p class="muted">未指定目标实体，跳过提及次数统计。</p>';
  }
  var cited = data.full.filter(function(r){ return r.cited; }).length;
  document.getElementById('citeStats').innerHTML = cited
    ? '<p>被正文引用 <b>' + cited + '</b> / ' + data.full.length + ' 条</p>'
    : '<p class="muted">正文未内嵌引用锚点，' + data.full.length + ' 条信源未被正文显式引用。</p>';
  document.getElementById('rawJson').textContent = JSON.stringify(data.raw, null, 2);
  var tabs = document.querySelectorAll('nav.tabs button');
  tabs.forEach(function(btn){
    btn.addEventListener('click', function(){
      tabs.forEach(function(b){ b.classList.remove('active'); });
      document.querySelectorAll('section.tab').forEach(function(s){ s.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      window.scrollTo({top:0, behavior:'smooth'});
    });
  });
  window.copyRaw = function(){
    var text = document.getElementById('rawJson').textContent;
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){ alert('已复制'); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); alert('已复制');
    }
  };
  document.addEventListener('click', function(e){
    var node = e.target;
    while (node && !(node.classList && node.classList.contains('cite'))) node = node.parentElement;
    if(!node) return;
    var ref = document.getElementById('ref-' + node.getAttribute('data-ref'));
    if(!ref) return;
    var refsBtn = document.querySelector('button[data-tab="refs"]');
    if(refsBtn && !refsBtn.classList.contains('active')){
      tabs.forEach(function(b){ b.classList.remove('active'); });
      document.querySelectorAll('section.tab').forEach(function(s){ s.classList.remove('active'); });
      refsBtn.classList.add('active');
      document.getElementById('tab-refs').classList.add('active');
    }
    ref.scrollIntoView({behavior:'smooth', block:'center'});
    ref.classList.add('flash');
    setTimeout(function(){ ref.classList.remove('flash'); }, 1200);
  });
})();
</script>
</body>
</html>
`;
}

export function renderFieldMap(record, outPath, meta = {}) {
  const payload = buildFieldMapPayload(record, meta);
  const html = buildHtml(payload, meta);
  const target = path.resolve(outPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, html, 'utf8');
  return target;
}

function parseArgs(argv) {
  const args = { out: '', sampleId: '', runId: '', question: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') args.out = argv[++i];
    else if (arg === '--sample-id') args.sampleId = argv[++i];
    else if (arg === '--run-id') args.runId = argv[++i];
    else if (arg === '--question') args.question = argv[++i];
    else if (arg === '-h' || arg === '--help') args.help = true;
    else if (!args.input) args.input = arg;
    else throw new Error('Unknown argument: ' + arg);
  }
  return args;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/render_field_maps.mjs <raw-json> [--out <html>] [--sample-id <id>] [--run-id <id>] [--question <text>]');
    return;
  }
  if (!options.input) throw new Error('Missing raw JSON file');
  const record = JSON.parse(fs.readFileSync(path.resolve(options.input), 'utf8'));
  const out = options.out || options.input.replace(/\.json$/i, '-data-map.html');
  const html = renderFieldMap(record, out, {
    sampleId: options.sampleId,
    runId: options.runId,
    question: options.question,
  });
  console.log(JSON.stringify({ ok: true, html }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
