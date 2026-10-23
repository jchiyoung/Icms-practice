/**
 * Convert the SAT Math banks in content/sat-math into the subject-agnostic
 * file data/subjects/sat-math.json. The practice app never reads this script.
 */
const fs = require("node:fs");
const path = require("node:path");
const { seal } = require("../js/seal.js");

const ROOT = path.join(__dirname, "..");
const RAW = path.join(ROOT, "content", "sat-math", "data");
const FIGS = path.join(ROOT, "content", "sat-math", "figures");
const OUT_DIR = path.join(ROOT, "data", "subjects");
const OUT = path.join(OUT_DIR, "sat-math.json");

const DOMAINS = [
  { id: "algebra", title: "Algebra", codes: ["A1", "A2", "A3", "A4", "A5"] },
  { id: "advanced-math", title: "Advanced Math", codes: ["N1", "N2", "N3"] },
  { id: "problem-solving", title: "Problem Solving and Data", codes: ["P1", "P2", "P3", "P4", "P5", "P6", "P7"] },
  { id: "geometry", title: "Geometry and Trigonometry", codes: ["G1", "G2", "G3", "G4"] },
];

// Two solution notes were stored with a JSON "\f" escape, which is a form
// feed, where "\frac" was intended. Restore those fractions before sealing.
function repairText(value) {
  if (typeof value === "string") return value.replace(/\f(?=\{)/g, "\\frac");
  if (Array.isArray(value)) return value.map(repairText);
  if (value && typeof value === "object") {
    const copy = {};
    for (const [key, inner] of Object.entries(value)) copy[key] = repairText(inner);
    return copy;
  }
  return value;
}

function humanizeFamily(slug) {
  let text = String(slug || "").trim();
  text = text.replace(/^HP-[A-Z]-/i, "").replace(/^HP-/i, "");
  text = text.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

function readSvg(file) {
  const name = path.basename(file || "");
  const full = path.join(FIGS, name);
  if (!name || !fs.existsSync(full)) {
    throw new Error("Missing figure " + file);
  }
  let svg = fs.readFileSync(full, "utf8").replace(/^\uFEFF/, "").trim();
  svg = svg.replace(/^<\?xml[^>]*>\s*/i, "");
  const start = svg.toLowerCase().indexOf("<svg");
  if (start < 0) throw new Error("Not an svg: " + name);
  if (start > 0) svg = svg.slice(start);
  if (!/<\/svg>\s*$/i.test(svg)) throw new Error("Unclosed svg: " + name);
  return svg;
}

function figureOf(fig) {
  if (!fig) return null;
  return {
    id: fig.id || path.basename(fig.file || "figure"),
    alt: fig.alt || "",
    svg: readSvg(fig.file),
  };
}

function solutionOf(sol) {
  const source = sol || {};
  const pick = (...keys) => {
    for (const key of keys) {
      if (typeof source[key] === "string" && source[key].trim()) return source[key];
    }
    return "";
  };
  const known = new Set([
    "key_idea", "keyIdea", "steps", "why", "check",
    "be_careful", "beCareful", "another_way", "anotherWay", "desmos",
  ]);
  const extra = [];
  for (const [key, value] of Object.entries(source)) {
    if (known.has(key)) continue;
    if (typeof value === "string" && value.trim()) extra.push({ label: humanizeFamily(key), html: value });
  }
  const solution = {
    keyIdea: pick("key_idea", "keyIdea"),
    steps: pick("steps"),
    why: pick("why"),
    check: pick("check"),
    beCareful: pick("be_careful", "beCareful"),
    anotherWay: pick("another_way", "anotherWay"),
    desmos: pick("desmos"),
  };
  if (extra.length) solution.extra = extra;
  return solution;
}

function importItem(rawItem, topicId) {
  const raw = repairText(rawItem);
  const format = raw.format === "mcq" || raw.format === "mc" ? "mc" : raw.format === "spr" ? "spr" : null;
  if (!format) throw new Error(raw.id + " has format " + raw.format);
  const choices = (raw.choices || []).map((choice) => ({
    key: choice.key,
    text: choice.text || "",
    figure: choice.figure ? figureOf(choice.figure) : null,
  }));
  const notes = {};
  for (const choice of raw.choices || []) {
    if (choice.correct) continue;
    if (choice.feedback || choice.misconception || choice.error_type) {
      notes[choice.key] = {
        errorType: choice.error_type || "",
        misconception: choice.misconception || "",
        feedback: choice.feedback || "",
      };
    }
  }
  let answer;
  if (format === "mc") {
    const key = (raw.answer && (raw.answer.mcq || raw.answer.mc || raw.answer.key)) || "";
    answer = { format: "mc", key };
    if (!choices.some((choice) => choice.key === key)) {
      throw new Error(raw.id + " key " + key + " is not a choice");
    }
    if (choices.length !== 4) throw new Error(raw.id + " has " + choices.length + " choices");
  } else {
    const spr = (raw.answer && raw.answer.spr) || {};
    const values = spr.values || [];
    if (!values.length) throw new Error(raw.id + " has no SPR values");
    answer = {
      format: "spr",
      values: values.slice(),
      decimalRule: spr.decimal_rule || spr.decimalRule || "bluebook",
    };
  }
  const family = raw.family || "";
  const hidden = {
    answer,
    notes,
    commonWrong: (raw.common_wrong || []).map((entry) => ({
      value: String(entry.value),
      errorType: entry.error_type || "",
      misconception: entry.misconception || "",
      feedback: entry.feedback || "",
    })),
    concepts: raw.concepts || [],
    family,
    familyLabel: humanizeFamily(family),
    solution: solutionOf(raw.solution),
  };
  const item = {
    id: raw.id,
    topicId,
    level: raw.level,
    format,
    stem: raw.stem || "",
    stemAfter: raw.stem_after_figure || raw.stemAfter || "",
    figures: (raw.figures || []).map(figureOf),
  };
  if (format === "mc") item.choices = choices;
  else item.decimalRule = answer.decimalRule;
  item.seal = seal(hidden, raw.id);
  return item;
}

function main() {
  const byCode = new Map();
  for (const file of fs.readdirSync(RAW).filter((name) => name.endsWith(".json")).sort()) {
    const bank = JSON.parse(fs.readFileSync(path.join(RAW, file), "utf8"));
    byCode.set(bank.code, bank);
  }
  const conceptFamilies = new Map();
  const items = [];
  const domains = DOMAINS.map((domain) => ({
    id: domain.id,
    title: domain.title,
    topics: domain.codes.map((code) => {
      const bank = byCode.get(code);
      if (!bank) throw new Error("Missing bank " + code);
      if (!Array.isArray(bank.items) || bank.items.length !== 50) {
        throw new Error(code + " has " + (bank.items ? bank.items.length : 0) + " items");
      }
      for (const raw of bank.items) {
        const item = importItem(raw, code);
        items.push(item);
        const familyLabel = humanizeFamily(raw.family || "");
        for (const concept of raw.concepts || []) {
          if (!conceptFamilies.has(concept)) conceptFamilies.set(concept, []);
          conceptFamilies.get(concept).push(familyLabel);
        }
      }
      return { id: code, title: bank.skill };
    }),
  }));

  const conceptLabels = {};
  for (const [concept, labels] of conceptFamilies) {
    const unique = [...new Set(labels.filter(Boolean))];
    unique.sort((a, b) => Math.abs(a.split(" ").length - 4) - Math.abs(b.split(" ").length - 4) || a.length - b.length);
    conceptLabels[concept] = unique[0] || concept;
  }

  const subject = {
    schemaVersion: 1,
    id: "sat-math",
    title: "SAT Math",
    blurb: "High-school math practice, one topic at a time.",
    calculator: { label: "Desmos", href: "https://www.desmos.com/calculator" },
    setSizes: [5, 10, 20],
    levels: [
      { id: "M", label: "M", name: "Medium" },
      { id: "H", label: "H", name: "Hard" },
      { id: "H+", label: "Killer", name: "Hardest" },
    ],
    errorTypes: {
      slip: "Careless slip",
      concept: "Concept gap",
    },
    domains,
    conceptLabels,
    items,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(subject));
  const registry = {
    subjects: [{ id: "sat-math", file: "data/subjects/sat-math.json" }],
  };
  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "data", "registry.json"), JSON.stringify(registry, null, 2) + "\n");
  console.log("Wrote " + items.length + " items to " + path.relative(ROOT, OUT));
}

main();
