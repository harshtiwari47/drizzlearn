import React, { useEffect, useRef, useState } from "react";

const SAFE_URL_RE = /^(?:https?:\/\/|mailto:)/i;
const CITATION_RE = /^\[((?:note|lesson|attempt|flashcard):[^\]\n]{1,120})\]/i;
const HEADING_RE = /^(#{1,4})\s+(.+?)\s*#*$/;
const HR_RE = /^\s*(?:[-*_]\s*){3,}$/;
const FENCE_RE = /^\s*(`{3,}|~{3,})\s*([^\s`~]*)\s*$/;
const UL_RE = /^(\s*)[-*+]\s+(.*)$/;
const OL_RE = /^(\s*)\d+[.)]\s+(.*)$/;
const TABLE_SEP_RE = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$|^\s*\|\s*:?-{3,}:?\s*\|\s*$/;

function isSafeLinkUrl(rawUrl) {
  if (typeof rawUrl !== "string") return false;
  const trimmed = rawUrl.trim();
  if (!trimmed || /[\u0000-\u001F\s]/.test(trimmed)) return false;
  return SAFE_URL_RE.test(trimmed);
}

function splitTableRow(line) {
  let trimmed = String(line || "").trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) trimmed = trimmed.slice(0, -1);

  const cells = [];
  let current = "";
  let inCode = false;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === "\\" && i + 1 < trimmed.length && trimmed[i + 1] === "|") {
      current += "|";
      i += 1;
      continue;
    }
    if (ch === "`") {
      inCode = !inCode;
      current += ch;
      continue;
    }
    if (ch === "|" && !inCode) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function parseTableAlignments(sepLine) {
  return splitTableRow(sepLine).map((cell) => {
    const t = cell.trim();
    const left = t.startsWith(":");
    const right = t.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return undefined;
  });
}

function findClosingDelimiter(text, startIndex, delimiter) {
  const len = delimiter.length;
  for (let i = startIndex; i <= text.length - len; i += 1) {
    if (text[i] === "\\") {
      i += 1;
      continue;
    }
    if (text[i] === "`") {
      const closeCode = text.indexOf("`", i + 1);
      if (closeCode >= 0) {
        i = closeCode;
        continue;
      }
    }
    if (text.slice(i, i + len) === delimiter) {
      if (i > startIndex && text[i - 1] !== " ") {
        return i;
      }
    }
  }
  return -1;
}

