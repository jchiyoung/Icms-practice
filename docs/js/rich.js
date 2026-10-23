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

  function stripHtml(src) {
    return decodeEntities(String(src || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "))
      .replace(/\\\$/g, "$")
      .replace(/\$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  return {
    sanitizeRich,
    splitDollars,
    extractMath,
    mountRich,
    renderMathTree,
    stripHtml,
    katexOptions,
  };
});
