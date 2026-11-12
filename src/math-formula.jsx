import React from "react";

const MATH_SYMBOLS = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ",
  rho: "ρ", sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "ϕ",
  varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π",
  Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓", ast: "∗", star: "⋆",
  le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠",
  approx: "≈", equiv: "≡", sim: "∼", simeq: "≃", cong: "≅", propto: "∝",
  infty: "∞", partial: "∂", nabla: "∇", forall: "∀", exists: "∃", nexists: "∄",
  in: "∈", notin: "∉", ni: "∋", subset: "⊂", subseteq: "⊆", supset: "⊃", supseteq: "⊇",
  cup: "∪", cap: "∩", setminus: "∖", emptyset: "∅", varnothing: "∅",
  to: "→", rightarrow: "→", leftarrow: "←", leftrightarrow: "↔",
  Rightarrow: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔", iff: "⟺", implies: "⟹", mapsto: "↦",
  sum: "∑", prod: "∏", int: "∫", iint: "∬", oint: "∮",
  cdots: "⋯", ldots: "…", dots: "…", vdots: "⋮", therefore: "∴", because: "∵",
  angle: "∠", perp: "⊥", parallel: "∥", degree: "°", circ: "∘",
  land: "∧", lor: "∨", neg: "¬", lnot: "¬",
  langle: "⟨", rangle: "⟩", lceil: "⌈", rceil: "⌉", lfloor: "⌊", rfloor: "⌋",
  quad: "\u2003", qquad: "\u2003\u2003", ",": "\u2009", ";": "\u2005", ":": "\u2004", " ": "\u00a0",
};

const BLACKBOARD_BOLD = {
  R: "ℝ", N: "ℕ", Z: "ℤ", Q: "ℚ", C: "ℂ", P: "ℙ", F: "𝔽", E: "𝔼", H: "ℍ",
};

const OPERATOR_WORDS = new Set([
  "lim", "log", "ln", "lg", "exp", "sin", "cos", "tan", "cot", "sec", "csc",
  "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh",
  "max", "min", "sup", "inf", "arg", "det", "dim", "ker", "gcd", "deg", "mod",
]);

function skipSpaces(str, pos) {
  let i = pos;
  while (i < str.length && /\s/.test(str[i])) i += 1;
  return i;
}

function readBalancedGroup(str, pos) {
  const i = skipSpaces(str, pos);
  if (i >= str.length) return { content: "", nextPos: i };
  if (str[i] === "{") {
    let depth = 1;
    let j = i + 1;
    while (j < str.length && depth > 0) {
      if (str[j] === "\\" && j + 1 < str.length) {
        j += 2;
        continue;
      }
      if (str[j] === "{") depth += 1;
      else if (str[j] === "}") depth -= 1;
      j += 1;
    }
    return { content: str.slice(i + 1, Math.max(i + 1, j - 1)), nextPos: j };
  }
  if (str[i] === "\\") {
    const cmdMatch = str.slice(i + 1).match(/^[a-zA-Z]+/);
    if (cmdMatch) {
      const cmdEnd = i + 1 + cmdMatch[0].length;
      if (["frac", "sqrt", "binom", "text", "mathrm", "mathbf", "mathbb", "vec", "hat", "bar", "overline"].includes(cmdMatch[0])) {
        const arg1 = readBalancedGroup(str, cmdEnd);
        if (cmdMatch[0] === "frac" || cmdMatch[0] === "binom") {
          const arg2 = readBalancedGroup(str, arg1.nextPos);
          return { content: str.slice(i, arg2.nextPos), nextPos: arg2.nextPos };
        }
        return { content: str.slice(i, arg1.nextPos), nextPos: arg1.nextPos };
      }
      return { content: str.slice(i, cmdEnd), nextPos: cmdEnd };
    }
    return { content: str.slice(i, i + 2), nextPos: i + 2 };
  }
  return { content: str[i], nextPos: i + 1 };
}

function readOptionalBracket(str, pos) {
  const i = skipSpaces(str, pos);
  if (str[i] !== "[") return null;
  let j = i + 1;
  while (j < str.length && str[j] !== "]") {
    if (str[j] === "\\") j += 1;
    j += 1;
  }
  if (str[j] !== "]") return null;
  return { content: str.slice(i + 1, j), nextPos: j + 1 };
}

function renderMatrixRows(body, delimType, keyPrefix) {
  const rawRows = body
    .split(/\\\\/)
    .map((r) => r.trim())
    .filter(Boolean);
  const leftDelim = delimType === "bmatrix" ? "[" : delimType === "cases" ? "{" : "(";
  const rightDelim = delimType === "bmatrix" ? "]" : delimType === "cases" ? "" : ")";
  return (
    <span key={keyPrefix} className={`tutor-math-matrix kind-${delimType}`}>
      <span className="tutor-math-delim" aria-hidden="true">{leftDelim}</span>
      <span className="tutor-math-matrix-grid">
        {rawRows.map((rowStr, rIdx) => {
          const cells = rowStr.split("&").map((c) => c.trim());
          return (
            <span key={`${keyPrefix}-r-${rIdx}`} className="tutor-math-matrix-row">
              {cells.map((cell, cIdx) => (
                <span key={`${keyPrefix}-c-${rIdx}-${cIdx}`} className="tutor-math-matrix-cell">
                  {parseMathNodes(cell, `${keyPrefix}-m-${rIdx}-${cIdx}`)}
                </span>
              ))}
            </span>
          );
        })}
      </span>
      {rightDelim && <span className="tutor-math-delim" aria-hidden="true">{rightDelim}</span>}
    </span>
  );
}

