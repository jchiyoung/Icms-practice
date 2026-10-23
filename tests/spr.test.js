const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { gradeSpr, parseValue, keyOf, approximationKeys } = require("../js/spr.js");

function ok(input, values, rule) {
  const result = gradeSpr(input, values, rule || "bluebook");
  assert.equal(result.status, "correct", input + " should accept " + values.join(", ") + " but was " + result.status + " " + (result.message || ""));
}

function bad(input, values, rule) {
  const result = gradeSpr(input, values, rule || "bluebook");
  assert.equal(result.status, "incorrect", input + " should be incorrect for " + values.join(", "));
}

function invalid(input, values) {
  const result = gradeSpr(input, values, "bluebook");
  assert.equal(result.status, "invalid", input + " should be invalid, was " + result.status);
}

test("equivalent fractions and exact decimals", () => {
  ok("11/7", ["11/7", "1.571"]);
  ok("22/14", ["11/7", "1.571"]);
  ok("1.571", ["11/7", "1.571"]);
  ok("13/2", ["13/2", "6.5"]);
  ok("6.5", ["13/2", "6.5"]);
  ok("6.50", ["13/2", "6.5"]);
  ok(".5", [".5"]);
  ok("0.5", [".5"]);
  ok("1/2", [".5"]);
  ok("+6.5", ["13/2", "6.5"]);
  ok("20.32", ["20.32"]);
  ok("-5", ["-5"]);
  ok("-16/6", ["-8/3", "-2.666", "-2.667"]);
});

test("rejects less precise decimals", () => {
  bad("1.57", ["11/7", "1.571"]);
  bad("1.570", ["11/7", "1.571"]);
  bad(".66", ["2/3", ".6666", ".6667", "0.666", "0.667"]);
  bad("0.66", ["2/3", ".6666", ".6667", "0.666", "0.667"]);
  bad(".67", ["2/3", ".6666", ".6667", "0.666", "0.667"]);
  bad("16.6", ["50/3", "16.66", "16.67"]);
  bad("16", ["50/3", "16.66", "16.67"]);
  bad("17", ["50/3", "16.66", "16.67"]);
  bad("-2.66", ["-8/3", "-2.666", "-2.667"]);
  bad("-2.67", ["-8/3", "-2.666", "-2.667"]);
  bad("20.3", ["20.32"]);
  bad("20", ["20.32"]);
});

test("bluebook truncation and rounding", () => {
  const twoThirds = ["2/3", ".6666", ".6667", "0.666", "0.667"];
  ok("2/3", twoThirds);
  ok(".6666", twoThirds);
  ok(".6667", twoThirds);
  ok("0.666", twoThirds);
  ok("0.667", twoThirds);
  ok(".666", twoThirds);
  ok(".667", twoThirds);

  const neg = ["-8/3", "-2.666", "-2.667"];
  ok("-2.666", neg);
  ok("-2.667", neg);
  ok("-8/3", neg);

  const small = ["-5/12", "-.4166", "-.4167", "-0.416", "-0.417"];
  ok("-5/12", small);
  ok("-.4166", small);
  ok("-.4167", small);
  ok("-0.416", small);
  ok("-0.417", small);
  ok("-.416", small);

  ok("16.66", ["50/3", "16.66", "16.67"]);
  ok("16.67", ["50/3", "16.66", "16.67"]);
  ok(".8823", ["15/17", ".8823", ".8824", "0.882"]);
  ok(".8824", ["15/17", ".8823", ".8824", "0.882"]);
  ok("0.882", ["15/17", ".8823", ".8824", "0.882"]);
  ok(".3846", ["5/13", ".3846", "0.384", "0.385"]);
  ok("0.385", ["5/13", ".3846", "0.384", "0.385"]);
  ok("6.333", ["19/3", "6.333"]);
  bad("6.334", ["19/3", "6.333"]);
  ok("33.33", ["100/3", "33.33"]);
  bad("33.34", ["100/3", "33.33"]);
});

test("character limits, mixed numbers, and symbols", () => {
  invalid("1.5714", ["11/7", "1.571"]);
  invalid("0.6666", ["2/3", ".6666", ".6667", "0.666", "0.667"]);
  invalid("16.666", ["50/3", "16.66", "16.67"]);
  invalid("-2.6666", ["-8/3", "-2.666", "-2.667"]);
  invalid("3 1/2", ["7/2", "3.5"]);
  invalid("7/2%", ["7/2"]);
  invalid("$7", ["7"]);
  invalid("1,200", ["1200"]);
  invalid("", ["1"]);
  invalid("   ", ["1"]);
  invalid("abc", ["1"]);
  invalid("1/0", ["1"]);
  invalid("3/", ["3"]);
  ok("3.5", ["7/2"]);
  ok("7/2", ["7/2"]);
  bad("3.4", ["7/2"]);
});

test("exact rule does not accept a rounded decimal", () => {
  bad(".6666", ["2/3"], "exact");
  ok("4/6", ["2/3"], "exact");
  ok("2/3", ["2/3"], "exact");
});

test("negative zero-style and half-away rounding keys", () => {
  const exact = parseValue("-5/12");
  const keys = approximationKeys(exact);
  for (const form of ["-.4166", "-.4167", "-0.416", "-0.417"]) {
    assert.ok(keys.has(keyOf(parseValue(form))), form + " missing from " + [...keys].join(" "));
  }
});

test("every listed SAT value matches the bluebook forms", () => {
  const dir = path.join(__dirname, "..", "content", "sat-math", "data");
  const files = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
  let checked = 0;
  const misses = [];
  for (const file of files) {
    const bank = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    for (const item of bank.items) {
      if (item.format !== "spr") continue;
      const values = item.answer.spr.values;
      const fraction = values.find((value) => value.includes("/"));
      const exact = fraction ? parseValue(fraction) : null;
      const approx = exact ? approximationKeys(exact) : null;
      for (const value of values) {
        checked++;
        const result = gradeSpr(value, values, "bluebook");
        if (result.status !== "correct") misses.push(item.id + " listed " + value + " -> " + result.status);
        if (exact && approx) {
          const parsed = parseValue(value);
          const key = keyOf(parsed);
          if (key !== keyOf(exact) && !approx.has(key)) {
            misses.push(item.id + " decimal " + value + " is not a bluebook form of " + fraction);
          }
        }
      }
    }
  }
  assert.ok(checked > 200, "expected SPR values, saw " + checked);
  assert.deepEqual(misses, []);
});
