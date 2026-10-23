const test = require("node:test");
const assert = require("node:assert/strict");
const { analyze, formatSessionReport, strip, testAttempts, selectCustomPool } = require("../js/analysis.js");

const subject = {
  title: "SAT Math",
  levels: [
    { id: "M", label: "M", name: "Medium" },
    { id: "H", label: "H", name: "Hard" },
    { id: "H+", label: "Killer", name: "Hardest" },
  ],
  errorTypes: { slip: "Careless slip", concept: "Concept gap" },
  domains: [{ id: "algebra", title: "Algebra", topics: [{ id: "A1", title: "Linear equations in one variable" }] }],
  conceptLabels: { "A1.C4": "Identity constant is ab" },
};

test("a correct guess is not mastered and repeated mistakes group by code", () => {
  const analysis = analyze([
    { itemId: "a", topicId: "A1", level: "M", correct: false, confidence: "sure", ts: 1, concepts: ["A1.C1"], familyLabel: "Old miss", errorType: "slip", misconception: "D4", feedback: "Old note." },
    { itemId: "a", topicId: "A1", level: "M", correct: true, confidence: "guess", ts: 2, concepts: ["A1.C1"], familyLabel: "Given solution constant" },
    { itemId: "b", topicId: "A1", level: "H+", correct: true, confidence: "sure", ts: 3, concepts: ["A1.C1"], familyLabel: "Given solution constant" },
    { itemId: "c", topicId: "A1", level: "H", correct: false, confidence: "sure", ts: 4, errorType: "concept", misconception: "D4", feedback: "Sign error on the product.", concepts: ["A1.C4"], familyLabel: "Identity constant is ab" },
    { itemId: "d", topicId: "A1", level: "H", correct: false, confidence: "fifty", ts: 5, errorType: "concept", misconception: "D4", feedback: "Sign error on the product.", concepts: ["A1.C4"], familyLabel: "Identity constant is ab" },
    { itemId: "e", topicId: "A1", level: "M", correct: true, confidence: "fifty", ts: 6, concepts: ["A1.C2"], familyLabel: "Clear fractions" },
  ], subject);

  assert.equal(analysis.attempted, 5);
  assert.equal(analysis.correct, 3);
  assert.equal(analysis.mastered, 1);
  assert.equal(analysis.shakyGuess, 1);
  assert.equal(analysis.shakyFifty, 1);
  assert.equal(analysis.missed, 2);
  assert.equal(analysis.sureButMissed, 1);
  assert.equal(analysis.patterns.length, 1);
  assert.equal(analysis.patterns[0].count, 2);
  assert.equal(analysis.patterns[0].misconception, "D4");
  assert.equal(analysis.patterns[0].errorLabel, "Concept mix-up");
  assert.match(analysis.patterns[0].feedbackText, /Sign error/);
  assert.equal(analysis.byLevel.find((row) => row.levelId === "H+").label, "Killer");
  const weak = analysis.concepts.find((row) => row.label.includes("Hard"));
  assert.ok(weak);
  assert.equal(weak.notMastered, 2);
  assert.match(weak.label, /Linear equations in one variable/);
  assert.doesNotMatch(weak.label, /Identity|A1\.C|given-solution|family/i);
  assert.equal(analysis.concepts.some((row) => /A1\.C|Identity constant|given-solution/i.test(row.label)), false);
});

test("same mistake follows the D-code, and a missing note is not a careless slip", () => {
  const analysis = analyze([
    { itemId: "p", topicId: "A1", level: "M", correct: false, confidence: "sure", ts: 1, errorType: "slip", misconception: "D4", feedback: "Sign error.", concepts: ["A1.C1"], familyLabel: "old-slug" },
    { itemId: "q", topicId: "A1", level: "M", correct: false, confidence: "sure", ts: 2, errorType: "slip", misconception: "D9", feedback: "A different slip.", concepts: ["A1.C2"], familyLabel: "other-slug" },
    { itemId: "r", topicId: "A1", level: "H", correct: false, confidence: "guess", ts: 3, errorType: "", misconception: "", feedback: "", concepts: ["A1.C9"], familyLabel: "hidden-family" },
    { itemId: "s", topicId: "A1", level: "H", correct: false, confidence: "sure", ts: 4, errorType: "slip", misconception: "D2", feedback: "", concepts: ["A1.C8"], familyLabel: "another-slug" },
  ], subject);
  assert.equal(analysis.patterns.length, 0);
  assert.equal(analysis.otherMistakes.count, 2);
  assert.deepEqual(analysis.otherMistakes.itemIds, ["r", "s"]);
  assert.equal(analysis.otherMistakes.feedbackText, "Compare your answer with the steps below.");
  assert.equal(analysis.errorTypes.some((row) => row.label === "Other miss"), false);
  assert.equal(analysis.errorTypes.find((row) => row.id === "other").label, "Other mistakes");
  assert.equal(analysis.mistakes.some((row) => row.itemIds.includes("p") && row.itemIds.includes("q")), false);
  const text = formatSessionReport({
    name: "Sam",
    subject: subject,
    session: { title: "Set", mode: "practice", levelLabel: "All", elapsedMs: 1000, itemIds: ["p", "q", "r", "s"], responses: {} },
    analysis: analysis,
    reports: [],
  });
  assert.match(text, /Other mistakes/);
  assert.match(text, /Compare your answer with the steps below/);
  assert.doesNotMatch(text, /No extra note|Other miss/);
  assert.doesNotMatch(text, /old-slug|hidden-family|A1\.C/);
});