function parseMathNodes(expr, keyPrefix = "m", depth = 0) {
  if (!expr) return [];
  if (depth > 8) return [expr];
  const src = String(expr);
  const nodes = [];
  let i = 0;
  let idx = 0;

  while (i < src.length) {
    const ch = src[i];

    // Environment blocks: \begin{pmatrix}...\end{pmatrix}
    if (src.startsWith("\\begin{", i)) {
      const closeBrace = src.indexOf("}", i + 7);
      if (closeBrace > i + 7) {
        const envName = src.slice(i + 7, closeBrace).trim();
        const endTag = `\\end{${envName}}`;
        const endIdx = src.indexOf(endTag, closeBrace + 1);
        if (endIdx > closeBrace) {
          const inner = src.slice(closeBrace + 1, endIdx);
          if (["pmatrix", "bmatrix", "vmatrix", "matrix", "cases"].includes(envName)) {
            nodes.push(renderMatrixRows(inner, envName, `${keyPrefix}-env-${idx++}`));
          } else {
            nodes.push(...parseMathNodes(inner, `${keyPrefix}-env-${idx++}`, depth + 1));
          }
          i = endIdx + endTag.length;
          continue;
        }
      }
    }

    // Subscript / Superscript attached directly after previous node
    if ((ch === "^" || ch === "_") && i + 1 < src.length) {
      const isSup = ch === "^";
      const group = readBalancedGroup(src, i + 1);
      const rendered = parseMathNodes(group.content, `${keyPrefix}-scr-${idx++}`, depth + 1);
      nodes.push(isSup ? <sup key={`${keyPrefix}-sup-${idx}`}>{rendered}</sup> : <sub key={`${keyPrefix}-sub-${idx}`}>{rendered}</sub>);
      i = group.nextPos;
      continue;
    }

    // Backslash commands
    if (ch === "\\") {
      if (i + 1 < src.length && !/[a-zA-Z]/.test(src[i + 1])) {
        const esc = src[i + 1];
        if (MATH_SYMBOLS[esc]) {
          nodes.push(MATH_SYMBOLS[esc]);
        } else if (esc === "left" || esc === "right") {
          i += 2;
          continue;
        } else {
          nodes.push(esc);
        }
        i += 2;
        continue;
      }

      const cmdMatch = src.slice(i + 1).match(/^[a-zA-Z]+/);
      if (cmdMatch) {
        const cmd = cmdMatch[0];
        let afterCmd = i + 1 + cmd.length;

        if (cmd === "left" || cmd === "right") {
          afterCmd = skipSpaces(src, afterCmd);
          if (afterCmd < src.length) {
            if (src[afterCmd] === ".") {
              i = afterCmd + 1;
              continue;
            }
            if (src.startsWith("\\{", afterCmd) || src.startsWith("\\}", afterCmd)) {
              nodes.push(<span key={`${keyPrefix}-d-${idx++}`} className="tutor-math-delim">{src[afterCmd + 1]}</span>);
              i = afterCmd + 2;
              continue;
            }
            if (src.startsWith("\\langle", afterCmd)) {
              nodes.push(<span key={`${keyPrefix}-d-${idx++}`} className="tutor-math-delim">⟨</span>);
              i = afterCmd + 7;
              continue;
            }
            if (src.startsWith("\\rangle", afterCmd)) {
              nodes.push(<span key={`${keyPrefix}-d-${idx++}`} className="tutor-math-delim">⟩</span>);
              i = afterCmd + 7;
              continue;
            }
            nodes.push(<span key={`${keyPrefix}-d-${idx++}`} className="tutor-math-delim">{src[afterCmd]}</span>);
            i = afterCmd + 1;
            continue;
          }
        }

        if (cmd === "frac" || cmd === "dfrac" || cmd === "tfrac") {
          const num = readBalancedGroup(src, afterCmd);
          const den = readBalancedGroup(src, num.nextPos);
          nodes.push(
            <span key={`${keyPrefix}-frac-${idx++}`} className="tutor-math-frac">
              <span className="tutor-math-frac-num">{parseMathNodes(num.content, `${keyPrefix}-fn-${idx}`, depth + 1)}</span>
              <span className="tutor-math-frac-den">{parseMathNodes(den.content, `${keyPrefix}-fd-${idx}`, depth + 1)}</span>
            </span>
          );
          i = den.nextPos;
          continue;
        }

        if (cmd === "binom") {
          const top = readBalancedGroup(src, afterCmd);
          const bot = readBalancedGroup(src, top.nextPos);
          nodes.push(
            <span key={`${keyPrefix}-bin-${idx++}`} className="tutor-math-binom">
              <span className="tutor-math-delim">(</span>
              <span className="tutor-math-binom-stack">
                <span>{parseMathNodes(top.content, `${keyPrefix}-bt-${idx}`, depth + 1)}</span>
                <span>{parseMathNodes(bot.content, `${keyPrefix}-bb-${idx}`, depth + 1)}</span>
              </span>
              <span className="tutor-math-delim">)</span>
            </span>
          );
          i = bot.nextPos;
          continue;
        }

        if (cmd === "sqrt") {
          const opt = readOptionalBracket(src, afterCmd);
          const bodyStart = opt ? opt.nextPos : afterCmd;
          const radicand = readBalancedGroup(src, bodyStart);
          nodes.push(
            <span key={`${keyPrefix}-sqrt-${idx++}`} className="tutor-math-sqrt">
              {opt && <sup className="tutor-math-root-idx">{parseMathNodes(opt.content, `${keyPrefix}-ri-${idx}`, depth + 1)}</sup>}
              <span className="tutor-math-sqrt-sign" aria-hidden="true">√</span>
              <span className="tutor-math-sqrt-body">{parseMathNodes(radicand.content, `${keyPrefix}-rb-${idx}`, depth + 1)}</span>
            </span>
          );
          i = radicand.nextPos;
          continue;
        }

        if (cmd === "text" || cmd === "textrm" || cmd === "mathrm" || cmd === "operatorname") {
          const grp = readBalancedGroup(src, afterCmd);
          nodes.push(
            <span key={`${keyPrefix}-txt-${idx++}`} className="tutor-math-text">
              {grp.content}
            </span>
          );
          i = grp.nextPos;
          continue;
        }

        if (cmd === "mathbf" || cmd === "boldsymbol" || cmd === "bm") {
          const grp = readBalancedGroup(src, afterCmd);
          nodes.push(
            <strong key={`${keyPrefix}-bf-${idx++}`} className="tutor-math-bold">
              {parseMathNodes(grp.content, `${keyPrefix}-bfs-${idx}`, depth + 1)}
            </strong>
          );
          i = grp.nextPos;
          continue;
        }

        if (cmd === "mathbb") {
          const grp = readBalancedGroup(src, afterCmd);
          const mapped = grp.content
            .split("")
            .map((c) => BLACKBOARD_BOLD[c] || c)
            .join("");
          nodes.push(<span key={`${keyPrefix}-bb-${idx++}`} className="tutor-math-op">{mapped}</span>);
          i = grp.nextPos;
          continue;
        }

        if (cmd === "vec" || cmd === "hat" || cmd === "bar" || cmd === "overline") {
          const grp = readBalancedGroup(src, afterCmd);
          nodes.push(
            <span key={`${keyPrefix}-acc-${idx++}`} className={`tutor-math-accent accent-${cmd}`}>
              {parseMathNodes(grp.content, `${keyPrefix}-ac-${idx}`, depth + 1)}
            </span>
          );
          i = grp.nextPos;
          continue;
        }

        if (MATH_SYMBOLS[cmd]) {
          const isBigOp = ["sum", "prod", "int", "iint", "oint"].includes(cmd);
          nodes.push(
            isBigOp
              ? <span key={`${keyPrefix}-op-${idx++}`} className="tutor-math-bigop">{MATH_SYMBOLS[cmd]}</span>
              : MATH_SYMBOLS[cmd]
          );
          i = afterCmd;
          continue;
        }

        if (OPERATOR_WORDS.has(cmd)) {
          nodes.push(<span key={`${keyPrefix}-fn-${idx++}`} className="tutor-math-op">{cmd}</span>);
          i = afterCmd;
          continue;
        }

        nodes.push(cmd);
        i = afterCmd;
        continue;
      }
    }

    if (ch === "{") {
      const grp = readBalancedGroup(src, i);
      nodes.push(
        <span key={`${keyPrefix}-grp-${idx++}`}>
          {parseMathNodes(grp.content, `${keyPrefix}-g-${idx}`, depth + 1)}
        </span>
      );
      i = grp.nextPos;
      continue;
    }

    if (ch === "}") {
      i += 1;
      continue;
    }

    if (ch === "~") {
      nodes.push("\u00a0");
      i += 1;
      continue;
    }

    if (ch === "-" && !/[a-zA-Z0-9)]/.test(src[i - 1] || "")) {
      nodes.push("−");
      i += 1;
      continue;
    }

    nodes.push(ch);
    i += 1;
  }

  return nodes;
}

/**
 * Pure-React math formula renderer (no dangerouslySetInnerHTML).
 * Supports inline ($...$) and block ($$...$$) LaTeX-style mathematical notation cleanly.
 */
export function MathFormula({ expr, display = false }) {
  const trimmed = String(expr || "").trim();
  if (!trimmed) return null;
  const content = parseMathNodes(trimmed, display ? "mb" : "mi");
  if (display) {
    return (
      <div className="tutor-math-block" role="math" aria-label={trimmed}>
        <span className="tutor-math-expr">{content}</span>
      </div>
    );
  }
  return (
    <span className="tutor-math-inline" role="math" aria-label={trimmed}>
      {content}
    </span>
  );
}
