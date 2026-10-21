import { esc, fmtDate, formatNumber, icon } from "../../shared/state.js";

export function splitMarkdownTableRow(line) {
  const trimmed = String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, "|").trim());
}

export function isMarkdownTableDelimiter(line) {
  if (!line || !line.includes("-")) return false;
  const trimmed = String(line).trim();
  if (!trimmed.includes("|")) return false;
  const cells = splitMarkdownTableRow(trimmed);
  return cells.length >= 1 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

const markdownCache = new Map();
let markdownCacheSize = 0;

export function renderMarkdown(source) {
  const key = String(source || "");
  if (markdownCache.has(key)) {
    const cached = markdownCache.get(key);
    markdownCache.delete(key);
    markdownCache.set(key, cached);
    return cached;
  }
  const html = buildMarkdown(key);
  const size = key.length + html.length;
  if (size <= 256_000) {
    while (markdownCache.size && (markdownCache.size >= 128 || markdownCacheSize + size > 2_000_000)) {
      const oldest = markdownCache.keys().next().value;
      markdownCacheSize -= oldest.length + markdownCache.get(oldest).length;
      markdownCache.delete(oldest);
    }
    markdownCache.set(key, html);
    markdownCacheSize += size;
  }
  return html;
}

export function buildMarkdown(source) {
  const lines = String(source || "").split(/\r?\n/);
  const html = [];
  let paragraph = [], listType = "", codeLines = [], inCode = false, codeIndent = 0;
  const inline = (text) => esc(text).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>").replace(/\[([^\]]+)\]\(((?:https?:\/\/|obsidian:\/\/|#)[^ ")<>']+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  const flushParagraph = () => { if (paragraph.length) { html.push(`<p>${paragraph.map(inline).join("<br>")}</p>`); paragraph = []; } };
  const closeList = () => { if (listType) { html.push(`</${listType}>`); listType = ""; } };
  let headingIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^(\s*)```/);
    if (fenceMatch) {
      flushParagraph(); closeList();
      if (inCode) {
        html.push(`<pre><code>${esc(codeLines.join("\n"))}</code></pre>`);
        codeLines = []; inCode = false; codeIndent = 0;
      } else {
        inCode = true;
        codeIndent = fenceMatch[1].length;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(codeIndent > 0 ? line.replace(new RegExp(`^ {0,${codeIndent}}`), "") : line);
      continue;
    }
    if (!line.trim()) { flushParagraph(); continue; }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushParagraph(); closeList(); html.push("<hr>"); continue; }
    if (line.includes("|") && i + 1 < lines.length && isMarkdownTableDelimiter(lines[i + 1])) {
      flushParagraph(); closeList();
      const headers = splitMarkdownTableRow(line);
      const aligns = splitMarkdownTableRow(lines[i + 1]).map((c) => {
        const align = (c.startsWith(":") && c.endsWith(":")) ? "center" : c.endsWith(":") ? "right" : "left";
        return ["left", "center", "right"].includes(align) ? align : "left";
      });
      i += 2;
      const bodyRows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|") && !/^\s*```/.test(lines[i]) && !/^(#{1,6})\s+/.test(lines[i])) {
        bodyRows.push(splitMarkdownTableRow(lines[i]));
        i++;
      }
      i--;
      const theadHtml = `<thead><tr>${headers.map((h, colIdx) => `<th${["left", "center", "right"].includes(aligns[colIdx]) && aligns[colIdx] !== "left" ? ` style="text-align:${aligns[colIdx]}"` : ""}>${inline(h)}</th>`).join("")}</tr></thead>`;
      const tbodyHtml = bodyRows.length
        ? `<tbody>${bodyRows.map((row) => `<tr>${headers.map((_, colIdx) => `<td${["left", "center", "right"].includes(aligns[colIdx]) && aligns[colIdx] !== "left" ? ` style="text-align:${aligns[colIdx]}"` : ""}>${inline(row[colIdx] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody>`
        : "";
      html.push(`<div class="md-table-wrap"><table class="md-table">${theadHtml}${tbodyHtml}</table></div>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    if (heading) { flushParagraph(); closeList(); const level = Math.min(heading[1].length, 4); html.push(`<h${level} data-kb-heading="${headingIdx++}">${inline(heading[2])}</h${level}>`); continue; }
    if (bullet || ordered) {
      flushParagraph();
      const nextType = bullet ? "ul" : "ol";
      if (listType !== nextType) { closeList(); listType = nextType; html.push(`<${listType}>`); }
      if (ordered) {
        html.push(`<li value="${Number(ordered[1])}">${inline(ordered[2])}</li>`);
      } else {
        html.push(`<li>${inline(bullet[1])}</li>`);
      }
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/); if (quote) { flushParagraph(); closeList(); html.push(`<blockquote>${inline(quote[1])}</blockquote>`); continue; }
    closeList(); paragraph.push(line);
  }
  flushParagraph(); closeList();
  if (inCode) html.push(`<pre><code>${esc(codeLines.join("\n"))}</code></pre>`);
  return html.join("") || `<p class="file-empty">Tệp Markdown đang trống.</p>`;
}

export function extractMarkdownOutline(source) {
  const lines = String(source || "").split(/\r?\n/);
  const outline = [];
  let inCode = false;
  let idx = 0;
  for (const line of lines) {
    if (/^\s*```/.test(line)) { inCode = !inCode; continue; }
    if (inCode) continue;
    const m = line.match(/^(#{1,4})\s+(.+)$/);
    if (m) {
      outline.push({ index: idx++, level: m[1].length, text: m[2].replace(/[*_`~[\]]/g, "").trim() });
    }
  }
  return outline;
}

export function renderKnowledgeMarkdown(source) {
  const baseHtml = renderMarkdown(source);
  return baseHtml.replace(/\[\[([^\]|#<>\r\n]+)(?:#[^\]|<>\r\n]*)?(?:\|([^\]<>\r\n]+))?\]\]/g, (_, target, alias) => {
    const label = (alias || target).trim();
    const cleanTarget = target.trim();
    return `<button type="button" class="vault-wikilink" data-action="vault-open-wikilink" data-target="${esc(cleanTarget)}" title="Mở liên kết tri thức: ${esc(cleanTarget)}">${icon("file", 12)}<span>${esc(label)}</span></button>`;
  });
}

export function filePreviewMarkup(file, title = "Chọn một tệp để xem") {
  if (!file) return `<div class="file-preview-empty">${icon("file", 18)}<p>${title}</p></div>`;
  const markdown = [".md", ".mdx", ".markdown"].includes(file.extension);
  const body = markdown
    ? `<article class="markdown-preview">${renderMarkdown(file.content)}</article>`
    : `<pre class="code-preview"><code>${esc(file.content)}</code></pre>`;
  return `<header class="file-preview-head"><div><strong>${esc(file.name)}</strong><small>${markdown ? "Markdown" : file.extension || "Tệp văn bản"} · ${formatNumber(file.size)} B · ${fmtDate(file.modifiedAt)}</small></div></header>${body}`;
}

export function renderCsvTableMarkup(content = "", delimiter = ",") {
  const rows = String(content || "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, 200)
    .map((line) => line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, "")));
  if (!rows.length) return `<div class="orca-viewer-empty"><p>Tệp dữ liệu trống.</p></div>`;
  const header = rows[0] || [];
  const bodyRows = rows.slice(1);
  return `<div class="orca-table-scroll">
    <table class="orca-data-table">
      <thead>
        <tr>
          <th class="is-row-num">#</th>
          ${header.map((col) => `<th>${esc(col)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${bodyRows.map((cols, idx) => `<tr>
          <td class="is-row-num">${idx + 1}</td>
          ${header.map((_, cIdx) => `<td>${esc(cols[cIdx] ?? "")}</td>`).join("")}
        </tr>`).join("")}
      </tbody>
    </table>
  </div>`;
}

export function formatCompactBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace(/\.0$/, "")} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}
