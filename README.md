# ICMS Practice

Practice app for IC Math & Science. Students pick a subject, a topic, and a short set of questions. Progress stays on the device. SAT Math is the first subject: 19 topics, 50 questions each.

There is no login and no server-side code. The same app can be hosted as a static site or handed out as one HTML file.

## Use it in class

Open [dist/icms-sat-practice.html](dist/icms-sat-practice.html) in Chrome. Double-click the file. It works offline, including the math fonts and the figures.

A student types a first name, picks a level and a mode, then taps a topic.

- **Practice** checks each question immediately.
- **Timed set** runs a timer and shows the score at the end.
- **Sure / 50-50 / Guessed** is required before an answer counts. Right and sure is mastered. A correct guess is not.
- After the explanation, **Did this make sense?** is saved.
- **Copy results** produces plain text for the teacher: score, wrong item ids, time, mistake patterns, weak spots, and any problem notes.
- **My analysis** and **Print** show the same picture for everything that student has done in the subject.

Switching the name on the device keeps a separate record for each student.

## Run it locally

```bash
npm install
npm start
```

Open http://127.0.0.1:4731

`npm test` rebuilds the SAT Math subject file, checks the grid-in grader, and renders all 950 items.

`npm run build` writes `dist/icms-sat-practice.html`.

## Host it

The repository is a static site. On Vercel, import the repo and leave the framework unset. `vercel.json` builds the subject file, the single-file page, and a `public/` folder.

You can also upload `dist/icms-sat-practice.html` anywhere a browser can open it. No build step is required on the machine that serves that one file.

## How to add a subject

Adding a subject is data only. Do not edit the app scripts.

1. Add `data/subjects/<id>.json` using the shape below.
2. Add one line to `data/subjects` in `data/registry.json`:

```json
{
  "subjects": [
    { "id": "sat-math", "file": "data/subjects/sat-math.json" },
    { "id": "ap-chemistry", "file": "data/subjects/ap-chemistry.json" }
  ]
}
```

3. Rebuild the single file with `npm run build` if you hand that file out. The multi-file site picks up the registry on refresh.

The home screen lists every subject in the registry. Progress and analysis are stored per subject, under the student name.

### Subject file

```json
{
  "schemaVersion": 1,
  "id": "ap-chemistry",
  "title": "AP Chemistry",
  "blurb": "One unit at a time.",
  "calculator": { "label": "Desmos", "href": "https://www.desmos.com/calculator" },
  "setSizes": [5, 10, 20],
  "levels": [
    { "id": "M", "label": "M", "name": "Medium" },
    { "id": "H", "label": "H", "name": "Hard" }
  ],
  "errorTypes": {
    "slip": "Careless slip",
    "concept": "Concept mix-up",
    "setup": "Set-up error"
  },
  "conceptLabels": { "STOICH.1": "Limiting reactant" },
  "domains": [
    {
      "id": "stoichiometry",
      "title": "Stoichiometry",
      "topics": [{ "id": "STOICH", "title": "Limiting reactants" }]
    }
  ],
  "items": []
}
```

`calculator` is optional. Leave it out when a subject should not show the calculator button. `conceptLabels` is optional; the analysis falls back to each item's family label.

### Item

Supported formats are `mc` (multiple choice, also accepted as `mcq` by the SAT importer) and `spr` (typed response).

```json
{
  "id": "CHEM-STOICH-001",
  "topicId": "STOICH",
  "level": "M",
  "format": "mc",
  "stem": "What is $2+2$?",
  "stemAfter": "",
  "figures": [{ "id": "fig1", "alt": "A balance.", "svg": "<svg></svg>" }],
  "choices": [
    { "key": "A", "text": "$3$", "figure": null },
    { "key": "B", "text": "$4$", "figure": null },
    { "key": "C", "text": "$5$", "figure": null },
    { "key": "D", "text": "$6$", "figure": null }
  ],
  "seal": "..."
}
```

Math in stems, choices, and explanations is LaTeX between `$` signs. A literal dollar sign is `\$`. HTML allowed in those strings: `br`, `span class="nt"`, `b`, `i`, `sub`, `sup`, tables (`dt`, `tb`, or `t`), and an inline `svg`.

Figures can be inline `svg` or omitted. Put the picture's description in `alt`.

The `seal` hides the answer key, choice notes, common wrong answers, concept tags, and the explanation until the student submits. Build it with `js/seal.js` (`seal(payload, itemId)`). Payload:

```json
{
  "answer": { "format": "mc", "key": "B" },
  "notes": {
    "A": { "errorType": "slip", "misconception": "OFF_BY_ONE", "feedback": "Counted one short." }
  },
  "commonWrong": [],
  "concepts": ["STOICH.1"],
  "family": "limiting-reactant",
  "familyLabel": "Limiting reactant",
  "solution": {
    "keyIdea": "",
    "steps": "",
    "why": "",
    "check": "",
    "beCareful": "",
    "anotherWay": "",
    "desmos": "",
    "extra": [{ "label": "Units", "html": "Keep the unit on the answer." }]
  }
}
```

For a typed response:

```json
"format": "spr",
"decimalRule": "bluebook",
"answer": { "format": "spr", "values": ["3/2", "1.5"], "decimalRule": "bluebook" }
```

`decimalRule` `"bluebook"` accepts equivalent fractions and decimals, with truncation or rounding at the most decimal places that fit in 5 characters (6 if the value is negative). `"exact"` accepts only values equal to a listed value. Put the same rule on the public item (`decimalRule`) and inside the sealed answer. `commonWrong` entries use `{ "value", "errorType", "misconception", "feedback" }` and are matched with the same rules.

Empty solution fields are skipped. Mastery uses the latest attempt: correct and confidence `sure`. Confidence `guess` or `fifty` does not count as mastered.

The SAT Math banks in `content/sat-math/` are converted by `npm run import`. Two solution notes (`QB-A4-036`, `QB-G1-028`) had a JSON `\f` escape where `\frac` was intended; the importer restores those fractions.

## Checks

- `npm test` grades fractions, decimals, negatives, and truncation against every listed answer, then renders all 950 items.
- `npm run spotcheck` opens the app in headless Chrome, walks a set, and screenshots two items from each topic. The dev server must be running.
