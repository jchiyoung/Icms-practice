const test = require("node:test");
const assert = require("node:assert/strict");
const { analyze, formatSessionReport } = require("../js/analysis.js");

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
  assert.equal(analysis.patterns[0].errorLabel, "Concept gap");
  assert.match(analysis.patterns[0].feedbackText, /Sign error/);
  assert.equal(analysis.byLevel.find((row) => row.levelId === "H+").label, "Killer");
  const weak = analysis.concepts.find((row) => row.code === "A1.C4");
  assert.ok(weak);
  assert.equal(weak.notMastered, 2);
  assert.match(weak.label, /Identity constant/);
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
});
