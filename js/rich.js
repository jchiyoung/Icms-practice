/**
 * Trusted-bank HTML (tables, line breaks, notes, inline figures) plus $...$ math.
 * Raw "<" in inequalities stays text. KaTeX runs only on math segments.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ICMS = Object.assign(root.ICMS || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function tagPattern() {
    return /<svg\b[^<>]*>[\s\S]*?<\/svg>|<br\s*\/?>|<\/?(?:span|b|i|sub|sup|em|strong|table|thead|tbody|tr|th|td)(?:\s[^<>]*?)?>/gi;
  }

  function escapeText(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function attr(tag, name) {
    const re = new RegExp(name + "\\s*=\\s*(['\"])(.*?)\\1", "i");
    const m = re.exec(tag);
    return m ? m[2] : "";
  }

  function cleanTag(tag) {
    if (/^<svg\b/i.test(tag)) {
      return tag
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "")
        .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "");
    }
    const name = (/^<\/?([a-zA-Z0-9]+)/.exec(tag) || [])[1];
    if (!name) return escapeText(tag);
    const n = name.toLowerCase();
    if (/^<\//.test(tag)) return "</" + n + ">";
    if (n === "br") return "<br>";
    if (n === "span") {
      const classes = attr(tag, "class").split(/\s+/);
      return classes.includes("nt") ? '<span class="nt">' : "<span>";
    }
    if (n === "table") {
      const c = attr(tag, "class");
      if (c === "dt" || c === "tb" || c === "t") return '<table class="' + c + '">';
      return "<table>";
    }
    if (n === "th" || n === "td") {
      const col = attr(tag, "colspan");
      if (/^\d+$/.test(col)) return "<" + n + ' colspan="' + col + '">';
      return "<" + n + ">";
    }
    return "<" + n + ">";
  }

  function sanitizeRich(src) {
    const input = String(src || "");
    const re = tagPattern();
    let out = "";
    let last = 0;
    let match;
    while ((match = re.exec(input))) {
      out += escapeText(input.slice(last, match.index));
      out += cleanTag(match[0]);
      last = match.index + match[0].length;
    }
    out += escapeText(input.slice(last));
    return out;
  }

  function splitDollars(s) {
    const parts = [];
    let buf = "";
    let unclosed = false;
    let i = 0;
    while (i < s.length) {
      if (s[i] === "\\" && s[i + 1] === "$") {
        buf += "\\$";
        i += 2;
        continue;
      }
      if (s[i] === "$") {
        let math = "";
        let j = i + 1;
        let closed = false;
        while (j < s.length) {
          if (s[j] === "\\" && s[j + 1] === "$") {
            math += "\\$";
            j += 2;
            continue;
          }
          if (s[j] === "$") {
            closed = true;
            break;
          }
          math += s[j];
          j++;
        }
        if (!closed) {
          unclosed = true;
          buf += s.slice(i);
          break;
        }
        if (buf) parts.push({ type: "text", value: buf });
        buf = "";
        parts.push({ type: "math", value: math });
        i = j + 1;
        continue;
      }
      buf += s[i];
      i++;
    }
    if (buf) parts.push({ type: "text", value: buf });
    return { parts, unclosed };
  }

  function decodeEntities(s) {
    return s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&");
  }

  function extractMath(src) {
    const noSvg = String(src || "").replace(/<svg\b[^<>]*>[\s\S]*?<\/svg>/gi, " ");
    const noTags = noSvg.replace(tagPattern(), " ");
    return splitDollars(decodeEntities(noTags));
  }

  function katexOptions(throwOnError) {
    return {
      throwOnError: !!throwOnError,
      processEscapes: true,
      strict: "ignore",
      trust: false,
      output: "html",
      errorColor: "#a3263a",
    };
  }

  function renderMathTree(el, katex) {
    const engine = katex || (typeof window !== "undefined" ? window.katex : null);
    if (!engine) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const texts = [];
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement && node.parentElement.closest("svg, .katex")) continue;
      if (node.nodeValue && node.nodeValue.includes("$")) texts.push(node);
    }
    texts.forEach(function (textNode) {
      const split = splitDollars(textNode.nodeValue);
      const frag = document.createDocumentFragment();
      split.parts.forEach(function (part) {
        if (part.type === "text") {
          frag.appendChild(document.createTextNode(part.value.replace(/\\\$/g, "$")));
          return;
        }
        const holder = document.createElement("span");
        try {
          holder.innerHTML = engine.renderToString(part.value, katexOptions(false));
        } catch (err) {
          holder.className = "katex-error";
          holder.textContent = part.value;
        }
        frag.appendChild(holder);
      });
      textNode.parentNode.replaceChild(frag, textNode);
    });
  }

  function mountRich(root, katex) {
    if (!root) return;
    root.querySelectorAll("[data-rich]").forEach(function (el) {
      renderMathTree(el, katex);
    });
  }

  function parenPart(part) {
    const text = String(part || "").trim();
    if (!text) return text;
    if (/^[A-Za-z0-9.]+$/.test(text)) return text;
    if (/^[+-]?\d+(?:\.\d+)?$/.test(text)) return text;
    return "(" + text + ")";
  }

  function latexToPlain(src) {
    let text = String(src || "");
    text = text.replace(/\\[,;:!]/g, " ").replace(/\\ /g, " ");
    text = text.replace(/\\(?:quad|qquad)/g, " ");
    let guard = 0;
    let prev;
    while (text !== prev && guard < 24) {
      prev = text;
      guard += 1;
      text = text.replace(/\\(?:d|t)?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, function (_match, a, b) {
        return parenPart(a) + "/" + parenPart(b);
      });
      text = text.replace(/\\sqrt\s*\[([^{}\]]+)\]\s*\{([^{}]*)\}/g, "root($1, $2)");
      text = text.replace(/\\sqrt\s*\{([^{}]*)\}/g, "sqrt($1)");
      text = text.replace(/\\(?:text|mathrm|operatorname|textbf|textit|textrm)\s*\{([^{}]*)\}/g, "$1");
      text = text.replace(/\\(?:overline|underline|bar|hat|vec|widehat)\s*\{([^{}]*)\}/g, "$1");
    }
    const words = {
      angle: "angle",
      triangle: "triangle",
      times: "×",
      cdot: "·",
      div: "÷",
      pm: "±",
      mp: "∓",
      pi: "π",
      theta: "θ",
      rho: "ρ",
      ell: "l",
      le: "≤",
      leq: "≤",
      ge: "≥",
      geq: "≥",
      ne: "≠",
      neq: "≠",
      approx: "≈",
      sin: "sin",
      cos: "cos",
      tan: "tan",
      circ: "°",
      degree: "°",
      to: "→",
      ldots: "…",
      dots: "…",
      parallel: "parallel",
      perp: "perpendicular",
      sim: "~",
      sum: "sum",
      infty: "infinity",
      left: "",
      right: "",
      big: "",
      Big: "",
    };
    text = text.replace(/\\([a-zA-Z]+)/g, function (_match, name) {
      if (Object.prototype.hasOwnProperty.call(words, name)) return words[name];
      return name;
    });
    text = text.replace(/\^\{([^{}]*)\}/g, "^$1");
    text = text.replace(/_\{([^{}]*)\}/g, "_$1");
    text = text.replace(/[{}]/g, "");
    return text;
  }

  function toPlainText(src) {
    const currency = "\uE000";
    let text = decodeEntities(String(src || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "));
    text = text.replace(/\\\$/g, currency);
    text = text.replace(/\$([^$]*)\$/g, function (_match, inner) {
      return latexToPlain(inner);
    });
    text = latexToPlain(text);
    text = text.split(currency).join("$");
    return text.replace(/\s+/g, " ").trim();
  }

  function stripHtml(src) {
    return toPlainText(src);
  }

  return {
    sanitizeRich,
    splitDollars,
    extractMath,
    mountRich,
    renderMathTree,
    stripHtml,
    toPlainText,
    katexOptions,
  };
});