test("plain text keeps currency dollars and reads LaTeX", () => {
  assert.equal(
    strip("80 is the money from paperbacks: 20 paperbacks at \\$4 each."),
    "80 is the money from paperbacks: 20 paperbacks at $4 each."
  );
  assert.equal(
    strip("36° is $\\angle  A$ (and $\\angle  ABD$), not $\\angle  ABC$."),
    "36° is angle A (and angle ABD), not angle ABC."
  );
  assert.equal(strip("$\\frac{a}{b}$"), "a/b");
  assert.equal(strip("gives $x = \\frac{12}{7}$."), "gives x = 12/7.");
  assert.match(strip("more than the \\$140 the store received"), /\$140/);
  assert.doesNotMatch(strip("$\\angle ABC$"), /\\/);
});

test("session report includes the score, wrong ids, and the mistake", () => {
  const session = {
    title: "Linear equations in one variable",
    mode: "practice",
    levelLabel: "All",
    elapsedMs: 125000,
    itemIds: ["QB-A1-001", "QB-A1-003"],
    responses: {
      "QB-A1-001": { correct: true, flagged: false },
      "QB-A1-003": { correct: false, flagged: true },
    },
  };
  const analysis = analyze([
    { itemId: "QB-A1-001", topicId: "A1", level: "M", correct: true, confidence: "sure", ts: 1, concepts: [], familyLabel: "" },
    { itemId: "QB-A1-003", topicId: "A1", level: "M", correct: false, confidence: "guess", ts: 2, errorType: "slip", misconception: "D4", feedback: "Took the sign the wrong way.", concepts: ["A1.C1"], familyLabel: "Distribute" },
  ], subject);
  const text = formatSessionReport({
    name: "Alex",
    subject: subject,
    session: session,
    analysis: analysis,
    reports: [{ itemId: "QB-A1-003", text: "The wording is confusing." }],
  });
  assert.match(text, /Student: Alex/);
  assert.match(text, /Score: 1\/2/);
  assert.match(text, /Wrong item IDs: QB-A1-003/);
  assert.match(text, /Flagged: QB-A1-003/);
  assert.match(text, /2 min 5 sec/);
  assert.match(text, /Took the sign the wrong way/);
  assert.match(text, /QB-A1-003: The wording is confusing/);
  assert.match(text, /Killer|Mastered/);
  assert.match(text, /Mode: Question bank/);
});

test("My Analysis counts practice tests and custom tests, not the question bank", () => {
  const kept = testAttempts([
    { itemId: "bank", mode: "practice", correct: false, ts: 1 },
    { itemId: "again", mode: "retry", correct: false, ts: 2 },
    { itemId: "old", correct: false, ts: 3 },
    { itemId: "timed", mode: "timed", topicId: "A1", level: "M", correct: true, confidence: "sure", ts: 4 },
    { itemId: "custom", mode: "test", topicId: "A1", level: "H", correct: false, confidence: "sure", ts: 5, errorType: "concept", misconception: "D4", feedback: "Mixed the steps." },
  ]);
  assert.deepEqual(kept.map((row) => row.itemId), ["timed", "custom"]);
  const analysis = analyze(kept, subject);
  assert.equal(analysis.attempted, 2);
  assert.equal(analysis.correct, 1);
});

test("a custom test prefers unseen questions and can add misses", () => {
  const items = [
    { id: "new", topicId: "A1", level: "M" },
    { id: "miss", topicId: "A1", level: "M" },
    { id: "ok", topicId: "A1", level: "M" },
    { id: "other", topicId: "A2", level: "M" },
    { id: "hard", topicId: "A1", level: "H" },
  ];
  const attempts = [
    { itemId: "miss", correct: false, ts: 1 },
    { itemId: "ok", correct: true, ts: 2 },
    { itemId: "miss", correct: true, ts: 0 },
  ];
  const spec = { topicIds: ["A1"], levels: ["M"] };
  assert.deepEqual(selectCustomPool(items, attempts, Object.assign({ preferUnseen: true, includeMissed: false }, spec)).map((item) => item.id), ["new"]);
  assert.deepEqual(selectCustomPool(items, attempts, Object.assign({ preferUnseen: true, includeMissed: true }, spec)).map((item) => item.id), ["new", "miss"]);
  assert.deepEqual(selectCustomPool(items, attempts, Object.assign({ preferUnseen: false, includeMissed: false }, spec)).map((item) => item.id), ["new", "ok"]);
  assert.deepEqual(selectCustomPool(items, attempts, Object.assign({ preferUnseen: false, includeMissed: true }, spec)).map((item) => item.id), ["new", "ok", "miss"]);
});
