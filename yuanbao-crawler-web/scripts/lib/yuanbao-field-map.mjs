// Per-question data field map renderer for yuanbao-crawler-web.
// One HTML per question, generated from the first valid sample of that question.
import fs from 'node:fs';
import path from 'node:path';

const STYLE = `
:root{--bg:#f4f6f8;--surface:#fff;--ink:#1c1d1f;--muted:#66707a;--line:#e3e7eb;--line2:#cbd2d8;--accent:#1667b8;--accent-soft:#e7f0fa;--warm:#b45309;--warm-soft:#fdf1e3;--code:#31424f}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;letter-spacing:0}
a{color:#0b5394;text-decoration:none;word-break:break-all}
a:hover{text-decoration:underline}
header{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.96);border-bottom:1px solid var(--line)}
.bar{max-width:1320px;margin:0 auto;padding:12px 20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.brand{font-weight:700;font-size:16px;white-space:nowrap}
.brand small{display:block;font-weight:400;color:var(--muted);font-size:12px}
.links{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
.pill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line2);background:var(--surface);border-radius:8px;padding:5px 10px;font-size:12px;color:var(--muted)}
.pill b{color:var(--ink);font-weight:600}
.wrap{max-width:1320px;margin:0 auto;padding:22px 20px 60px}
.hero{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:18px 20px;margin-bottom:16px}
.hero h1{margin:0 0 6px;font-size:22px;line-height:1.3}
.hero p{margin:4px 0;color:var(--muted);max-width:1060px}
.sources{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px;margin-top:14px}
.source{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px 12px;font-size:13px}
.source .k{color:var(--muted);font-size:12px;margin-bottom:2px}
.source .v{word-break:break-all}
.tag{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;font-size:11px;font-weight:600}
.tag.ok{background:var(--accent-soft);color:var(--accent)}
.tag.no{background:var(--warm-soft);color:var(--warm)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:10px;margin:16px 0}
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
table{border-collapse:collapse;width:100%;min-width:880px;font-size:13px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{background:#f0f3f5;font-weight:600;white-space:nowrap}
tr:last-child td{border-bottom:none}
.fld{font-family:Consolas,"Courier New",monospace;font-size:12px;color:var(--code);word-break:break-all}
.val{word-break:break-word}
.null{color:#a5abb1;font-style:italic}
.msg{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin-bottom:12px}
.msg .meta{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;font-size:12px;color:var(--muted)}
.msg .meta b{color:var(--ink)}
.msg.user{border-left:4px solid var(--warm)}
.msg.assistant{border-left:4px solid var(--accent)}
.answer{white-space:normal;line-height:1.7}
.answer h2{font-size:16px;margin:14px 0 6px}
.answer h3{font-size:14px;margin:12px 0 5px}
.answer p{margin:7px 0}
.answer ul,.answer ol{margin:7px 0;padding-left:22px}
.answer img.media-inline{max-width:100%;border-radius:8px;margin:8px 0;display:block}
.cite{display:inline-block;min-width:22px;padding:1px 5px;margin:0 2px;border:1px solid var(--accent);border-radius:6px;background:var(--accent-soft);color:var(--accent);font-size:11px;font-weight:700;cursor:pointer;text-align:center}
.cite:hover{background:var(--accent);color:#fff}
.ref-row.flash{outline:3px solid var(--warm);outline-offset:2px}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}
.card{border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:12px 14px}
.card h4{margin:0 0 6px;font-size:14px}
.card ul{margin:6px 0 0;padding-left:18px}
.bar-row{display:grid;grid-template-columns:150px 1fr 52px;gap:8px;align-items:center;font-size:13px;margin-bottom:6px}
.bar-track{background:#eceff1;border-radius:8px;height:16px;overflow:hidden}
.bar-fill{height:100%;background:var(--accent);border-radius:8px}
.bar-row .n{text-align:right;color:var(--muted)}
.media-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-top:10px}
.media-card{border:1px solid var(--line);border-radius:8px;background:var(--surface);overflow:hidden}
.media-card img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;background:#eceff1}
.media-card .cap{padding:8px 10px;font-size:13px}
.media-card .cap a{font-size:12px}
pre.json{background:#10161b;color:#d7e2ea;border-radius:8px;padding:14px;overflow:auto;font:12px/1.5 Consolas,"Courier New",monospace;max-height:70vh}
.copy{float:right;margin:0 0 8px 8px;border:1px solid var(--line2);background:var(--surface);border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer}
.note{background:var(--warm-soft);border:1px solid #e7c9a0;border-radius:8px;padding:10px 14px;font-size:13px;color:#6b3a00}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-top:10px}
footer{margin-top:24px;color:var(--muted);font-size:12px}
@media (max-width:760px){.bar{padding:10px 14px}.links{margin-left:0;width:100%}header{position:static}nav.tabs{position:sticky;top:0}.hero h1{font-size:19px}.stat b{font-size:18px}}
`;

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function domainFromUrl(url) {
  try {
    return new URL(String(url || '')).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function safeFieldMapName(key) {
  const cleaned = clean(key || 'sample').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, '_').slice(0, 80);
  return cleaned || 'sample';
}

export function collectFieldMapSamples(dataset) {
  const out = new Map();
  for (const sample of dataset.samples || []) {
    if (!sample.ok || !sample.result || !sample.result.answer?.text) continue;
    const key = sample.question_id || sample.sample_id || sample.question || 'sample';
    if (!out.has(key)) out.set(key, sample);
  }
  return Array.from(out.entries());
}

function bars(rows) {
  if (!rows.length) return '<p class="muted">无数据</p>';
  const maximum = Math.max(...rows.map((row) => row[1])) || 1;
  return rows.map(([name, count]) => {
    const width = (count / maximum) * 100;
    return `<div class="bar-row"><span>${esc(name)}</span><div class="bar-track"><div class="bar-fill" style="width:${width.toFixed(1)}%"></div></div><span class="n">${count}</span></div>`;
  }).join('');
}

function inlineRichText(text) {
  let value = String(text || '');
  value = value.replace(/\[\]\(@mark_underline=\d+\)/g, '');
  value = value.replace(/\[\]\(@[a-z_]+=[^)]*\)/g, '');
  value = value.replace(/\[([^\]\n]{1,220})\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => `<a href="${esc(url)}">${esc(label)}</a>`);
  value = value.replace(/\[citation:(\d+)\]/g, (_, num) => `<span class="cite" data-ref="${Number(num)}">[${Number(num)}]</span>`);
  value = value.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return value;
}

