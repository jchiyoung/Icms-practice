/**
 * Render at least two items per topic and walk the class flow.
 * Saves screenshots under /opt/cursor/artifacts/spotchecks.
 */
const fs = require("node:fs");
const path = require("node:path");
const puppeteer = require("puppeteer-core");
const { unseal } = require("../js/seal.js");

const ROOT = path.join(__dirname, "..");
const BASE = process.env.BASE || "http://127.0.0.1:4731";
const OUT = process.env.SHOTS || "/opt/cursor/artifacts/spotchecks";
const subject = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "subjects", "sat-math.json"), "utf8"));

function picks() {
  const byTopic = new Map();
  for (const item of subject.items) {
    if (!byTopic.has(item.topicId)) byTopic.set(item.topicId, []);
    byTopic.get(item.topicId).push(item);
  }
  const chosen = [];
  for (const items of byTopic.values()) {
    const choiceFig = items.find((item) => (item.choices || []).some((choice) => choice.figure));
    const fig = items.find((item) => item.figures && item.figures.length);
    const spr = items.find((item) => item.format === "spr");
    const mc = items.find((item) => item.format === "mc");
    const list = [];
    for (const item of [choiceFig, fig, spr, mc]) {
      if (item && !list.includes(item)) list.push(item);
      if (list.length === 2) break;
    }
    chosen.push(...list);
  }
  return chosen;
}

