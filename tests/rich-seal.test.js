const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { sanitizeRich, extractMath } = require("../js/rich.js");
const { seal, unseal } = require("../js/seal.js");

test("inequalities stay text and real tags stay tags", () => {
  const src = "If $a < b$, then $b > a$.<br><span class=\"nt\">(note $x < 0$)</span>";
  const safe = sanitizeRich(src);
  assert.match(safe, /a &lt; b/);
  assert.match(safe, /b &gt; a/);
  assert.match(safe, /<br>/);
  assert.match(safe, /<span class="nt">/);
  assert.doesNotMatch(safe, /<b>/);
  const math = extractMath(src).parts.filter((part) => part.type === "math").map((part) => part.value);
  assert.deepEqual(math, ["a < b", "b > a", "x < 0"]);
});

test("a variable named b is not eaten as a tag", () => {
  const src = "Solve $a<b$ and $c>d$ together.";
  const safe = sanitizeRich(src);
  assert.match(safe, /\$a&lt;b\$/);
  assert.match(safe, /\$c&gt;d\$/);
  const math = extractMath(safe).parts.filter((part) => part.type === "math").map((part) => part.value);
  assert.deepEqual(math, ["a<b", "c>d"]);
});

test("tables, dollar escapes, and inline svg survive", () => {
  const src = 'Fee of \\$40.<table class="dt"><tr><th>$x$</th><td>$2$</td></tr></table><svg role="img" width="10" height="10"><text>$</text></svg>';
  const safe = sanitizeRich(src);
  assert.match(safe, /<table class="dt">/);
  assert.match(safe, /<th>/);
  assert.match(safe, /<svg/);
  assert.match(safe, /\\\$40/);
  const raw = extractMath(src.replace(/<svg\b[^<>]*>[\s\S]*?<\/svg>/gi, ""));
  const maths = raw.parts.filter((part) => part.type === "math").map((part) => part.value);
  assert.deepEqual(maths, ["x", "2"]);
});

test("real stems from the bank sanitize without dropping math", () => {
  const a1 = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "content", "sat-math", "data", "A1.json"), "utf8"));
  const table = a1.items.find((item) => (item.stem || "").includes("<table"));
  assert.ok(table, "expected a table stem");
  const before = extractMath(table.stem).parts.filter((part) => part.type === "math").map((part) => part.value);
  const after = extractMath(sanitizeRich(table.stem)).parts.filter((part) => part.type === "math").map((part) => part.value);
  assert.deepEqual(after, before);
  assert.ok(before.length >= 2);

  const a5 = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "content", "sat-math", "data", "A5.json"), "utf8"));
  const ineq = a5.items.find((item) => (item.stem || "").includes("<"));
  assert.ok(ineq);
  const safe = sanitizeRich(ineq.stem);
  assert.equal((safe.match(/</g) || []).length, (safe.match(/<[a-z/]/gi) || []).length);
  const left = extractMath(ineq.stem).parts.filter((part) => part.type === "math").map((part) => part.value);
  const right = extractMath(safe).parts.filter((part) => part.type === "math").map((part) => part.value);
  assert.deepEqual(right, left);
});

test("seal round-trips unicode explanations", () => {
  const payload = { answer: { format: "spr", values: ["11/7", "1.571"] }, solution: { steps: "Then $x = \\frac{11}{7}$.<br><span class=\"nt\">(done)</span> ✓" } };
  const hidden = seal(payload, "QB-A1-003");
  assert.equal(typeof hidden, "string");
  assert.ok(!hidden.includes("11/7"));
  assert.deepEqual(unseal(hidden, "QB-A1-003"), payload);
  assert.throws(() => unseal(hidden, "QB-A1-004"));
});