function renderAnswer(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  let list = '';
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = '';
    }
  };
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    if (line.trim().startsWith('### ')) {
      closeList();
      out.push(`<h3>${inlineRichText(line.trim().slice(4))}</h3>`);
    } else if (line.trim().startsWith('## ')) {
      closeList();
      out.push(`<h2>${inlineRichText(line.trim().slice(3))}</h2>`);
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (list !== 'ul') {
        closeList();
        out.push('<ul>');
        list = 'ul';
      }
      out.push(`<li>${inlineRichText(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
    } else if (/^\s*\d+[.、)]\s+/.test(line)) {
      if (list !== 'ol') {
        closeList();
        out.push('<ol>');
        list = 'ol';
      }
      out.push(`<li>${inlineRichText(line.replace(/^\s*\d+[.、)]\s+/, ''))}</li>`);
    } else {
      closeList();
      out.push(`<p>${inlineRichText(line)}</p>`);
    }
  }
  closeList();
  return out.join('\n');
}

export function renderFieldMapHtml(sample, dataset, options = {}) {
  const result = sample.result || {};
  const question = clean(sample.question || result.question || '');
  const answerText = String(result.answer?.text || '');
  const refs = Array.isArray(result.references?.items) ? result.references.items : [];
  const conversation = result.conversation || {};
  const share = result.share || {};
  const chat = result.chat || {};
  const media = Array.isArray(result.media) ? result.media : [];
  const transport = clean(result.transport) || 'unknown';
  const collected = clean(result.collected_at);
  const refIndex = new Set(refs.map((r) => Number(r.number || r.index)).filter((n) => Number.isFinite(n)));

  const domainCounts = {};
  const sourceTypeCounts = {};
  for (const ref of refs) {
    const domain = domainFromUrl(ref.url) || 'unknown';
    domainCounts[domain] = (domainCounts[domain] || 0) + 1;
    const type = clean(ref.source_type) || 'unknown';
    sourceTypeCounts[type] = (sourceTypeCounts[type] || 0) + 1;
  }
  const domainRows = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]);
  const sourceRows = Object.entries(sourceTypeCounts).sort((a, b) => b[1] - a[1]);

  const fieldRows = [
    ['样本 ID', 'sample_id', sample.sample_id, '样本去重键'],
    ['问题 ID', 'question_id', sample.question_id, '与问题清单对应'],
    ['问题文本', 'question', question, '关键词与意图分析'],
    ['采样状态', 'ok / status', `${sample.ok} / ${sample.status}`, '无效样本不计入概率'],
    ['采集通道', 'transport', transport, '区分网页端直采与公开分享解析'],
    ['采集时间', 'collected_at', collected, '采样时间与内容时效'],
    ['会话链接', 'conversation.url', conversation.url, '审计证据（需登录态可打开）'],
    ['模型', 'chat.chat_model_id / chat.model_id', `${chat.chat_model_id || conversation.model || ''} / ${chat.model_id || conversation.model_id || ''}`, '回答来源模型'],
    ['分享短链', 'share.url', share.url, '公开可解析的分享链接'],
    ['分享 ID', 'share.share_id', share.share_id, '公开分享唯一标识'],
    ['回答字数', 'answer.char_count / length', String(result.answer?.char_count ?? result.answer?.length ?? answerText.length), '回答规模'],
    ['引用数', 'references.count', String(refs.length), '信源规模'],
  ];
  const fieldTbody = fieldRows.map(([k, f, v, use]) =>
    `<tr><td>${esc(k)}</td><td class="fld">${esc(f)}</td><td class="val">${esc(v)}</td><td>${esc(use)}</td></tr>`
  ).join('');

  const refTbody = refs.map((r) =>
    `<tr class="ref-row" data-ref="${esc(r.number ?? r.index)}"><td>${esc(r.number ?? r.index)}</td>`
    + `<td>${esc(r.web_site_name || r.source_name || r.source)}</td><td class="fld">${esc(domainFromUrl(r.url))}</td>`
    + `<td>${esc(r.title)}</td><td>${esc(r.source_type)}</td><td>${esc((r.quote || r.summary || '').slice(0, 140))}</td>`
    + `<td><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url).slice(0, 70)}</a></td></tr>`
  ).join('');

  const mediaCards = media.map((m, i) =>
    `<div class="media-card"><img src="${esc(m.url)}" alt="${esc(m.description)}" loading="lazy"/>`
    + `<div class="cap">${esc(m.description || `媒体${i + 1}`)}<br/><a href="${esc(m.jump_url)}" target="_blank" rel="noopener">打开原文</a></div></div>`
  ).join('');

  const limits = [
    ['Token 用量', '页面未暴露真实 usage，无法估算成本'],
    ['深度思考过程', '开启思考模式时是否随分享暴露待实测'],
    ['搜索子查询', '只给 docs，不暴露子查询拆解'],
    ['会话多轮完整性', '单条分享通常只含一问一答'],
    ['精确引用位置映射', '正文只有 [citation:N] 编号，可近似对应 docs[index]'],
  ];
  const limitsTbody = limits.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');

  const entities = media.map((m) => m.description).filter(Boolean);

  const answerHtml = renderAnswer(answerText).replace(/__MEDIA_[a-z0-9_]+__/g, '');
  const mediaBlock = mediaCards ? `<div class="media-grid">${mediaCards}</div>` : '';

  const title = options.title || `腾讯元宝 数据字段地图 · ${sample.question_id || question || 'sample'}`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <div class="bar">
    <div class="brand">腾讯元宝 · 单问题数据字段地图<small>字段 → 实际值 → 分析方法</small></div>
    <div class="links">
      <span class="pill">问题 <b>${esc(sample.question_id || 'sample')}</b></span>
      <span class="pill">通道 <b>${esc(transport)}</b></span>
      <span class="pill">引用 <b>${refs.length}</b></span>
      <span class="pill">媒体 <b>${media.length}</b></span>
    </div>
  </div>
</header>
<div class="wrap">
  <div class="hero">
    <h1>${esc(question)}</h1>
    <p>本页为本次采集该问题的第一份有效样本数据字段地图，包含样本级、回答级、引用级与媒体级字段，以及从数据中可推导的 GEO 分析信号。</p>
    <div class="sources">
      <div class="source"><div class="k">采集通道</div><div class="v"><span class="fld">${esc(transport)}</span><span class="tag ok">已记录</span></div></div>
      <div class="source"><div class="k">会话链接（需登录态）</div><div class="v"><a href="${esc(conversation.url)}" target="_blank" rel="noopener">${esc(conversation.url)}</a></div></div>
      <div class="source"><div class="k">公开分享链接</div><div class="v"><a href="${esc(share.url)}" target="_blank" rel="noopener">${esc(share.url)}</a><span class="tag ${share.url ? 'ok' : 'no'}">${share.url ? '可解析' : '无'}</span></div></div>
    </div>
    <div class="stats">
      <div class="stat"><b>${refs.length}</b><span>引用信源</span></div>
      <div class="stat"><b>${media.length}</b><span>媒体图片</span></div>
      <div class="stat"><b>${domainRows.length}</b><span>唯一域名</span></div>
      <div class="stat"><b>${answerText.length}</b><span>回答字数</span></div>
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
    <div class="panel"><h2>一、样本 / 会话级字段</h2><p class="muted">这些字段描述本次样本本身，决定它能否作为一次独立样本进入测评库。</p>
      <div class="table-wrap"><table><thead><tr><th style="width:120px">数据来源</th><th style="width:200px">字段</th><th style="width:330px">本次实际值</th><th>如何分析 / 用途</th></tr></thead><tbody>${fieldTbody}</tbody></table></div></div>
    <div class="panel"><h2>二、引用级字段</h2><p class="muted">引用是 GEO 分析最重要的一层。</p>
      <div class="table-wrap"><table><thead><tr><th>#</th><th>站点</th><th>域名</th><th>标题</th><th>类型</th><th>摘要片段</th><th>链接</th></tr></thead><tbody>${refTbody}</tbody></table></div></div>
    <div class="panel"><h2>三、媒体级字段</h2><p class="muted">回答中的图片卡片（公开分享解析通道可提供）。</p>${mediaBlock || '<p class="muted">本次样本无媒体字段。</p>'}</div>
    <div class="panel"><h2>四、当前提取不到 / 受限的信息</h2><p class="muted">明确边界，避免把这份数据误当成完整会话证据。</p>
      <div class="table-wrap"><table><thead><tr><th style="width:240px">信息</th><th>现状与影响</th></tr></thead><tbody>${limitsTbody}</tbody></table></div></div>
  </section>
  <section class="tab" id="tab-answer">
    <div class="panel"><h2>回答正文与引用的一一映射</h2><p class="muted">点击回答里的 <span class="cite">[N]</span> 会跳到引用明细页对应行并高亮。</p>
      <div class="legend"><span>■ 用户消息</span><span>■ 助手回答</span><span>引用编号 = 引用明细页编号</span></div>
      <div class="msg user"><div class="meta"><span>Role: <b>User</b></span></div><div class="answer">${esc(question)}</div></div>
      <div class="msg assistant"><div class="meta"><span>Role: <b>Assistant</b></span><span>通道: <b>${esc(transport)}</b></span></div>
      <div class="answer">${answerHtml}</div>${mediaBlock}</div>
    </div>
  </section>
  <section class="tab" id="tab-refs">
    <div class="panel"><h2>${refs.length} 条引用信源明细</h2>
      <div class="table-wrap"><table id="refTable"><thead><tr><th>#</th><th>站点</th><th>域名</th><th>标题</th><th>类型</th><th>摘要片段</th><th>链接</th></tr></thead>
      <tbody>${refTbody}</tbody></table></div></div>
  </section>
  <section class="tab" id="tab-derive">
    <div class="panel"><h2>从这份数据可以推导出的分析结果</h2><p class="muted">这些不是采集器直接给的字段，而是基于上面字段计算的 GEO 指标。</p>
      <div class="grid2">
        <div class="card"><h4>信源域名分布</h4>${bars(domainRows)}</div>
        <div class="card"><h4>信源渠道分类</h4>${bars(sourceRows)}</div>
        <div class="card"><h4>回答结构</h4><ul><li>回答字数：${answerText.length}</li><li>引用编号：${refs.length}</li><li>媒体图片：${media.length}</li><li>唯一域名：${domainRows.length}</li></ul></div>
        <div class="card"><h4>回答中出现的实体/地点</h4><ul>${entities.map((e) => `<li>${esc(e)}</li>`).join('') || '<li class="muted">无媒体实体</li>'}</ul></div>
      </div>
      <div class="note">单条样本只能描述“这一次回答引用了什么”；Top1/Top3、提及率等指标仍需多轮重复采样聚合。</div>
    </div>
  </section>
  <section class="tab" id="tab-raw">
    <div class="panel"><h2>原始样本 JSON</h2>
      <button class="copy" data-copy="rawJson">复制 JSON</button>
      <pre class="json" id="rawJson">${esc(JSON.stringify(result, null, 2))}</pre>
    </div>
  </section>
  <footer>由 yuanbao-crawler-web 生成 · 单问题数据字段地图 · ${new Date().toISOString()}</footer>
</div>
<script>
(function () {
  const tabs = document.querySelectorAll('nav.tabs button');
  const sections = document.querySelectorAll('section.tab');
  tabs.forEach(function (button) {
    button.addEventListener('click', function () {
      tabs.forEach(function (b) { b.classList.remove('active'); });
      sections.forEach(function (s) { s.classList.remove('active'); });
      button.classList.add('active');
      document.getElementById('tab-' + button.dataset.tab).classList.add('active');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
  document.querySelectorAll('.cite').forEach(function (cite) {
    cite.addEventListener('click', function () {
      document.querySelector('button[data-tab="refs"]').click();
      const row = document.querySelector('.ref-row[data-ref="' + cite.dataset.ref + '"]');
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.add('flash');
        setTimeout(function () { row.classList.remove('flash'); }, 1600);
      }
    });
  });
  const copyBtn = document.querySelector('[data-copy="rawJson"]');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      const text = document.getElementById('rawJson').textContent;
      navigator.clipboard.writeText(text).then(function () {
        copyBtn.textContent = '已复制';
        setTimeout(function () { copyBtn.textContent = '复制 JSON'; }, 1500);
      });
    });
  }
})();
</script>
</body>
</html>`;
}

export function writeFieldMaps(dataset, outDir, options = {}) {
  const fieldMapDir = path.join(outDir, 'field-maps');
  fs.mkdirSync(fieldMapDir, { recursive: true });
  const files = [];
  for (const [key, sample] of collectFieldMapSamples(dataset)) {
    const html = renderFieldMapHtml(sample, dataset, {
      title: options.titlePrefix ? `${options.titlePrefix} · ${sample.question_id || sample.sample_id || 'sample'}` : undefined,
    });
    if (!html) continue;
    const file = path.join(fieldMapDir, `${safeFieldMapName(key)}-data-map.html`);
    fs.writeFileSync(file, html, 'utf8');
    files.push(file);
  }
  return { dir: fieldMapDir, files };
}