function renderInline(text, keyPrefix = "in", depth = 0) {
  if (!text) return null;
  if (depth > 4) return text;

  const nodes = [];
  let buffer = "";
  let i = 0;
  let tokenIdx = 0;

  const flushBuffer = () => {
    if (buffer) {
      nodes.push(buffer);
      buffer = "";
    }
  };

  while (i < text.length) {
    const ch = text[i];

    // Escaped punctuation
    if (ch === "\\" && i + 1 < text.length && /[\\`*_{}[\]()#+\-.!~|]/.test(text[i + 1])) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }

    // Inline code
    if (ch === "`") {
      let tickCount = 1;
      while (text[i + tickCount] === "`") tickCount += 1;
      const fence = "`".repeat(tickCount);
      const end = text.indexOf(fence, i + tickCount);
      if (end >= 0) {
        flushBuffer();
        const codeText = text.slice(i + tickCount, end);
        nodes.push(
          <code key={`${keyPrefix}-code-${tokenIdx++}`} className="tutor-inline-code">
            {codeText}
          </code>
        );
        i = end + tickCount;
        continue;
      }
    }

    // Workspace citation badge: [note:uuid], [lesson:uuid], [attempt:uuid], [flashcard:uuid]
    if (ch === "[") {
      const slice = text.slice(i);
      const citeMatch = slice.match(CITATION_RE);
      if (citeMatch && text[i + citeMatch[0].length] !== "(") {
        flushBuffer();
        nodes.push(
          <code key={`${keyPrefix}-cite-${tokenIdx++}`} className="tutor-citation-badge">
            {citeMatch[0]}
          </code>
        );
        i += citeMatch[0].length;
        continue;
      }

      // Markdown link [label](url)
      const closeBracket = text.indexOf("]", i + 1);
      if (closeBracket > i + 1 && text[closeBracket + 1] === "(") {
        const closeParen = text.indexOf(")", closeBracket + 2);
        if (closeParen > closeBracket + 2) {
          const label = text.slice(i + 1, closeBracket);
          const rawHref = text.slice(closeBracket + 2, closeParen).trim();
          flushBuffer();
          if (isSafeLinkUrl(rawHref)) {
            nodes.push(
              <a
                key={`${keyPrefix}-link-${tokenIdx++}`}
                href={rawHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                {renderInline(label, `${keyPrefix}-l${tokenIdx}`, depth + 1)}
              </a>
            );
          } else {
            nodes.push(label);
          }
          i = closeParen + 1;
          continue;
        }
      }
    }

    // Bold (**...**)
    if (text.startsWith("**", i) && text[i + 2] && text[i + 2] !== " ") {
      const end = findClosingDelimiter(text, i + 2, "**");
      if (end > i + 2) {
        flushBuffer();
        nodes.push(
          <strong key={`${keyPrefix}-b-${tokenIdx++}`}>
            {renderInline(text.slice(i + 2, end), `${keyPrefix}-b${tokenIdx}`, depth + 1)}
          </strong>
        );
        i = end + 2;
        continue;
      }
    }

    // Strikethrough (~~...~~)
    if (text.startsWith("~~", i) && text[i + 2] && text[i + 2] !== " ") {
      const end = findClosingDelimiter(text, i + 2, "~~");
      if (end > i + 2) {
        flushBuffer();
        nodes.push(
          <del key={`${keyPrefix}-s-${tokenIdx++}`}>
            {renderInline(text.slice(i + 2, end), `${keyPrefix}-s${tokenIdx}`, depth + 1)}
          </del>
        );
        i = end + 2;
        continue;
      }
    }

    // Italic (*...*)
    if (ch === "*" && text[i + 1] !== "*" && text[i + 1] && text[i + 1] !== " ") {
      const end = findClosingDelimiter(text, i + 1, "*");
      if (end > i + 1) {
        flushBuffer();
        nodes.push(
          <em key={`${keyPrefix}-em-${tokenIdx++}`}>
            {renderInline(text.slice(i + 1, end), `${keyPrefix}-em${tokenIdx}`, depth + 1)}
          </em>
        );
        i = end + 1;
        continue;
      }
    }

    buffer += ch;
    i += 1;
  }

  flushBuffer();
  return nodes.length === 1 ? nodes[0] : nodes;
}

function CodeBlock({ language, code }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function handleCopy() {
    let ok = false;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok && typeof document !== "undefined") {
      try {
        const ta = document.createElement("textarea");
        ta.value = code;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1800);
    }
  }

  return (
    <div className="tutor-code-block">
      <div className="tutor-code-header">
        <span className="tutor-code-lang">{language || "code"}</span>
        <button
          type="button"
          className="tutor-code-copy"
          onClick={handleCopy}
          aria-label={`Copy ${language || "code"} snippet`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function isBlockStarter(lines, index) {
  const line = lines[index];
  if (!line || !line.trim()) return true;
  if (FENCE_RE.test(line)) return true;
  if (HEADING_RE.test(line)) return true;
  if (HR_RE.test(line)) return true;
  if (/^\s*>\s?/.test(line)) return true;
  if (UL_RE.test(line) || OL_RE.test(line)) return true;
  if (line.includes("|") && index + 1 < lines.length && TABLE_SEP_RE.test(lines[index + 1])) return true;
  return false;
}

function parseBlocks(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Fenced code block
    const fenceMatch = line.match(FENCE_RE);
    if (fenceMatch) {
      const fenceChars = fenceMatch[1];
      const fenceChar = fenceChars[0];
      const fenceLen = fenceChars.length;
      const language = fenceMatch[2] || "";
      const codeLines = [];
      i += 1;
      while (i < lines.length) {
        const closeLine = lines[i].trim();
        if (
          closeLine.startsWith(fenceChar.repeat(fenceLen)) &&
          new RegExp(`^${fenceChar}{${fenceLen},}\\s*$`).test(closeLine)
        ) {
          i += 1;
          break;
        }
        codeLines.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: "code", language, code: codeLines.join("\n") });
      continue;
    }

    // Heading (# .. ####)
    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      blocks.push({ type: "heading", level: headingMatch[1].length, text: headingMatch[2] });
      i += 1;
      continue;
    }

    // Horizontal rule
    if (HR_RE.test(line)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    // GFM Table
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      const headers = splitTableRow(line);
      const alignments = parseTableAlignments(lines[i + 1]);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|") && !FENCE_RE.test(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: "table", headers, alignments, rows });
      continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "blockquote", text: quoteLines.join("\n") });
      continue;
    }

    // Unordered or ordered list
    const ulMatch = line.match(UL_RE);
    const olMatch = !ulMatch && line.match(OL_RE);
    if (ulMatch || olMatch) {
      const ordered = Boolean(olMatch);
      const itemRegex = ordered ? OL_RE : UL_RE;
      const items = [];
      while (i < lines.length) {
        const match = lines[i].match(itemRegex);
        if (!match) break;
        const itemLines = [match[2]];
        i += 1;
        while (
          i < lines.length &&
          lines[i].trim() &&
          !isBlockStarter(lines, i)
        ) {
          itemLines.push(lines[i].trim());
          i += 1;
        }
        items.push(itemLines.join(" "));
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    // Paragraph
    const paraLines = [line.trim()];
    i += 1;
    while (i < lines.length && !isBlockStarter(lines, i)) {
      paraLines.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ type: "paragraph", text: paraLines.join(" ") });
  }

  return blocks;
}