async function openHash(page, hash) {
  await page.evaluate((next) => {
    location.hash = next;
  }, hash);
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

async function assertItem(page, item) {
  await page.waitForSelector("#stem", { timeout: 20000 });
  const id = await page.$eval("#question", (el) => el.getAttribute("data-item-id"));
  if (id !== item.id) throw new Error("Opened " + id + " instead of " + item.id);
  const errors = await page.$$eval(".katex-error", (nodes) => nodes.length);
  if (errors) throw new Error(item.id + " has " + errors + " KaTeX errors");
  const stemText = await page.$eval("#stem", (el) => el.innerText.trim());
  if (!stemText) throw new Error(item.id + " stem is empty");
  if ((item.stem || "").includes("$")) {
    const katexCount = await page.$$eval("#stem .katex", (nodes) => nodes.length);
    if (!katexCount) throw new Error(item.id + " stem math did not render");
  }
  if (item.figures && item.figures.length) {
    const width = await page.$eval(".figure svg", (el) => el.getBoundingClientRect().width);
    if (width < 20) throw new Error(item.id + " figure has no width");
  }
  if (item.format === "mc") {
    const count = await page.$$eval("[data-choice]", (nodes) => nodes.length);
    if (count !== 4) throw new Error(item.id + " shows " + count + " choices");
  } else {
    const input = await page.$("#spr-input");
    if (!input) throw new Error(item.id + " missing SPR input");
  }
  const choiceFigs = (item.choices || []).filter((choice) => choice.figure).length;
  if (choiceFigs) {
    const shown = await page.$$eval(".choice-figure svg", (nodes) => nodes.length);
    if (shown !== choiceFigs) throw new Error(item.id + " choice figures " + shown + " of " + choiceFigs);
  }
  const answerLeak = await page.$("#explain, #result-banner");
  if (answerLeak) throw new Error(item.id + " shows the explanation before an answer");
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || "/usr/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
  });
  const problems = [];
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(BASE + "/", { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector("#student-name");
  await shot(page, "01-name.png");
  await page.type("#student-name", "Alex");
  await page.click("[data-action='continue-name']");
  await page.waitForSelector("[data-topic='A1']");
  await shot(page, "02-home.png");

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await shot(page, "03-home-phone.png");
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });

  await page.click("[data-value='5']");
  await page.click("[data-topic='A1']");
  await page.waitForSelector("#stem");
  await shot(page, "04-question.png");

  const first = subject.items.find((item) => {
    if (item.topicId !== "A1" || item.format !== "mc") return false;
    const sealed = unseal(item.seal, item.id);
    return sealed.notes && Object.keys(sealed.notes).some((key) => sealed.notes[key] && sealed.notes[key].feedback);
  });
  if (!first) throw new Error("No A1 multiple-choice item with distractor feedback");
  const firstId = first.id;
  await openHash(page, "#/item/" + firstId);
  await page.waitForFunction((id) => {
    const el = document.querySelector("#question");
    return el && el.getAttribute("data-item-id") === id;
  }, { timeout: 20000 }, firstId);
  await assertItem(page, first);
  const hidden = unseal(first.seal, first.id);
  if (first.format === "mc") {
    const wrong = first.choices.find((choice) => choice.key !== hidden.answer.key);
    await page.click("[data-choice='" + wrong.key + "']");
    await page.click("[data-confidence='guess']");
    await page.click("#submit-btn");
    await page.waitForSelector("#explain");
    const banner = await page.$eval("#result-banner", (el) => el.innerText);
    if (!/Not yet|guessed|50-50|Correct/i.test(banner)) throw new Error("Unexpected banner: " + banner);
    if (hidden.notes[wrong.key] && hidden.notes[wrong.key].feedback) {
      const callout = await page.$eval(".callout", (el) => el.innerText);
      if (callout.length < 8) throw new Error("Missing distractor feedback");
    }
    await shot(page, "05-explanation.png");
    await page.click("#retry-btn");
    await page.waitForSelector("[data-choice]");
    const leaked = await page.$("#explain");
    if (leaked) throw new Error("Retry still shows the explanation");
    await page.click("[data-choice='" + hidden.answer.key + "']");
    await page.click("[data-confidence='sure']");
    await page.click("#submit-btn");
    await page.waitForSelector("#result-banner");
    const good = await page.$eval("#result-banner", (el) => el.innerText);
    if (!/mastered/i.test(good)) throw new Error("Sure correct should be mastered: " + good);
  }
  await page.click("[data-sense='confused']");
  await page.click("details.report summary");
  await page.waitForSelector("#report-text", { visible: true });
  await page.type("#report-text", "The wording is confusing.");
  await page.click("[data-action='save-report']");
  await page.click("[data-action='results']");
  await page.waitForSelector("#copy-btn");
  await shot(page, "06-results.png");
  await page.click("#copy-btn");
  await page.waitForFunction(() => window.__lastCopy && window.__lastCopy.includes("Alex"));
  const copied = await page.evaluate(() => window.__lastCopy);
  if (!copied.includes(firstId)) throw new Error("Copy text missing the item id");
  if (!/confusing/.test(copied)) throw new Error("Copy text missing the report");
  if (!/Mastered/.test(copied)) throw new Error("Copy text missing mastery");

  await page.click("[data-action='analysis']");
  await page.waitForSelector("h1");
  await shot(page, "07-analysis.png");

  await openHash(page, "#/item/QB-A1-003");
  await page.waitForSelector("#spr-input");
  await page.type("#spr-input", "1.57");
  await page.click("[data-confidence='sure']");
  await page.click("#submit-btn");
  await page.waitForSelector("#result-banner");
  let sprBanner = await page.$eval("#result-banner", (el) => el.innerText);
  if (!/Not yet/.test(sprBanner)) throw new Error("1.57 should be incorrect: " + sprBanner);
  await page.click("#retry-btn");
  await page.waitForSelector("#spr-input");
  await page.type("#spr-input", "22/14");
  await page.click("[data-confidence='sure']");
  await page.click("#submit-btn");
  await page.waitForSelector("#explain");
  sprBanner = await page.$eval("#result-banner", (el) => el.innerText);
  if (!/mastered/i.test(sprBanner)) throw new Error("22/14 should be mastered: " + sprBanner);
  await shot(page, "08-spr-correct.png");

  await openHash(page, "#/");
  await page.waitForSelector("[data-topic='G1']");
  await page.click("[data-value='timed']");
  await page.click("[data-topic='G1']");
  await page.waitForSelector("#timer");
  await shot(page, "09-timed.png");

  const chosen = picks();
  if (chosen.length < 38) throw new Error("Expected 38 spot checks, got " + chosen.length);
  for (const item of chosen) {
    try {
      await openHash(page, "#/item/" + item.id);
      await page.waitForFunction((id) => {
        const el = document.querySelector("#question");
        return el && el.getAttribute("data-item-id") === id;
      }, { timeout: 20000 }, item.id);
      await assertItem(page, item);
      await shot(page, "item-" + item.id + ".png");
    } catch (err) {
      problems.push(item.id + ": " + err.message);
    }
  }

  const filePage = await browser.newPage();
  await filePage.setViewport({ width: 1280, height: 900 });
  await filePage.goto("file://" + path.join(ROOT, "dist", "icms-sat-practice.html"), { waitUntil: "load", timeout: 60000 });
  await filePage.waitForSelector("#student-name", { timeout: 20000 });
  await filePage.type("#student-name", "Alex");
  await filePage.click("[data-action='continue-name']");
  await filePage.waitForSelector("[data-topic='A2']");
  await openHash(filePage, "#/item/QB-A2-002");
  await filePage.waitForFunction(() => {
    const el = document.querySelector("#question");
    return el && el.getAttribute("data-item-id") === "QB-A2-002";
  }, { timeout: 20000 });
  await filePage.waitForSelector(".figure svg", { timeout: 20000 });
  const fileErrors = await filePage.$$eval(".katex-error", (nodes) => nodes.length);
  if (fileErrors) problems.push("single-file has KaTeX errors");
  const fileWidth = await filePage.$eval(".figure svg", (el) => el.getBoundingClientRect().width);
  if (fileWidth < 20) problems.push("single-file figure did not draw");
  await filePage.screenshot({ path: path.join(OUT, "10-single-file.png"), fullPage: true });
  await filePage.close();

  await browser.close();
  const report = {
    checked: chosen.length,
    topics: new Set(chosen.map((item) => item.topicId)).size,
    problems: problems,
    consoleErrors: consoleErrors,
  };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join("/opt/cursor/artifacts", "spotcheck-report.json"), JSON.stringify(report, null, 2));
  if (problems.length || consoleErrors.length) {
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }
  console.log("Spot-checked " + chosen.length + " items across " + report.topics + " topics.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
