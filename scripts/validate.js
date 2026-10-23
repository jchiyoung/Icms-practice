/**
 * Load every SAT Math item and render its math. Exits 1 if anything fails.
 */
const fs = require("node:fs");
const path = require("node:path");
const katex = require("katex");
const { unseal } = require("../js/seal.js");
const { extractMath, sanitizeRich, katexOptions } = require("../js/rich.js");
const { gradeSpr } = require("../js/spr.js");

const ROOT = path.join(__dirname, "..");
const subject = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "subjects", "sat-math.json"), "utf8"));
const failures = [];

function fail(id, message) {
  failures.push({ id: id, message: message });
}

function mathParts(src) {
  return extractMath(src).parts.filter(function (part) { return part.type === "math"; }).map(function (part) { return part.value; });
}

function collect(id, label, src) {
  if (!src) return [];
  const extracted = extractMath(src);
  if (extracted.unclosed) fail(id, "Unclosed $ in " + label);
  const again = mathParts(sanitizeRich(src));
  const original = extracted.parts.filter(function (part) { return part.type === "math"; }).map(function (part) { return part.value; });
  if (JSON.stringify(original) !== JSON.stringify(again)) fail(id, "Sanitizer changed math in " + label);
  return original.map(function (value) { return { label: label, value: value }; });
}

if (!subject.items || subject.items.length !== 950) {
  fail("bank", "Expected 950 items, found " + (subject.items ? subject.items.length : 0));
}
const seen = new Set();
const perTopic = {};
let figureCount = 0;
let choiceFigureCount = 0;
let mcCount = 0;
let sprCount = 0;
let mathCount = 0;

for (const item of subject.items || []) {
  perTopic[item.topicId] = (perTopic[item.topicId] || 0) + 1;
  if (!item.id || seen.has(item.id)) fail(item.id || "?", "Missing or duplicate id");
  seen.add(item.id);
  if (item.answer || (item.choices || []).some(function (choice) { return Object.prototype.hasOwnProperty.call(choice, "correct") || choice.feedback; })) {
    fail(item.id, "Public item exposes the answer or feedback");
  }
  for (const fig of item.figures || []) {
    figureCount++;
    if (!fig.svg || fig.svg.indexOf("<svg") < 0) fail(item.id, "Stem figure missing: " + (fig.id || ""));
    if (/<script/i.test(fig.svg || "")) fail(item.id, "Script in figure " + fig.id);
  }
  let hidden;
  try {
    hidden = unseal(item.seal, item.id);
  } catch (err) {
    fail(item.id, "Seal failed: " + err.message);
    continue;
  }
  const chunks = [];
  chunks.push.apply(chunks, collect(item.id, "stem", item.stem));
  chunks.push.apply(chunks, collect(item.id, "stemAfter", item.stemAfter));
  if (item.format === "mc") {
    mcCount++;
    if (!item.choices || item.choices.length !== 4) fail(item.id, "MC should have 4 choices");
    const keys = (item.choices || []).map(function (choice) { return choice.key; });
    if (new Set(keys).size !== 4 || !keys.every(function (key) { return /^[A-D]$/.test(key); })) {
      fail(item.id, "MC keys are not A-D");
    }
    if (!hidden.answer || keys.indexOf(hidden.answer.key) < 0) fail(item.id, "MC key is not one of the choices");
    (item.choices || []).forEach(function (choice) {
      chunks.push.apply(chunks, collect(item.id, "choice " + choice.key, choice.text));
      if (choice.figure) {
        choiceFigureCount++;
        if (!choice.figure.svg || choice.figure.svg.indexOf("<svg") < 0) fail(item.id, "Choice figure missing " + choice.key);
      }
    });
    const notes = hidden.notes || {};
    Object.keys(notes).forEach(function (key) {
      chunks.push.apply(chunks, collect(item.id, "note " + key, notes[key].feedback));
    });
  } else if (item.format === "spr") {
    sprCount++;
    const values = hidden.answer && hidden.answer.values;
    if (!values || !values.length) fail(item.id, "SPR has no values");
    (hidden.commonWrong || []).forEach(function (wrong) {
      chunks.push.apply(chunks, collect(item.id, "common wrong", wrong.feedback));
      const hit = gradeSpr(String(wrong.value), values, (hidden.answer && hidden.answer.decimalRule) || "bluebook");
      if (hit.status === "correct") fail(item.id, "Common wrong collides with the key: " + wrong.value);
    });
  } else {
    fail(item.id, "Unknown format " + item.format);
  }
  const solution = hidden.solution || {};
  ["keyIdea", "steps", "why", "check", "beCareful", "anotherWay", "desmos"].forEach(function (key) {
    chunks.push.apply(chunks, collect(item.id, key, solution[key]));
  });
  (solution.extra || []).forEach(function (extra) {
    chunks.push.apply(chunks, collect(item.id, extra.label || "extra", extra.html));
  });
  chunks.forEach(function (chunk) {
    mathCount++;
    try {
      katex.renderToString(chunk.value, katexOptions(true));
    } catch (err) {
      fail(item.id, "KaTeX " + chunk.label + ": " + err.message + " :: " + chunk.value.slice(0, 160));
    }
  });
}

const topicIds = [];
(subject.domains || []).forEach(function (domain) {
  (domain.topics || []).forEach(function (topic) { topicIds.push(topic.id); });
});
if (topicIds.length !== 19) fail("bank", "Expected 19 topics, found " + topicIds.length);
topicIds.forEach(function (id) {
  if (perTopic[id] !== 50) fail(id, "Expected 50 items, found " + (perTopic[id] || 0));
});

const report = {
  items: (subject.items || []).length,
  topics: topicIds.length,
  multipleChoice: mcCount,
  studentProduced: sprCount,
  stemFigures: figureCount,
  choiceFigures: choiceFigureCount,
  mathSegments: mathCount,
  failures: failures,
};
const outDir = path.join(ROOT, "reports");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "validation.json"), JSON.stringify(report, null, 2));
const artifactDir = "/opt/cursor/artifacts";
try {
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, "validation.json"), JSON.stringify(report, null, 2));
} catch (err) {
  // Artifact directory is optional outside the cloud VM.
}
if (failures.length) {
  console.error("Validation failed: " + failures.length);
  failures.slice(0, 40).forEach(function (entry) {
    console.error(entry.id + " — " + entry.message);
  });
  process.exit(1);
}
console.log("Validated " + report.items + " items, " + mathCount + " math segments, " + figureCount + " figures, " + choiceFigureCount + " choice figures.");