/**
 * Safe pure-React Markdown renderer for AI Tutor responses.
 * Renders blocks (headings, code blocks with copy button, GFM tables, lists, blockquotes, hr, paragraphs)
 * and inline formatting without dangerouslySetInnerHTML.
 */
export function TutorMarkdown({ content, className = "" }) {
  if (content === null || content === undefined) return null;
  const text = String(content);
  if (!text.trim()) return null;

  const blocks = parseBlocks(text);

  return (
    <div className={`tutor-markdown ${className}`.trim()}>
      {blocks.map((block, idx) => {
        const key = `md-${idx}`;
        if (block.type === "code") {
          return <CodeBlock key={key} language={block.language} code={block.code} />;
        }
        if (block.type === "heading") {
          const Tag = `h${Math.min(4, Math.max(1, block.level))}`;
          return <Tag key={key}>{renderInline(block.text, key)}</Tag>;
        }
        if (block.type === "hr") {
          return <hr key={key} />;
        }
        if (block.type === "blockquote") {
          return (
            <blockquote key={key}>
              {block.text.split("\n").map((line, lIdx) => (
                <p key={`${key}-q-${lIdx}`}>{renderInline(line, `${key}-q-${lIdx}`)}</p>
              ))}
            </blockquote>
          );
        }
        if (block.type === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag key={key}>
              {block.items.map((item, itemIdx) => (
                <li key={`${key}-li-${itemIdx}`}>{renderInline(item, `${key}-li-${itemIdx}`)}</li>
              ))}
            </ListTag>
          );
        }
        if (block.type === "table") {
          return (
            <div key={key} className="tutor-table-wrap">
              <table>
                <thead>
                  <tr>
                    {block.headers.map((header, hIdx) => (
                      <th key={`${key}-th-${hIdx}`} style={block.alignments[hIdx] ? { textAlign: block.alignments[hIdx] } : undefined}>
                        {renderInline(header, `${key}-th-${hIdx}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rIdx) => (
                    <tr key={`${key}-tr-${rIdx}`}>
                      {block.headers.map((_, cIdx) => (
                        <td key={`${key}-td-${rIdx}-${cIdx}`} style={block.alignments[cIdx] ? { textAlign: block.alignments[cIdx] } : undefined}>
                          {renderInline(row[cIdx] || "", `${key}-td-${rIdx}-${cIdx}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={key}>{renderInline(block.text, key)}</p>;
      })}
    </div>
  );
}
