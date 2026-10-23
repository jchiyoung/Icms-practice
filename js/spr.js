/**
 * Student-produced response grading.
 *
 * decimalRule "bluebook" follows the digital grid-in rules:
 * - Positive entries may use at most 5 characters. Negative entries may use
 *   at most 6 characters, including the minus sign.
 * - An equivalent fraction or an exact decimal is accepted (11/7, 22/14, 6.5, 6.50).
 * - Mixed numbers, commas, percent signs, and dollar signs are not accepted.
 * - When the exact decimal does not fit, truncation and rounding are accepted
 *   at the greatest number of decimal places that fit. For a value between
 *   -1 and 1, both shapes are accepted: .6666 / .6667 and 0.666 / 0.667.
 * - A different spelling of those same digits is accepted (.666 equals 0.666).
 *   A shorter value that is a different number (.66) is not.
 *
 * decimalRule "exact" accepts only values numerically equal to a listed value.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ICMS = Object.assign(root.ICMS || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function gcd(a, b) {
    a = a < 0n ? -a : a;
    b = b < 0n ? -b : b;
    while (b) {
      const t = a % b;
      a = b;
      b = t;
    }
    return a || 1n;
  }

  function reduce(n, d) {
    if (d === 0n) throw new Error("zero denominator");
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d);
    return { n: n / g, d: d / g };
  }

  function keyOf(r) {
    return r.n.toString() + "/" + r.d.toString();
  }

  function parseUnsignedDecimal(text) {
    const parts = text.split(".");
    if (parts.length !== 2) return null;
    const whole = parts[0] === "" ? "0" : parts[0];
    const frac = parts[1];
    if (!/^\d+$/.test(whole) || !/^\d+$/.test(frac) || frac.length === 0) return null;
    return reduce(BigInt(whole + frac), 10n ** BigInt(frac.length));
  }

  function parseValue(raw) {
    const text = String(raw).trim();
    const frac = text.match(/^([-+]?)(\d+)\/([-+]?)(\d+)$/);
    if (frac) {
      const den = BigInt(frac[4]);
      if (den === 0n) return null;
      let n = BigInt(frac[2]);
      let d = den;
      if (frac[1] === "-") n = -n;
      if (frac[3] === "-") d = -d;
      return reduce(n, d);
    }
    const dec = text.match(/^([-+]?)(\d+\.\d+|\.\d+|\d+)$/);
    if (!dec) return null;
    const mag = dec[2].includes(".")
      ? parseUnsignedDecimal(dec[2].startsWith(".") ? dec[2] : dec[2])
      : reduce(BigInt(dec[2]), 1n);
    if (!mag) return null;
    return dec[1] === "-" ? reduce(-mag.n, mag.d) : mag;
  }

  function absOf(r) {
    return { n: r.n < 0n ? -r.n : r.n, d: r.d };
  }

  function truncScaled(abs, places) {
    const scale = 10n ** BigInt(places);
    return (abs.n * scale) / abs.d;
  }

  function roundScaled(abs, places) {
    const scale = 10n ** BigInt(places);
    const prod = abs.n * scale;
    let q = prod / abs.d;
    const rem = prod % abs.d;
    if (rem * 2n >= abs.d) q += 1n;
    return q;
  }

  function formatScaled(negative, scaledAbs, places, style) {
    const scale = 10n ** BigInt(places);
    const intPart = scaledAbs / scale;
    const decPart = places === 0 ? 0n : scaledAbs % scale;
    const decStr = places === 0 ? "" : decPart.toString().padStart(places, "0");
    const sign = negative ? "-" : "";
    const overflow = (style === "dot" || style === "zero") && scaledAbs >= scale;
    const use = overflow ? "plain" : style;
    if (use === "dot") return sign + "." + decStr;
    if (use === "zero") return sign + "0." + decStr;
    if (!places) return sign + intPart.toString();
    return sign + intPart.toString() + "." + decStr;
  }

  function scaledToRational(negative, scaledAbs, places) {
    const scale = 10n ** BigInt(places);
    return reduce(negative ? -scaledAbs : scaledAbs, scale);
  }

  function approximationKeys(exact) {
    const keys = new Set();
    if (!exact) return keys;
    const negative = exact.n < 0n;
    const abs = absOf(exact);
    const limit = negative ? 6 : 5;
    const between = abs.n !== 0n && abs.n < abs.d;
    const styles = between ? ["dot", "zero"] : ["plain"];
    const integer = abs.d === 1n;
    for (const style of styles) {
      let best = -1;
      for (let places = 0; places <= 12; places++) {
        if ((style === "dot" || style === "zero") && places === 0) continue;
        const scaled = truncScaled(abs, places);
        const formatted = formatScaled(negative, scaled, places, style);
        if (formatted.length <= limit) best = places;
        else break;
      }
      if (best < 0) continue;
      if (best === 0 && !integer) continue;
      const trunc = truncScaled(abs, best);
      keys.add(keyOf(scaledToRational(negative, trunc, best)));
      const rounded = roundScaled(abs, best);
      const roundedText = formatScaled(negative, rounded, best, style);
      if (roundedText.length <= limit) {
        keys.add(keyOf(scaledToRational(negative, rounded, best)));
      }
    }
    return keys;
  }

  function gradeSpr(raw, values, decimalRule) {
    const original = String(raw ?? "");
    if (!original.trim()) {
      return { status: "invalid", message: "Enter a fraction or a decimal." };
    }
    if (/[%$]/.test(original)) {
      return { status: "invalid", message: "Don't type a percent sign or a dollar sign." };
    }
    if (/,/.test(original)) {
      return { status: "invalid", message: "Don't type commas." };
    }
    if (/\s/.test(original.trim())) {
      return {
        status: "invalid",
        message: "Enter an improper fraction like 7/2, or a decimal like 3.5. Mixed numbers are not accepted.",
      };
    }
    let text = original.trim();
    if (text.startsWith("+")) text = text.slice(1);
    if (!text) return { status: "invalid", message: "Enter a fraction or a decimal." };
    const negative = text.startsWith("-");
    const limit = negative ? 6 : 5;
    if (text.length > limit) {
      return {
        status: "invalid",
        message: negative
          ? "Negative answers can use at most 6 characters, including the minus sign."
          : "Positive answers can use at most 5 characters.",
      };
    }
    if (!/^[-]?(?:\d+\/[-]?\d+|\d+\.\d+|\.\d+|\d+)$/.test(text)) {
      return { status: "invalid", message: "Use digits, one decimal point, a fraction slash, or a minus sign." };
    }
    const parsed = parseValue(text);
    if (!parsed) return { status: "invalid", message: "That number isn't valid." };

    const listed = [];
    for (const value of values || []) {
      const r = parseValue(value);
      if (r) listed.push(r);
    }
    if (!listed.length) return { status: "incorrect", parsed, message: "Incorrect." };

    const parsedKey = keyOf(parsed);
    for (const r of listed) {
      if (keyOf(r) === parsedKey) return { status: "correct", parsed, matched: "listed" };
    }

    const rule = decimalRule || "bluebook";
    if (rule === "bluebook") {
      const fraction = (values || []).find((value) => String(value).includes("/"));
      const exact = fraction ? parseValue(fraction) : listed.length === 1 ? listed[0] : sameValue(listed);
      if (exact && approximationKeys(exact).has(parsedKey)) {
        return { status: "correct", parsed, matched: "bluebook" };
      }
    }
    return { status: "incorrect", parsed, message: "Incorrect." };
  }

  function sameValue(list) {
    if (!list.length) return null;
    const k = keyOf(list[0]);
    return list.every((r) => keyOf(r) === k) ? list[0] : null;
  }

  return {
    gradeSpr,
    parseValue,
    keyOf,
    approximationKeys,
    reduce,
  };
});
