import React, { useEffect, useRef, useState } from "react";
import { MathFormula } from "./math-formula.jsx";

const SAFE_URL_RE = /^(?:https?:\/\/|mailto:)/i;
const SAFE_IMAGE_URL_RE = /^(?:https?:\/\/|\/images\/)/i;
const IMAGE_LINE_RE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/;
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

function isSafeImageUrl(rawUrl) {
  if (typeof rawUrl !== "string") return false;
  const trimmed = rawUrl.trim();
  if (!trimmed || /[\u0000-\u001F\s]/.test(trimmed)) return false;
  return SAFE_IMAGE_URL_RE.test(trimmed);
}

function parseImageSpec(rawAlt) {
  const parts = String(rawAlt || "").split("|");
  const cleanAlt = (parts[0] || "").trim();
  let widthHint;
  let heightHint;
  if (parts[1]) {
    const dim = parts[1].trim().match(/^(\d{2,3})(?:x(\d{2,3}))?$/i);
    if (dim) {
      widthHint = Math.min(640, Math.max(48, Number(dim[1])));
      if (dim[2]) heightHint = Math.min(420, Math.max(48, Number(dim[2])));
    }
  }
  return { alt: cleanAlt, widthHint, heightHint };
}

function MarkdownImage({ rawAlt, rawSrc, title = "", inline = false }) {
  const [failed, setFailed] = useState(false);
  const safe = isSafeImageUrl(rawSrc);
  const { alt, widthHint, heightHint } = parseImageSpec(rawAlt);
  const label = alt || title || "Embedded visual";

  if (!safe) {
    return <span className="tutor-md-img-blocked">{label}</span>;
  }

  if (failed) {
    return (
      <span className="tutor-md-img-fallback" role="img" aria-label={label}>
        <span>Image unavailable: {label}</span>
      </span>
    );
  }

  const sizeStyle = {};
  if (widthHint) sizeStyle.maxWidth = `${widthHint}px`;
  if (heightHint) sizeStyle.maxHeight = `${heightHint}px`;

  if (inline) {
    return (
      <img
        src={rawSrc.trim()}
        alt={label}
        title={title || label}
        loading="lazy"
        className="tutor-md-img tutor-md-img-inline"
        style={Object.keys(sizeStyle).length ? sizeStyle : undefined}
        onClick={(e) => e.stopPropagation()}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <figure className="tutor-md-figure" onClick={(e) => e.stopPropagation()}>
      <img
        src={rawSrc.trim()}
        alt={label}
        title={title || label}
        loading="lazy"
        className="tutor-md-img"
        style={Object.keys(sizeStyle).length ? sizeStyle : undefined}
        onError={() => setFailed(true)}
      />
      {alt && <figcaption className="tutor-md-figcaption">{alt}</figcaption>}
    </figure>
  );
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

    // Escaped punctuation (keep \$ literal)
    if (ch === "\\" && i + 1 < text.length && /[\\`*_{}[\]()#+\-.!~|$]/.test(text[i + 1])) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }

    // Inline \(...\) or \[...\] LaTeX math
    if (text.startsWith("\\(", i) || text.startsWith("\\[", i)) {
      const isDisplay = text.startsWith("\\[", i);
      const closeTag = isDisplay ? "\\]" : "\\)";
      const end = text.indexOf(closeTag, i + 2);
      if (end > i + 2) {
        flushBuffer();
        nodes.push(
          <MathFormula
            key={`${keyPrefix}-math-${tokenIdx++}`}
            expr={text.slice(i + 2, end)}
            display={isDisplay}
          />
        );
        i = end + 2;
        continue;
      }
    }

    // Inline $...$ or $$...$$ math (skip currency like "$50" or "$5 to $10")
    if (ch === "$") {
      const isDouble = text[i + 1] === "$";
      const delim = isDouble ? "$$" : "$";
      const start = i + delim.length;
      if (start < text.length && (isDouble || !/\s/.test(text[start]))) {
        let end = -1;
        for (let j = start; j <= text.length - delim.length; j += 1) {
          if (text[j] === "\\") {
            j += 1;
            continue;
          }
          if (text.startsWith(delim, j)) {
            if (isDouble || (j > start && !/\s/.test(text[j - 1]) && !/[0-9]/.test(text[j + 1] || ""))) {
              end = j;
              break;
            }
          }
        }
        if (end > start) {
          const expr = text.slice(start, end);
          // Avoid false positives on two currency amounts "$10 ... $20"
          const looksCurrency = !isDouble && /^\d+(?:[.,]\d+)?(?:\s|$)/.test(expr) && /\s/.test(expr);
          if (!looksCurrency) {
            flushBuffer();
            nodes.push(
              <MathFormula
                key={`${keyPrefix}-math-${tokenIdx++}`}
                expr={expr}
                display={isDouble}
              />
            );
            i = end + delim.length;
            continue;
          }
        }
      }
    }

    // Inline Markdown image: ![alt](url)
    if (ch === "!" && text[i + 1] === "[") {
      const closeBracket = text.indexOf("]", i + 2);
      if (closeBracket >= i + 2 && text[closeBracket + 1] === "(") {
        const closeParen = text.indexOf(")", closeBracket + 2);
        if (closeParen > closeBracket + 2) {
          const rawAlt = text.slice(i + 2, closeBracket);
          const innerSpec = text.slice(closeBracket + 2, closeParen).trim();
          const titleMatch = innerSpec.match(/^([^\s]+)(?:\s+"([^"]*)")?$/);
          const rawSrc = titleMatch ? titleMatch[1] : innerSpec;
          const imgTitle = titleMatch?.[2] || "";
          flushBuffer();
          nodes.push(
            <MarkdownImage
              key={`${keyPrefix}-img-${tokenIdx++}`}
              rawAlt={rawAlt}
              rawSrc={rawSrc}
              title={imgTitle}
              inline
            />
          );
          i = closeParen + 1;
          continue;
        }
      }
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
  if (/^\s*(?:\$\$|\\\[)/.test(line)) return true;
  if (IMAGE_LINE_RE.test(line.trim())) return true;
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

    // Display math block ($$ ... $$ or \[ ... \])
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith("$$") || trimmedLine.startsWith("\\[")) {
      const closeTag = trimmedLine.startsWith("$$") ? "$$" : "\\]";
      const openLen = 2;
      const singleLineEnd = trimmedLine.indexOf(closeTag, openLen);
      if (singleLineEnd > openLen && singleLineEnd === trimmedLine.length - closeTag.length) {
        blocks.push({ type: "math", expr: trimmedLine.slice(openLen, singleLineEnd).trim() });
        i += 1;
        continue;
      }
      const mathLines = [trimmedLine.slice(openLen)];
      let foundClose = false;
      i += 1;
      while (i < lines.length) {
        const curTrim = lines[i].trim();
        const endPos = curTrim.indexOf(closeTag);
        if (endPos >= 0) {
          mathLines.push(curTrim.slice(0, endPos));
          i += 1;
          foundClose = true;
          break;
        }
        mathLines.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: "math", expr: mathLines.join("\n").trim() });
      if (!foundClose) continue;
      continue;
    }

    // Standalone image figure (![alt](url))
    const imageMatch = trimmedLine.match(IMAGE_LINE_RE);
    if (imageMatch) {
      blocks.push({
        type: "image",
        alt: imageMatch[1] || "",
        src: imageMatch[2] || "",
        title: imageMatch[3] || "",
      });
      i += 1;
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
        if (block.type === "math") {
          return <MathFormula key={key} expr={block.expr} display />;
        }
        if (block.type === "image") {
          return <MarkdownImage key={key} rawAlt={block.alt} rawSrc={block.src} title={block.title} />;
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
