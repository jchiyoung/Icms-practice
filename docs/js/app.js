(function () {
  "use strict";

  const app = document.getElementById("app");
  const state = {
    subjects: [],
    subjectId: "",
    view: "loading",
    error: "",
    session: null,
    prefs: { level: "all", mode: "timed", count: 10 },
    name: "",
    nameDraft: "",
    nameError: "",
    notice: "",
    pendingHash: "",
    keepScroll: false,
    focusQuestion: false,
    practiceSets: null,
  };
  let suppressHash = false;
  let timerId = 0;

  function h(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function rich(src, tag) {
    const name = tag || "div";
    return "<" + name + ' class="rich" data-rich>' + ICMS.sanitizeRich(src || "") + "</" + name + ">";
  }

  function currentSubject() {
    return state.subjects.find(function (subject) { return subject.id === state.subjectId; }) || state.subjects[0] || null;
  }

  function subjectById(id) {
    return state.subjects.find(function (subject) { return subject.id === id; }) || null;
  }

  function itemById(subject, id) {
    if (!subject) return null;
    if (!subject._map) subject._map = new Map(subject.items.map(function (item) { return [item.id, item]; }));
    return subject._map.get(id) || null;
  }

  function findTopic(subject, id) {
    const domains = (subject && subject.domains) || [];
    for (let i = 0; i < domains.length; i++) {
      const topics = domains[i].topics || [];
      for (let j = 0; j < topics.length; j++) {
        if (topics[j].id === id) return Object.assign({ domainTitle: domains[i].title }, topics[j]);
      }
    }
    return null;
  }

  function profile() {
    const name = ICMS.currentName();
    return name ? ICMS.loadProfile(name) : null;
  }

  function attemptsOf(subjectId) {
    const data = profile();
    if (!data || !data.subjects[subjectId]) return [];
    return data.subjects[subjectId].attempts || [];
  }

  function testAttemptsOf(subjectId) {
    return ICMS.testAttempts(attemptsOf(subjectId));
  }

  function bankAttemptsOf(subjectId) {
    return attemptsOf(subjectId).filter(function (attempt) {
      return !ICMS.isTestMode(attempt.mode);
    });
  }

  function isTestMode(mode) {
    return ICMS.isTestMode(mode);
  }

  function reportsOf(subjectId) {
    const data = profile();
    if (!data || !data.subjects[subjectId]) return [];
    return data.subjects[subjectId].reports || [];
  }

  function cleanName(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length < 1 || text.length > 40) return "";
    if (!/^[\p{L}\p{M}\p{N} .'-]+$/u.test(text)) return "";
    return text;
  }

  function levelClass(id) {
    if (id === "H+") return "lv-killer";
    if (id === "H") return "lv-h";
    if (id === "M") return "lv-m";
    return "lv-x";
  }

  function shuffle(list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  function setHash(hash) {
    const current = location.hash || "#/";
    if (current === hash) return;
    suppressHash = true;
    location.hash = hash;
  }

  function saveSession() {
    ICMS.saveSession(state.session);
  }

  function ensureResponse(itemId) {
    const session = state.session;
    if (!session.responses[itemId]) session.responses[itemId] = {};
    return session.responses[itemId];
  }

  function isRevealed(session, itemId) {
    const response = session.responses[itemId];
    if (response && response.forceHidden) return false;
    if (isTestMode(session.mode)) return !!session.finalized;
    return !!(response && response.revealed);
  }

  function grade(item, raw) {
    let hidden;
    try {
      hidden = ICMS.unseal(item.seal, item.id);
    } catch (err) {
      return { invalid: true, message: "This question's answer key could not be read. Report it and try the next one." };
    }
    if (item.format === "mc") {
      const key = hidden.answer && hidden.answer.key;
      const correct = raw === key;
      const note = !correct && hidden.notes ? hidden.notes[raw] : null;
      return {
        hidden: hidden,
        correct: correct,
        errorType: note ? note.errorType || "" : "",
        misconception: note ? note.misconception || "" : "",
        feedback: note ? note.feedback || "" : "",
        acceptedPreview: key,
      };
    }
    const answer = hidden.answer || {};
    const graded = ICMS.gradeSpr(raw, answer.values || [], answer.decimalRule || item.decimalRule || "bluebook");
    if (graded.status === "invalid") return { invalid: true, message: graded.message, hidden: hidden };
    let note = null;
    if (graded.status !== "correct") {
      const wrongs = hidden.commonWrong || [];
      for (let i = 0; i < wrongs.length; i++) {
        const hit = ICMS.gradeSpr(raw, [wrongs[i].value], answer.decimalRule || "bluebook");
        if (hit.status === "correct") {
          note = wrongs[i];
          break;
        }
      }
    }
    const values = answer.values || [];
    return {
      hidden: hidden,
      correct: graded.status === "correct",
      errorType: note ? note.errorType || "" : "",
      misconception: note ? note.misconception || "" : "",
      feedback: note ? note.feedback || "" : "",
      acceptedPreview: values.find(function (value) { return String(value).includes("/"); }) || values[0] || "",
    };
  }

  function storeGrade(item, response, graded) {
    const hidden = graded.hidden;
    response.correct = graded.correct;
    response.errorType = graded.errorType || "";
    response.misconception = graded.misconception || "";
    response.feedback = graded.feedback || "";
    response.acceptedPreview = graded.acceptedPreview || "";
    response.topicId = item.topicId;
    response.level = item.level;
    response.concepts = (hidden && hidden.concepts) || [];
    response.familyLabel = (hidden && hidden.familyLabel) || "";
    response.attemptTs = Date.now();
    const attempt = {
      itemId: item.id,
      topicId: item.topicId,
      level: item.level,
      format: item.format,
      response: response.response,
      correct: graded.correct,
      confidence: response.confidence,
      mastered: graded.correct === true && response.confidence === "sure",
      sense: response.sense || null,
      errorType: response.errorType,
      misconception: response.misconception,
      feedback: response.feedback,
      concepts: response.concepts,
      familyLabel: response.familyLabel,
      mode: state.session.mode,
      ts: response.attemptTs,
    };
    const data = profile();
    ICMS.recordAttempt(data, state.session.subjectId, attempt);
    response.attemptSaved = true;
  }

  const PER_QUESTION_MS = 2 * 60 * 1000;

  function timedLimitMs(count) {
    return Math.max(1, count || 1) * PER_QUESTION_MS;
  }

  function ensureLimit(session) {
    if (!session || session.mode !== "timed") return;
    if (!(session.limitMs > 0)) session.limitMs = timedLimitMs((session.itemIds || []).length);
  }

  function remainingMs(session) {
    if (!session) return 0;
    ensureLimit(session);
    const started = session.startedAt || Date.now();
    return Math.max(0, session.limitMs - (Date.now() - started));
  }

  function formatClock(ms) {
    const sec = Math.ceil(Math.max(0, ms) / 1000);
    const minutes = Math.floor(sec / 60);
    const seconds = sec % 60;
    return (minutes < 10 ? "0" : "") + minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
  }

  function countdownActive(session) {
    return !!(session && session.mode === "timed" && !session.finalized && !session.completed && state.view !== "name" && state.view !== "loading" && state.view !== "error");
  }

  function freezeElapsed(session) {
    if (!session || session.elapsedFrozen) return;
    const started = session.startedAt || Date.now();
    let elapsed = Math.max(0, Date.now() - started);
    if (session.mode === "timed") {
      ensureLimit(session);
      if (session.limitMs > 0) elapsed = Math.min(elapsed, session.limitMs);
    }
    session.elapsedMs = elapsed;
    session.elapsedFrozen = true;
  }

  function finalizeTimed() {
    const session = state.session;
    if (!session || session.finalized) return;
    session.itemIds.forEach(function (id) {
      const response = session.responses[id];
      if (!response || response.attemptSaved) return;
      if (!response.response || !response.confidence) return;
      const subject = subjectById(session.subjectId);
      const item = itemById(subject, id);
      if (!item) return;
      const graded = grade(item, response.response);
      if (graded.invalid) return;
      storeGrade(item, response, graded);
    });
    session.finalized = true;
    freezeElapsed(session);
    saveSession();
  }

  function sessionStillOpen(session) {
    if (!session || !session.itemIds || !session.itemIds.length) return false;
    if (session.completed || session.finalized) return false;
    if (!isTestMode(session.mode)) {
      const allRevealed = session.itemIds.every(function (id) {
        const response = session.responses && session.responses[id];
        return response && response.revealed;
      });
      if (allRevealed) return false;
    }
    return true;
  }

  function desmosDismissed(html) {
    const text = ICMS.strip(html).toLowerCase();
    if (!text) return true;
    return /not needed|not useful|nothing to graph|no numbers to graph|no equation|no numeric|no coordinates are given|no single graph|cannot be applied|is not useful|desmos cannot/.test(text);
  }

  function sessionAttempts(session) {
    const list = [];
    (session.itemIds || []).forEach(function (id) {
      const response = session.responses[id] || {};
      if (typeof response.correct !== "boolean") return;
      list.push({
        itemId: id,
        topicId: response.topicId,
        level: response.level,
        correct: response.correct,
        confidence: response.confidence,
        sense: response.sense || null,
        errorType: response.errorType || "",
        misconception: response.misconception || "",
        feedback: response.feedback || "",
        concepts: response.concepts || [],
        familyLabel: response.familyLabel || "",
        ts: response.attemptTs || 1,
      });
    });
    return list;
  }

  function beginSession(spec) {
    clearInterval(timerId);
    timerId = 0;
    const subject = currentSubject();
    const startedAt = Date.now();
    state.session = {
      subjectId: subject.id,
      mode: spec.mode,
      title: spec.title,
      topicId: spec.topicId || "",
      level: spec.level || "all",
      levelLabel: spec.levelLabel || (spec.level === "all" ? "All" : ICMS.levelInfo(subject, spec.level).label),
      kind: spec.kind || (spec.mode === "timed" ? "topic" : "bank"),
      itemIds: spec.itemIds,
      index: 0,
      startedAt: startedAt,
      limitMs: spec.mode === "timed" ? timedLimitMs(spec.itemIds.length) : 0,
      elapsedMs: 0,
      elapsedFrozen: false,
      completed: false,
      finalized: false,
      reviewing: false,
      responses: {},
    };
    state.view = "session";
    state.focusQuestion = true;
    state.notice = "";
    saveSession();
    setHash("#/session");
    render();
  }

  function openItem(id) {
    const subject = currentSubject();
    let found = null;
    let owner = subject;
    state.subjects.forEach(function (candidate) {
      const item = itemById(candidate, id);
      if (item) {
        found = item;
        owner = candidate;
      }
    });
    if (!found) {
      state.view = "home";
      state.notice = "That question is not in the bank.";
      render();
      return;
    }
    state.subjectId = owner.id;
    localStorage.setItem(ICMS.SUBJECT_KEY, owner.id);
    const topic = findTopic(owner, found.topicId);
    beginSession({
      mode: "practice",
      title: topic ? topic.title : found.topicId,
      topicId: found.topicId,
      level: "all",
      levelLabel: "All",
      itemIds: [found.id],
    });
  }

  function startTopic(topicId) {
    const subject = currentSubject();
    const level = state.prefs.level;
    let pool = subject.items.filter(function (item) {
      return item.topicId === topicId && (level === "all" || item.level === level);
    });
    if (!pool.length) {
      state.notice = "No questions at that level. Try All.";
      render();
      return;
    }
    const wanted = state.prefs.count === "all" ? pool.length : Number(state.prefs.count) || pool.length;
    pool = shuffle(pool).slice(0, Math.min(pool.length, wanted));
    const topic = findTopic(subject, topicId);
    beginSession({
      mode: state.prefs.mode,
      title: topic ? topic.title : topicId,
      topicId: topicId,
      level: level,
      itemIds: pool.map(function (item) { return item.id; }),
    });
  }

  function startIds(ids, title) {
    const subject = currentSubject();
    const unique = [];
    ids.forEach(function (id) {
      if (unique.indexOf(id) < 0 && itemById(subject, id)) unique.push(id);
    });
    if (!unique.length) {
      state.notice = "Those questions are not available.";
      render();
      return;
    }
    beginSession({
      mode: "retry",
      title: title,
      topicId: "",
      level: "all",
      levelLabel: "All",
      itemIds: shuffle(unique),
    });
  }

  function submitCurrent() {
    const session = state.session;
    const item = itemById(subjectById(session.subjectId), session.itemIds[session.index]);
    const response = ensureResponse(item.id);
    response.need = "";
    response.formMsg = "";
    if (item.format === "spr") response.response = String(response.response || "").trim();
    if (!response.response) {
      response.need = "answer";
      response.formMsg = item.format === "spr" ? "Type an answer first." : "Choose an answer first.";
      state.scrollTo = "form-msg";
      render();
      return;
    }
    if (!response.confidence) {
      response.need = "confidence";
      response.formMsg = "Choose Sure, 50-50, or Guessed.";
      state.scrollTo = "form-msg";
      render();
      return;
    }
    if (isTestMode(session.mode) && !session.finalized) {
      response.topicId = item.topicId;
      response.level = item.level;
      saveSession();
      advance(1);
      return;
    }
    const graded = grade(item, response.response);
    if (graded.invalid) {
      response.formMsg = graded.message;
      render();
      return;
    }
    storeGrade(item, response, graded);
    response.revealed = true;
    response.forceHidden = false;
    saveSession();
    state.scrollTo = "result-banner";
    render();
  }

  function advance(step) {
    const session = state.session;
    const next = session.index + step;
    if (next < 0) return;
    if (next >= session.itemIds.length) {
      showResults();
      return;
    }
    session.index = next;
    state.focusQuestion = true;
    saveSession();
    render();
  }

  function showResults() {
    const session = state.session;
    if (!session) return;
    if (session.completed && session.finalized && state.view === "results") return;
    if (isTestMode(session.mode) && !session.finalized) finalizeTimed();
    else freezeElapsed(session);
    session.completed = true;
    session.finalized = true;
    session.reviewing = false;
    saveSession();
    state.view = "results";
    setHash("#/session");
    render();
  }

  function goTopics() {
    state.view = "home";
    state.notice = "";
    setHash("#/");
    render();
  }

  function continueName() {
    const cleaned = cleanName(state.nameDraft || "");
    if (!cleaned) {
      state.nameError = "Type your first name. Letters, numbers, spaces, hyphens, and apostrophes are fine.";
      render();
      return;
    }
    ICMS.setCurrentName(cleaned);
    const data = ICMS.loadProfile(cleaned);
    data.name = cleaned;
    ICMS.saveProfile(data);
    state.name = cleaned;
    state.nameError = "";
    const pending = state.pendingHash;
    state.pendingHash = "";
    if (pending && pending !== "#/" && pending !== "#") {
      if ((location.hash || "#/") !== pending) {
        suppressHash = true;
        location.hash = pending;
      }
      route();
      return;
    }
    state.view = "home";
    setHash("#/");
    render();
  }

  async function copyText(text) {
    window.__lastCopy = text;
    let copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch (err) {
      copied = false;
    }
    if (!copied) {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      try {
        copied = document.execCommand("copy");
      } catch (err) {
        copied = false;
      }
      area.remove();
    }
    state.notice = copied ? "Copied. Paste it to your teacher." : "Clipboard blocked. Use Preview the text and copy from there.";
    render();
  }

  function header() {
    const session = state.session;
    const subject = session && session.subjectId ? subjectById(session.subjectId) || currentSubject() : currentSubject();
    let tools = "";
    if (state.view === "session" && session) {
      const item = itemById(subjectById(session.subjectId), session.itemIds[session.index]);
      const response = item ? session.responses[item.id] || {} : {};
      if (state.name) tools += '<button type="button" class="header-btn" data-action="analysis">My analysis</button>';
      if (item) {
        tools += '<button type="button" class="header-btn" data-action="flag" aria-pressed="' + (response.flagged ? "true" : "false") + '">' + (response.flagged ? "Flagged" : "Flag") + "</button>";
      }
      const calc = subject && subject.calculator;
      if (calc && calc.href) {
        tools += '<a class="header-link" target="_blank" rel="noopener" href="' + h(calc.href) + '">' + h(calc.label || "Calculator") + "</a>";
      }
      const any = session.itemIds.some(function (id) {
        const response = session.responses[id];
        return response && (response.response || response.revealed);
      });
      if (any || session.finalized) tools += '<button type="button" class="header-btn" data-action="results">Results</button>';
    } else if (state.name && state.view !== "name") {
      tools += '<button type="button" class="header-btn" data-action="analysis">My analysis</button>';
      tools += '<button type="button" class="header-btn" data-action="switch-student">Not ' + h(state.name.split(" ")[0]) + "?</button>";
    }
    let countdown = "";
    if (countdownActive(session)) {
      const left = remainingMs(session);
      const tone = left <= 30000 ? " danger" : left <= 60000 ? " warn" : "";
      const progress = (session.index + 1) + "/" + session.itemIds.length;
      countdown =
        '<div class="countdown-bar' + tone + '" id="countdown" role="timer" aria-label="' + h(formatClock(left) + " remaining, question " + (session.index + 1) + " of " + session.itemIds.length) + '">' +
        '<span class="countdown-time" id="timer">' + formatClock(left) + "</span>" +
        '<span class="countdown-progress" id="countdown-progress">' + progress + "</span>" +
        "</div>";
    }
    return (
      '<header class="app-header' + (countdown ? " has-countdown" : "") + '">' +
      '<div class="brand"><span class="mark">IC</span><span><span class="brand-text">ICMS Practice</span><span class="brand-sub">by IC Math &amp; Science</span></span></div>' +
      (tools ? '<div class="header-tools">' + tools + "</div>" : "") +
      countdown +
      "</header>"
    );
  }

  function renderName() {
    return (
      '<section class="card stack">' +
      "<h1>Who's practicing?</h1>" +
      '<p class="screen-hint">Your name stays on this device and shows up on the results you send your teacher.</p>' +
      '<label class="field"><span>First name</span><input id="student-name" type="text" maxlength="40" autocomplete="given-name" placeholder="Alex" value="' + h(state.nameDraft || "") + '"></label>' +
      (state.nameError ? '<p class="form-msg">' + h(state.nameError) + "</p>" : "") +
      '<button type="button" class="btn primary wide" data-action="continue-name">Continue</button>' +
      "</section>"
    );
  }

  function renderHome() {
    const subject = currentSubject();
    const bankLatest = ICMS.latestByItem(bankAttemptsOf(subject.id));
    const rows = Array.from(bankLatest.values());
    const wrongIds = rows.filter(function (row) { return !row.correct; }).map(function (row) { return row.itemId; });
    let sizes = subject.setSizes && subject.setSizes.length ? subject.setSizes.slice() : [5, 10, 20];
    if (state.prefs.mode === "timed" && sizes.indexOf(3) < 0) sizes.unshift(3);
    let subjectsHtml = "";
    if (state.subjects.length > 1) {
      subjectsHtml = '<div class="subject-row">' + state.subjects.map(function (entry) {
        return '<button type="button" class="subject-card" data-action="pick-subject" data-subject="' + h(entry.id) + '" aria-pressed="' + (entry.id === subject.id ? "true" : "false") + '"><strong>' + h(entry.title) + "</strong><span>" + h(entry.blurb || "Practice") + "</span></button>";
      }).join("") + "</div>";
    }
    const levelChips = '<button type="button" class="chip" data-action="set-pref" data-pref="level" data-value="all" aria-pressed="' + (state.prefs.level === "all" ? "true" : "false") + '">All</button>' +
      (subject.levels || []).map(function (level) {
        return '<button type="button" class="chip" data-action="set-pref" data-pref="level" data-value="' + h(level.id) + '" aria-pressed="' + (state.prefs.level === level.id ? "true" : "false") + '">' + h(level.label) + "</button>";
      }).join("");
    const modeChips =
      '<button type="button" class="chip" data-action="set-pref" data-pref="mode" data-value="timed" aria-pressed="' + (state.prefs.mode === "timed" ? "true" : "false") + '">Practice test</button>' +
      '<button type="button" class="chip" data-action="set-pref" data-pref="mode" data-value="practice" aria-pressed="' + (state.prefs.mode === "practice" ? "true" : "false") + '">Question bank</button>';
    const countChips = sizes.map(function (size) {
      return '<button type="button" class="chip" data-action="set-pref" data-pref="count" data-value="' + size + '" aria-pressed="' + (String(state.prefs.count) === String(size) ? "true" : "false") + '">' + size + "</button>";
    }).join("") + '<button type="button" class="chip" data-action="set-pref" data-pref="count" data-value="all" aria-pressed="' + (state.prefs.count === "all" ? "true" : "false") + '">All</button>';
    const modeNote = state.prefs.mode === "timed"
      ? "Practice test on one topic. 2 minutes per question. It counts toward My Analysis."
      : "Question bank. You check each question right away. It does not change My Analysis.";
    let topics = "";
    (subject.domains || []).forEach(function (domain) {
      topics += '<h2 class="domain-title">' + h(domain.title) + "</h2>";
      (domain.topics || []).forEach(function (topic) {
        const pool = subject.items.filter(function (item) {
          return item.topicId === topic.id && (state.prefs.level === "all" || item.level === state.prefs.level);
        });
        const done = rows.filter(function (row) { return row.topicId === topic.id; }).length;
        const detail = pool.length
          ? pool.length + " questions" + (done ? " · " + done + " done" : "")
          : "None at this level";
        topics += '<button type="button" class="topic" data-action="start-topic" data-topic="' + h(topic.id) + '"' + (pool.length ? "" : " disabled") + "><span class=\"code\">" + h(topic.id) + "</span><strong>" + h(topic.title) + "</strong><em>" + h(detail) + "</em></button>";
      });
    });
    let resume = "";
    if (sessionStillOpen(state.session)) {
      resume = '<div class="card continue-card"><div><strong>Continue</strong><div class="muted">' + h(state.session.title) + " · question " + (state.session.index + 1) + " of " + state.session.itemIds.length + "</div></div><button type=\"button\" class=\"btn primary\" data-action=\"resume\">Continue</button></div>";
    }
    const offline = window.ICMS_DATA ? "" : '<p class="muted no-print"><a href="dist/icms-sat-practice.html">Offline single-file copy</a></p>';
    return (
      subjectsHtml +
      "<h1>Hi, " + h(state.name.split(" ")[0]) + ".</h1>" +
      '<p class="screen-hint">Take a practice test, check My Analysis, practice weak topics in the Question Bank, then Build My Test.</p>' +
      (state.notice ? '<p class="notice">' + h(state.notice) + "</p>" : "") +
      resume +
      '<section class="card setup">' +
      "<p>Start with</p><div class=\"chips\">" + modeChips + "</div><p class=\"mode-note\">" + modeNote + "</p>" +
      "<p>Level</p><div class=\"chips\">" + levelChips + "</div>" +
      "<p>How many</p><div class=\"chips\">" + countChips + "</div>" +
      (state.prefs.mode !== "timed" && wrongIds.length ? '<button type="button" class="btn ghost" data-action="retry-wrong">Retry ' + wrongIds.length + " missed question" + (wrongIds.length === 1 ? "" : "s") + "</button>" : "") +
      '<button type="button" class="btn primary" data-action="build-test">Build My Test</button>' +
      '<p class="mode-note">Or mix topics and levels into your own test. A custom test counts toward My Analysis.</p>' +
      "</section>" +
      "<h2>Topics</h2>" +
      '<div class="topics">' + topics + "</div>" +
      offline
    );
  }

  function renderSession() {
    const session = state.session;
    session.responses = session.responses || {};
    const subject = subjectById(session.subjectId) || currentSubject();
    const item = itemById(subject, session.itemIds[session.index]);
    if (!item) return '<section class="card"><h1>That set is missing a question.</h1><button class="btn primary" data-action="topics">Topics</button></section>';
    const response = ensureResponse(item.id);
    const revealed = isRevealed(session, item.id);
    let hidden = null;
    if (revealed) {
      try { hidden = ICMS.unseal(item.seal, item.id); }
      catch (err) { hidden = null; }
    }
    const level = ICMS.levelInfo(subject, item.level);
    const numbers = session.itemIds.map(function (id, index) {
      const row = session.responses[id] || {};
      const show = isRevealed(session, id);
      let cls = "qnum";
      if (index === session.index) cls += " current";
      if (row.flagged) cls += " flagged";
      if (row.response || row.revealed) cls += " answered";
      if (show && row.correct === true) cls += " good";
      if (show && row.correct === false) cls += " bad";
      return '<button type="button" class="' + cls + '" data-action="goto" data-index="' + index + '">' + (index + 1) + "</button>";
    }).join("");
    const figures = (item.figures || []).map(function (fig) {
      return '<figure class="figure"><div class="svg-host">' + fig.svg + '</div><figcaption class="sr-only">' + h(fig.alt || "") + "</figcaption></figure>";
    }).join("");
    let answerUi = "";
    if (item.format === "mc") {
      answerUi = '<div class="choices">' + (item.choices || []).map(function (choice) {
        const selected = response.response === choice.key;
        let cls = "choice";
        if (selected) cls += " selected";
        if (revealed && hidden && hidden.answer && choice.key === hidden.answer.key) cls += " right";
        if (revealed && selected && hidden && hidden.answer && choice.key !== hidden.answer.key) cls += " wrong";
        const fig = choice.figure ? '<div class="choice-figure"><div class="svg-host">' + choice.figure.svg + "</div></div>" : "";
        return '<div class="' + cls + '" role="button" tabindex="0" data-action="choice" data-choice="' + h(choice.key) + '" aria-pressed="' + (selected ? "true" : "false") + '"><span class="letter">' + h(choice.key) + '</span><span>' + (choice.text ? rich(choice.text, "span") : "") + fig + "</span></div>";
      }).join("") + "</div>";
    } else {
      const limitNote = "Type a number, fraction (like 3/4), or decimal.";
      answerUi =
        '<label class="field"><span>Your answer</span><input id="spr-input" type="text" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + h(response.response || "") + '"' + (revealed ? " readonly" : "") + "></label>" +
        (revealed
          ? '<p class="muted">' + limitNote + "</p>"
          : '<p class="muted" id="spr-count">' + h(sprCount(response.response || "")) + " · " + limitNote + "</p>");
    }
    const conf = ["sure", "Sure", "fifty", "50-50", "guess", "Guessed"];
    let confHtml = '<div class="confidence' + (response.need === "confidence" ? " need" : "") + '"><p>How sure are you?</p><div class="conf-row">';
    for (let i = 0; i < conf.length; i += 2) {
      confHtml += '<button type="button" class="chip" data-action="confidence" data-confidence="' + conf[i] + '" aria-pressed="' + (response.confidence === conf[i] ? "true" : "false") + '">' + conf[i + 1] + "</button>";
    }
    confHtml += "</div></div>";
    let banner = "";
    let explanation = "";
    if (revealed) {
      const correct = response.correct === true;
      const noAnswer = !response.response;
      let tone = correct ? "good" : "bad";
      let title = "Not yet.";
      if (noAnswer) {
        tone = "warn";
        title = "No answer was submitted.";
      } else if (correct && response.confidence === "sure") title = "Correct, and you were sure. That's mastered.";
      else if (correct && response.confidence === "guess") {
        tone = "warn";
        title = "Right, but you guessed. That is not mastered yet.";
      } else if (correct && response.confidence === "fifty") {
        tone = "warn";
        title = "Correct! Since you weren't sure, try one more like this later.";
      }
      const preview = response.acceptedPreview || (hidden && hidden.answer && (hidden.answer.key || (hidden.answer.values || [])[0])) || "";
      banner = '<div class="banner ' + tone + '" id="result-banner" role="status">' + h(title) + (preview ? "<div>Answer: " + h(preview) + "</div>" : "") + "</div>";
      if (response.feedback) {
        explanation += '<div class="callout"><strong>Why that answer comes up</strong>' + rich(response.feedback) + "</div>";
      } else if (!correct && !noAnswer) {
        explanation += '<div class="callout"><p>Compare your answer with the steps below.</p></div>';
      }
      if (hidden && hidden.solution) {
        const primary = [
          ["keyIdea", "Key idea"],
          ["steps", "Steps"],
          ["why", "Why this works"],
        ];
        const more = [
          ["check", "Check"],
          ["beCareful", "Be careful"],
          ["anotherWay", "Another way"],
          ["desmos", "Desmos tip"],
        ];
        function solutionBlock(block) {
          const html = hidden.solution[block[0]];
          if (!html) return "";
          if (block[0] === "desmos" && desmosDismissed(html)) return "";
          return '<section class="sol-block"><h4>' + block[1] + "</h4>" + rich(html) + "</section>";
        }
        explanation += '<div class="explain" id="explain"><h3>Explanation</h3>';
        primary.forEach(function (block) { explanation += solutionBlock(block); });
        let moreHtml = "";
        more.forEach(function (block) { moreHtml += solutionBlock(block); });
        (hidden.solution.extra || []).forEach(function (extra) {
          if (!extra || !extra.html) return;
          moreHtml += '<section class="sol-block"><h4>' + h(extra.label || "Note") + "</h4>" + rich(extra.html) + "</section>";
        });
        if (moreHtml) explanation += '<details class="sol-more"><summary>Show more</summary>' + moreHtml + "</details>";
        explanation += "</div>";
      }
      const sense = response.sense || "";
      explanation += '<div class="sense"><p>Did this make sense?</p>' +
        '<button type="button" class="chip" data-action="sense" data-sense="yes" aria-pressed="' + (sense === "yes" ? "true" : "false") + '">Yes</button>' +
        '<button type="button" class="chip" data-action="sense" data-sense="confused" aria-pressed="' + (sense === "confused" ? "true" : "false") + '">Still confused</button>' +
        (sense ? '<span class="saved-note">Saved</span>' : "") +
        "</div>";
    }
    const existing = reportsOf(session.subjectId).find(function (report) { return report.itemId === item.id; });
    const draft = response.reportDraft != null ? response.reportDraft : (existing ? existing.text : "");
    const report = '<details class="report"><summary>Report a problem</summary><p class="muted">Saved on this device and included when you copy results. Item ' + h(item.id) + '.</p><textarea id="report-text" placeholder="What looks wrong?">' + h(draft) + '</textarea><button type="button" class="btn ghost" data-action="save-report">Save note</button></details>';
    const last = session.index >= session.itemIds.length - 1;
    const hint = revealed
      ? "Read the explanation, then say if it made sense."
      : isTestMode(session.mode)
        ? (session.mode === "timed" ? "Time left is at the top. You'll see results at the end." : "This is a test. You'll see results at the end.")
        : "Choose an answer and how sure you are, then check.";
    let submitLabel = "Check";
    if (isTestMode(session.mode) && !session.finalized) submitLabel = last ? "Finish" : "Save and next";
    const endButton = !revealed
      ? '<button type="button" class="btn primary" id="submit-btn" data-action="submit">' + submitLabel + "</button>"
      : '<button type="button" class="btn primary" id="next-btn" data-action="next">' + (last ? "See results" : "Next") + "</button>";
    return (
      '<p class="screen-hint">' + hint + "</p>" +
      '<div class="qstrip" aria-label="Questions">' + numbers + "</div>" +
      '<article class="card question" id="question" tabindex="-1" data-item-id="' + h(item.id) + '">' +
      '<div class="meta"><span class="badge ' + levelClass(item.level) + '">' + h(level.label) + '</span><span class="badge quiet">' + (item.format === "mc" ? "Multiple choice" : "Type the answer") + '</span><span class="badge quiet">' + h(item.id) + "</span></div>" +
      '<div class="progress" aria-hidden="true"><span style="width:' + Math.round((100 * (session.index + 1)) / session.itemIds.length) + '%"></span></div>' +
      '<h1 id="question-title" tabindex="-1">Question ' + (session.index + 1) + " of " + session.itemIds.length + "</h1>" +
      '<p class="muted">' + h(session.title) + "</p>" +
      '<div id="stem">' + rich(item.stem) + "</div>" +
      figures +
      (item.stemAfter ? rich(item.stemAfter) : "") +
      answerUi +
      (revealed ? "" : confHtml) +
      (response.formMsg ? '<p class="form-msg" id="form-msg" role="alert">' + h(response.formMsg) + "</p>" : '<p class="form-msg" id="form-msg"></p>') +
      banner +
      explanation +
      report +
      "</article>" +
      '<footer class="footer-bar">' +
      '<button type="button" class="btn ghost" id="retry-btn" data-action="retry">Retry</button>' +
      '<button type="button" class="btn ghost" id="topics-btn" data-action="topics">Topics</button>' +
      endButton +
      "</footer>"
    );
  }

  function bar(percent, kind) {
    const width = Math.max(0, Math.min(100, percent || 0));
    return '<div class="bar ' + (kind || "") + '"><span style="width:' + width + '%"></span></div>';
  }

  function analysisTables(analysis) {
    const topicRows = analysis.byTopic.length ? analysis.byTopic.map(function (row) {
      return "<tr><td>" + h(row.title) + "</td><td>" + row.correct + "/" + row.attempted + " (" + row.accuracy + "%)</td><td>" + row.mastered + "/" + row.attempted + "</td><td>" + bar(row.accuracy) + "</td></tr>";
    }).join("") : '<tr><td colspan="4">No answers yet.</td></tr>';
    const levelRows = analysis.byLevel.length ? analysis.byLevel.map(function (row) {
      return "<tr><td>" + h(row.label) + "</td><td>" + row.correct + "/" + row.attempted + " (" + row.accuracy + "%)</td><td>" + row.mastered + "</td><td>" + bar(row.mastery, "mastery") + "</td></tr>";
    }).join("") : '<tr><td colspan="4">No answers yet.</td></tr>';
    function feedbackCell(row) {
      const main = row.feedbackHtml ? rich(row.feedbackHtml) : h(row.feedbackText || "Compare your answer with the steps below.");
      const extra = row.alsoHtml && row.alsoHtml.length ? '<div class="muted">Also: ' + rich(row.alsoHtml[0]) + "</div>" : "";
      return main + extra;
    }
    const maxMistake = analysis.mistakes.reduce(function (max, row) { return Math.max(max, row.count); }, 1);
    const mistakeRows = analysis.mistakes.slice(0, 8).map(function (row) {
      return "<tr><td>" + feedbackCell(row) + "</td><td>" + h(row.errorLabel) + "</td><td>" + row.count + "</td><td>" + bar(Math.round((100 * row.count) / maxMistake), "bad") + "</td></tr>";
    }).join("") || '<tr><td colspan="4">No listed mistakes yet.</td></tr>';
    const maxWeak = analysis.concepts.reduce(function (max, row) { return Math.max(max, row.notMastered); }, 1);
    const conceptRows = analysis.concepts.slice(0, 8).map(function (row, index) {
      const sub = row.topicTitle ? '<div class="muted">' + h(row.topicTitle) + "</div>" : "";
      return "<tr><td>" + h(row.label) + sub + "</td><td>" + row.notMastered + " of " + row.attempted + "</td><td>" + bar(Math.round((100 * row.notMastered) / maxWeak), "warn") + '</td><td><button type="button" class="btn small" data-action="practice-set" data-kind="concepts" data-index="' + index + '">Practice these</button></td></tr>';
    }).join("") || '<tr><td colspan="4">No weak spots yet.</td></tr>';
    const typeMax = analysis.errorTypes.reduce(function (max, row) { return Math.max(max, row.count); }, 1);
    const typeRows = analysis.errorTypes.map(function (row) {
      return "<tr><td>" + h(row.label) + "</td><td>" + row.count + "</td><td>" + bar(Math.round((100 * row.count) / typeMax), row.id === "slip" ? "warn" : "bad") + "</td></tr>";
    }).join("") || '<tr><td colspan="3">None yet.</td></tr>';
    const patterns = analysis.patterns.slice(0, 5).map(function (row, index) {
      return '<article class="pattern"><p><strong>You missed ' + row.count + " questions with the same mistake.</strong></p>" +
        "<div>" + feedbackCell(row) + "</div>" +
        '<p class="muted">' + h(row.errorLabel) + " · " + h(row.itemIds.join(", ")) + "</p>" +
        '<button type="button" class="btn primary" data-action="practice-set" data-kind="patterns" data-index="' + index + '">Practice these again</button></article>';
    }).join("");
    const other = analysis.otherMistakes && analysis.otherMistakes.count
      ? '<h2>Other mistakes</h2><article class="pattern"><p>Compare your answer with the steps below.</p><p class="muted">' + h(analysis.otherMistakes.itemIds.join(", ")) + "</p></article>"
      : "";
    return (
      "<h2>Accuracy by topic</h2><div class=\"table-wrap\"><table class=\"data\"><thead><tr><th>Topic</th><th>Right</th><th>Mastered</th><th></th></tr></thead><tbody>" + topicRows + "</tbody></table></div>" +
      "<h2>Accuracy by level</h2><div class=\"table-wrap\"><table class=\"data\"><thead><tr><th>Level</th><th>Right</th><th>Mastered</th><th>Mastery</th></tr></thead><tbody>" + levelRows + "</tbody></table></div>" +
      "<h2>Mistake types</h2><div class=\"table-wrap\"><table class=\"data\"><thead><tr><th>Type</th><th>Count</th><th></th></tr></thead><tbody>" + typeRows + "</tbody></table></div>" +
      "<h2>Most frequent mistakes</h2><div class=\"table-wrap\"><table class=\"data\"><thead><tr><th>What went wrong</th><th>Type</th><th>Count</th><th></th></tr></thead><tbody>" + mistakeRows + "</tbody></table></div>" +
      (patterns ? "<h2>Same mistake, more than once</h2><div class=\"stack\">" + patterns + "</div>" : "") +
      other +
      "<h2>Weak spots</h2><div class=\"table-wrap\"><table class=\"data\"><thead><tr><th>Skill</th><th>Not mastered</th><th></th><th></th></tr></thead><tbody>" + conceptRows + "</tbody></table></div>"
    );
  }

  function siteFooter() {
    return (
      '<footer class="site-footer">' +
      "<p>© 2026 IC Math &amp; Science · Fullerton, CA</p>" +
      '<p>Need extra help? Ask your ICMS teacher or visit <a href="https://www.icmathandscience.com" target="_blank" rel="noopener noreferrer">icmathandscience.com</a> · <a href="mailto:info@icmathandscience.com">info@icmathandscience.com</a></p>' +
      "</footer>"
    );
  }

  const CUSTOM_KEY = "icms.customTest.v1";

  function defaultCustom() {
    return {
      topics: [],
      levels: ["M", "H", "H+"],
      count: 10,
      customCount: 10,
      timed: true,
      preferUnseen: true,
      includeMissed: false,
    };
  }

  function loadCustom() {
    const base = defaultCustom();
    try {
      const saved = JSON.parse(localStorage.getItem(CUSTOM_KEY) || "{}");
      const next = Object.assign(base, saved || {});
      if (!Array.isArray(next.topics)) next.topics = [];
      if (!Array.isArray(next.levels)) next.levels = base.levels.slice();
      next.preferUnseen = next.preferUnseen !== false;
      next.includeMissed = !!next.includeMissed;
      next.timed = next.timed !== false;
      const count = String(next.count);
      if (count !== "custom" && ["5", "10", "15", "20"].indexOf(count) < 0) next.count = 10;
      else next.count = count === "custom" ? "custom" : Number(count);
      return next;
    } catch (err) {
      return base;
    }
  }

  function saveCustom() {
    if (!state.custom) return;
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(state.custom));
  }

  function customLevelName(subject, id) {
    if (id === "H+") return "H+";
    const info = ICMS.levelInfo(subject, id);
    return info.name || info.label || id;
  }

  function customWanted() {
    const custom = state.custom || defaultCustom();
    if (String(custom.count) === "custom") {
      const n = parseInt(custom.customCount, 10);
      return n > 0 ? n : 0;
    }
    return Number(custom.count) || 0;
  }

  function withoutId(list, id) {
    return (list || []).filter(function (entry) { return entry !== id; });
  }

  function customAvailability() {
    const subject = currentSubject();
    const custom = state.custom || defaultCustom();
    const pool = ICMS.selectCustomPool(subject.items || [], attemptsOf(subject.id), {
      topicIds: custom.topics,
      levels: custom.levels,
      preferUnseen: !!custom.preferUnseen,
      includeMissed: !!custom.includeMissed,
    });
    const available = pool.length;
    const wanted = customWanted();
    const startCount = wanted > 0 ? Math.min(available, wanted) : 0;
    const ready = !!(custom.topics.length && custom.levels.length && startCount > 0);
    let note = available + (available === 1 ? " question available" : " questions available");
    if (!custom.topics.length || !custom.levels.length) note = "Choose at least one topic and one level. " + note;
    else if (wanted > available && available > 0) note += ". This test will use " + available + ".";
    else if (!available) note = "0 questions available for those choices.";
    return {
      pool: pool,
      ready: ready,
      note: note,
      button: ready ? "Start " + startCount + (startCount === 1 ? " question" : " questions") : "Start test",
    };
  }

  function openBuild() {
    state.custom = loadCustom();
    state.view = "build";
    state.notice = "";
    setHash("#/build");
    render();
  }

  function startCustom() {
    const custom = state.custom || loadCustom();
    state.custom = custom;
    const live = customAvailability();
    if (!live.ready) {
      state.notice = "Choose topics, levels, and a number of questions.";
      render();
      return;
    }
    const count = Math.min(live.pool.length, customWanted());
    const ids = shuffle(live.pool).slice(0, count).map(function (item) { return item.id; });
    const subject = currentSubject();
    beginSession({
      mode: custom.timed ? "timed" : "test",
      kind: "custom",
      title: "Custom test",
      topicId: "",
      level: "custom",
      levelLabel: custom.levels.map(function (id) { return customLevelName(subject, id); }).join(", "),
      itemIds: ids,
    });
  }

  function renderBuild() {
    const subject = currentSubject();
    const custom = state.custom || loadCustom();
    state.custom = custom;
    const live = customAvailability();
    const levelChips = (subject.levels || []).map(function (level) {
      const on = custom.levels.indexOf(level.id) >= 0;
      return '<button type="button" class="chip" data-action="custom-level" data-level="' + h(level.id) + '" aria-pressed="' + (on ? "true" : "false") + '">' + h(customLevelName(subject, level.id)) + "</button>";
    }).join("");
    const counts = [5, 10, 15, 20];
    const countChips = counts.map(function (size) {
      return '<button type="button" class="chip" data-action="custom-count" data-count="' + size + '" aria-pressed="' + (String(custom.count) === String(size) ? "true" : "false") + '">' + size + "</button>";
    }).join("") + '<button type="button" class="chip" data-action="custom-count" data-count="custom" aria-pressed="' + (String(custom.count) === "custom" ? "true" : "false") + '">Custom</button>';
    let topics = "";
    (subject.domains || []).forEach(function (domain) {
      const ids = (domain.topics || []).map(function (topic) { return topic.id; });
      const allOn = ids.length > 0 && ids.every(function (id) { return custom.topics.indexOf(id) >= 0; });
      topics += '<div class="domain-block"><label class="check domain-check"><input type="checkbox" data-action="custom-domain" data-domain="' + h(domain.id) + '"' + (allOn ? " checked" : "") + "><span>Select all " + h(domain.title) + "</span></label>";
      (domain.topics || []).forEach(function (topic) {
        const on = custom.topics.indexOf(topic.id) >= 0;
        topics += '<label class="check"><input type="checkbox" data-action="custom-topic" data-topic="' + h(topic.id) + '"' + (on ? " checked" : "") + "><span><strong>" + h(topic.id) + "</strong> " + h(topic.title) + "</span></label>";
      });
      topics += "</div>";
    });
    const customField = String(custom.count) === "custom"
      ? '<label class="field"><span>How many</span><input id="custom-count" type="number" min="1" inputmode="numeric" value="' + h(custom.customCount) + '"></label>'
      : "";
    return (
      "<h1>Build My Test</h1>" +
      '<p class="screen-hint">Mix topics and levels. Timed or untimed, this test counts toward My Analysis.</p>' +
      (state.notice ? '<p class="notice">' + h(state.notice) + "</p>" : "") +
      '<section class="card stack">' +
      "<h2>Topics</h2>" + topics +
      "<h2>Levels</h2><div class=\"chips\">" + levelChips + "</div>" +
      "<h2>How many</h2><div class=\"chips\">" + countChips + "</div>" + customField +
      '<p class="mode-note" id="custom-available">' + h(live.note) + "</p>" +
      '<label class="check"><input type="checkbox" data-action="custom-flag" data-flag="timed"' + (custom.timed ? " checked" : "") + "><span>Timed (2 minutes per question)</span></label>" +
      '<label class="check"><input type="checkbox" data-action="custom-flag" data-flag="preferUnseen"' + (custom.preferUnseen ? " checked" : "") + "><span>Prefer questions I haven't seen</span></label>" +
      '<label class="check"><input type="checkbox" data-action="custom-flag" data-flag="includeMissed"' + (custom.includeMissed ? " checked" : "") + "><span>Include questions I missed before</span></label>" +
      '<div class="row"><button type="button" class="btn primary" id="start-custom" data-action="start-custom"' + (live.ready ? "" : " disabled") + ">" + h(live.button) + '</button><button type="button" class="btn ghost" data-action="topics">Back</button></div>' +
      "</section>"
    );
  }

  function renderResults() {
    const session = state.session;
    const subject = subjectById(session.subjectId) || currentSubject();
    const analysis = ICMS.analyze(sessionAttempts(session), subject);
    const testing = isTestMode(session.mode);
    const all = testing ? ICMS.analyze(testAttemptsOf(subject.id), subject) : null;
    const reports = reportsOf(subject.id).filter(function (report) {
      return session.itemIds.indexOf(report.itemId) >= 0;
    });
    state.practiceSets = { patterns: analysis.patterns, concepts: analysis.concepts };
    const text = ICMS.formatSessionReport({
      name: state.name,
      subject: subject,
      session: session,
      analysis: analysis,
      allAnalysis: all,
      reports: reports,
    });
    const list = session.itemIds.map(function (id, index) {
      const response = session.responses[id] || {};
      const item = itemById(subject, id);
      const level = item ? ICMS.levelInfo(subject, item.level).label : "";
      let mark = "No answer";
      if (response.correct === true) mark = "Right";
      if (response.correct === false) mark = "Wrong";
      return '<button type="button" class="topic" data-action="review" data-index="' + index + '"><span class="code">' + (index + 1) + "</span><strong>" + h(id) + " · " + h(mark) + "</strong><em>" + h(level) + (response.flagged ? " · flagged" : "") + "</em></button>";
    }).join("");
    const wrongIds = session.itemIds.filter(function (id) {
      return session.responses[id] && session.responses[id].correct === false;
    });
    return (
      "<h1>Results</h1>" +
      '<p class="screen-hint">Copy this and paste it to your teacher.</p>' +
      (state.notice ? '<p class="notice">' + h(state.notice) + "</p>" : "") +
      '<div class="stats"><div class="stat"><b>' + analysis.correct + "/" + analysis.attempted + '</b><span>Score</span></div><div class="stat"><b>' + analysis.mastered + '</b><span>Mastered</span></div><div class="stat"><b>' + h(ICMS.duration(session.elapsedMs || 0)) + '</b><span>Time</span></div><div class="stat"><b>' + analysis.stillConfused + '</b><span>Still confused</span></div></div>' +
      '<div class="card stack"><p><strong>' + h(session.title) + "</strong> · " + h(session.levelLabel || "All") + " · " + h(ICMS.sessionModeLabel(session)) + "</p>" +
      "<p>Wrong item IDs: " + h(wrongIds.length ? wrongIds.join(", ") : "none") + "</p>" +
      '<div class="row no-print"><button type="button" class="btn primary" id="copy-btn" data-action="copy" data-copy="session">Copy results</button><button type="button" class="btn ghost" data-action="print">Print</button>' +
      (wrongIds.length ? '<button type="button" class="btn ghost" data-action="retry-ids">Retry wrong</button>' : "") +
      '<button type="button" class="btn ghost" data-action="topics">Topics</button></div>' +
      '<details class="no-print"><summary>Preview the text</summary><pre class="copy-block" id="copy-block">' + h(text) + "</pre></details></div>" +
      (testing ? analysisTables(analysis) : '<p class="teacher-note">Question bank practice is not added to My Analysis.</p>') +
      '<h2>Review questions</h2><div class="topics">' + list + "</div>"
    );
  }

  function renderAnalysis() {
    const subject = currentSubject();
    const analysis = ICMS.analyze(testAttemptsOf(subject.id), subject);
    const reports = reportsOf(subject.id);
    state.practiceSets = { patterns: analysis.patterns, concepts: analysis.concepts };
    const text = ICMS.formatAnalysisReport({ name: state.name, subject: subject, analysis: analysis, reports: reports });
    const notMastered = Array.from(ICMS.latestByItem(testAttemptsOf(subject.id)).values()).filter(function (row) {
      return !(row.correct && row.confidence === "sure");
    }).map(function (row) { return row.itemId; });
    return (
      "<h1>My analysis</h1>" +
      '<p class="screen-hint">Mastered means you were right and sure. A correct guess still needs practice.</p>' +
      (state.notice ? '<p class="notice">' + h(state.notice) + "</p>" : "") +
      "<p><strong>" + h(state.name) + "</strong> · " + h(subject.title) + "</p>" +
      '<div class="stats"><div class="stat"><span class="stat-num">' + analysis.attempted + '</span><span>Answered</span></div><div class="stat"><span class="stat-num">' + analysis.accuracy + '%</span><span>Right</span></div><div class="stat"><span class="stat-num">' + analysis.mastery + '%</span><span>Mastered</span></div><div class="stat"><span class="stat-num">' + analysis.stillConfused + '</span><span>Still confused</span></div></div>' +
      '<div class="card stack"><p class="tally"><span>Right and sure: ' + analysis.mastered + '</span><span>Right but guessed: ' + analysis.shakyGuess + '</span><span>Right but 50-50: ' + analysis.shakyFifty + '</span><span>Missed: ' + analysis.missed + '</span><span>Sure but missed: ' + analysis.sureButMissed + "</span></p>" +
      '<div class="row no-print"><button type="button" class="btn primary" id="copy-btn" data-action="copy" data-copy="analysis">Copy results</button><button type="button" class="btn ghost" data-action="print">Print</button>' +
      (notMastered.length ? '<button type="button" class="btn ghost" data-action="retry-unmastered">Retry not mastered</button>' : "") +
      '<button type="button" class="btn ghost" data-action="topics">Topics</button></div>' +
      '<details class="no-print"><summary>Preview the text</summary><pre class="copy-block">' + h(text) + "</pre></details></div>" +
      (analysis.attempted ? analysisTables(analysis) + '<p class="teacher-note">Keep missing the same type? Bring this report to your ICMS teacher.</p>' : '<section class="card"><h2>Nothing from a test yet</h2><p>Finish a practice test or use Build My Test. Question bank practice stays off this page.</p><button type="button" class="btn primary" data-action="topics">Back to topics</button></section>') +
      (reports.length ? "<h2>Problem reports</h2><div class=\"card\"><ul>" + reports.map(function (report) {
        return "<li><strong>" + h(report.itemId) + "</strong> " + h(report.text) + "</li>";
      }).join("") + "</ul></div>" : "")
    );
  }

  function renderError() {
    if (state.error === "file") {
      return '<section class="card error-card stack"><h1>Open the single-file copy</h1><p>This folder version needs a small local server. For class, open <strong>dist/icms-sat-practice.html</strong> directly. It works offline.</p></section>';
    }
    return '<section class="card error-card stack"><h1>Questions did not load</h1><p>Check the connection and refresh. If you are offline, open dist/icms-sat-practice.html instead.</p></section>';
  }

  function render() {
    if (finishIfTimeUp()) return;
    const y = state.keepScroll ? window.scrollY : 0;
    let body = "";
    if (state.view === "loading") body = '<p class="loading">Loading questions…</p>';
    else if (state.view === "error") body = renderError();
    else if (state.view === "name") body = renderName();
    else if (state.view === "home") body = renderHome();
    else if (state.view === "build") body = renderBuild();
    else if (state.view === "session") body = renderSession();
    else if (state.view === "results") body = renderResults();
    else if (state.view === "analysis") body = renderAnalysis();
    if (state.view === "home" || state.view === "results" || state.view === "analysis" || state.view === "build") body += siteFooter();
    app.innerHTML = header() + '<main class="wrap' + (state.view === "session" ? " session-pad" : "") + '" id="main">' + body + "</main>";
    ICMS.mountRich(app);
    if (state.keepScroll) {
      window.scrollTo(0, y);
      state.keepScroll = false;
    } else {
      window.scrollTo(0, 0);
      if (state.focusQuestion) {
        const title = document.getElementById("question-title");
        if (title) title.focus();
        state.focusQuestion = false;
      }
    }
    if (state.scrollTo) {
      const el = document.getElementById(state.scrollTo);
      if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      state.scrollTo = "";
    }
    armCountdown();
  }

  function paintCountdown() {
    const session = state.session;
    if (!countdownActive(session)) return;
    const left = remainingMs(session);
    const el = document.getElementById("timer");
    const bar = document.getElementById("countdown");
    const progress = document.getElementById("countdown-progress");
    if (el) el.textContent = formatClock(left);
    if (progress) progress.textContent = (session.index + 1) + "/" + session.itemIds.length;
    if (bar) {
      bar.classList.toggle("warn", left <= 60000 && left > 30000);
      bar.classList.toggle("danger", left <= 30000);
      bar.setAttribute("aria-label", formatClock(left) + " remaining, question " + (session.index + 1) + " of " + session.itemIds.length);
    }
  }

  function finishIfTimeUp() {
    const session = state.session;
    if (!countdownActive(session) || remainingMs(session) > 0) return false;
    showResults();
    return true;
  }

  function armCountdown() {
    clearInterval(timerId);
    timerId = 0;
    if (!countdownActive(state.session)) return;
    if (remainingMs(state.session) <= 0) {
      showResults();
      return;
    }
    timerId = setInterval(function () {
      if (!countdownActive(state.session)) {
        clearInterval(timerId);
        timerId = 0;
        return;
      }
      if (remainingMs(state.session) <= 0) {
        clearInterval(timerId);
        timerId = 0;
        showResults();
        return;
      }
      paintCountdown();
    }, 250);
  }

  function sprCount(value) {
    const text = String(value || "");
    const negative = text.trim().startsWith("-");
    return text.trim().length + "/" + (negative ? 6 : 5);
  }

  function onInput(event) {
    const target = event.target;
    if (target.id === "student-name") state.nameDraft = target.value;
    if (target.id === "spr-input" && state.session) {
      const itemId = state.session.itemIds[state.session.index];
      ensureResponse(itemId).response = target.value;
      const count = document.getElementById("spr-count");
      if (count) {
        const note = count.textContent.split("·").slice(1).join("·");
        count.textContent = sprCount(target.value) + (note ? " ·" + note : "");
      }
    }
    if (target.id === "custom-count" && state.custom) {
      state.custom.customCount = target.value;
      state.custom.count = "custom";
      saveCustom();
      const live = customAvailability();
      const note = document.getElementById("custom-available");
      const button = document.getElementById("start-custom");
      if (note) note.textContent = live.note;
      if (button) {
        button.disabled = !live.ready;
        button.textContent = live.button;
      }
    }
    if (target.id === "report-text" && state.session) {
      const itemId = state.session.itemIds[state.session.index];
      ensureResponse(itemId).reportDraft = target.value;
    }
  }

  function onClick(event) {
    const node = event.target.closest("[data-action]");
    if (!node) return;
    const action = node.getAttribute("data-action");
    if (action === "continue-name") return continueName();
    if (action === "switch-student") {
      state.view = "name";
      state.nameDraft = state.name || "";
      state.nameError = "";
      render();
      return;
    }
    if (action === "pick-subject") {
      state.subjectId = node.getAttribute("data-subject");
      localStorage.setItem(ICMS.SUBJECT_KEY, state.subjectId);
      state.keepScroll = true;
      render();
      return;
    }
    if (action === "set-pref") {
      const key = node.getAttribute("data-pref");
      let value = node.getAttribute("data-value");
      if (key === "count" && value !== "all") value = Number(value);
      state.prefs[key] = value;
      if (key === "mode" && value !== "timed" && state.prefs.count === 3) {
        const base = (currentSubject().setSizes || []).map(Number);
        if (base.indexOf(3) < 0) state.prefs.count = base[0] || 5;
      }
      ICMS.savePrefs(state.prefs);
      state.keepScroll = true;
      render();
      return;
    }
    if (action === "start-topic") return startTopic(node.getAttribute("data-topic"));
    if (action === "build-test") return openBuild();
    if (action === "start-custom") return startCustom();
    if (action === "custom-topic" && state.custom) {
      const topicId = node.getAttribute("data-topic");
      state.custom.topics = withoutId(state.custom.topics, topicId);
      if (node.checked) state.custom.topics.push(topicId);
      saveCustom();
      state.keepScroll = true;
      render();
      return;
    }
    if (action === "custom-domain" && state.custom) {
      const subject = currentSubject();
      const domainId = node.getAttribute("data-domain");
      const domain = (subject.domains || []).filter(function (entry) { return entry.id === domainId; })[0];
      const ids = domain ? (domain.topics || []).map(function (topic) { return topic.id; }) : [];
      const allOn = ids.length > 0 && ids.every(function (id) { return state.custom.topics.indexOf(id) >= 0; });
      ids.forEach(function (id) {
        state.custom.topics = withoutId(state.custom.topics, id);
        if (!allOn) state.custom.topics.push(id);
      });
      saveCustom();
      state.keepScroll = true;
      render();
      return;
    }
    if (action === "custom-level" && state.custom) {
      const id = node.getAttribute("data-level");
      const on = state.custom.levels.indexOf(id) < 0;
      state.custom.levels = on ? state.custom.levels.concat(id) : withoutId(state.custom.levels, id);
      saveCustom();
      state.keepScroll = true;
      render();
      return;
    }
    if (action === "custom-count" && state.custom) {
      const count = node.getAttribute("data-count");
      state.custom.count = count === "custom" ? "custom" : Number(count);
      saveCustom();
      state.keepScroll = true;
      render();
      return;
    }
    if (action === "custom-flag" && state.custom) {
      state.custom[node.getAttribute("data-flag")] = !!node.checked;
      saveCustom();
      state.keepScroll = true;
      render();
      return;
    }
    if (action === "analysis") {
      if (state.session) saveSession();
      state.view = "analysis";
      state.notice = "";
      setHash("#/analysis");
      render();
      return;
    }
    if (action === "topics") return goTopics();
    if (action === "resume") {
      if (state.session) {
        state.subjectId = state.session.subjectId;
        state.view = "session";
        setHash("#/session");
        render();
      }
      return;
    }
    if (action === "results") return showResults();
    if (action === "retry-wrong") {
      const ids = Array.from(ICMS.latestByItem(bankAttemptsOf(currentSubject().id)).values()).filter(function (row) { return !row.correct; }).map(function (row) { return row.itemId; });
      return startIds(ids, "Missed questions");
    }
    if (action === "retry-unmastered") {
      const ids = Array.from(ICMS.latestByItem(testAttemptsOf(currentSubject().id)).values()).filter(function (row) {
        return !(row.correct && row.confidence === "sure");
      }).map(function (row) { return row.itemId; });
      return startIds(ids, "Not mastered yet");
    }
    if (action === "retry-ids" && state.session) {
      const ids = state.session.itemIds.filter(function (id) {
        return state.session.responses[id] && state.session.responses[id].correct === false;
      });
      return startIds(ids, "Retry wrong questions");
    }
    if (action === "practice-set") {
      const kind = node.getAttribute("data-kind");
      const index = Number(node.getAttribute("data-index"));
      const row = state.practiceSets && state.practiceSets[kind] && state.practiceSets[kind][index];
      if (row) return startIds(row.itemIds || [], "Practice these again");
    }
    if (action === "print") {
      window.print();
      return;
    }
    if (action === "copy") {
      const which = node.getAttribute("data-copy");
      const subject = currentSubject();
      let text = "";
      if (which === "session" && state.session) {
        const reports = reportsOf(state.session.subjectId).filter(function (report) {
          return state.session.itemIds.indexOf(report.itemId) >= 0;
        });
        text = ICMS.formatSessionReport({
          name: state.name,
          subject: subjectById(state.session.subjectId) || subject,
          session: state.session,
          analysis: ICMS.analyze(sessionAttempts(state.session), subjectById(state.session.subjectId) || subject),
          allAnalysis: isTestMode(state.session.mode) ? ICMS.analyze(testAttemptsOf(state.session.subjectId), subjectById(state.session.subjectId) || subject) : null,
          reports: reports,
        });
      } else {
        text = ICMS.formatAnalysisReport({
          name: state.name,
          subject: subject,
          analysis: ICMS.analyze(testAttemptsOf(subject.id), subject),
          reports: reportsOf(subject.id),
        });
      }
      copyText(text);
      return;
    }
    if (!state.session) return;
    const session = state.session;
    const item = itemById(subjectById(session.subjectId), session.itemIds[session.index]);
    if (action === "goto" || action === "review") {
      session.index = Number(node.getAttribute("data-index"));
      session.reviewing = action === "review";
      if (action === "review") state.view = "session";
      state.focusQuestion = true;
      saveSession();
      setHash("#/session");
      render();
      return;
    }
    if (!item) return;
    const response = ensureResponse(item.id);
    const revealed = isRevealed(session, item.id);
    if (action === "choice" && !revealed) {
      response.response = node.getAttribute("data-choice");
      response.formMsg = "";
      state.keepScroll = true;
      saveSession();
      render();
      return;
    }
    if (action === "confidence" && !revealed) {
      response.confidence = node.getAttribute("data-confidence");
      response.formMsg = "";
      state.keepScroll = true;
      saveSession();
      render();
      return;
    }
    if (action === "flag") {
      response.flagged = !response.flagged;
      state.keepScroll = true;
      saveSession();
      render();
      return;
    }
    if (action === "submit") return submitCurrent();
    if (action === "next") {
      if (isTestMode(session.mode) && !session.finalized) return submitCurrent();
      if (!revealed) {
        response.formMsg = "Check this question first. You can also jump with the numbers above.";
        render();
        return;
      }
      return advance(1);
    }
    if (action === "retry") {
      const flagged = response.flagged;
      const draft = response.reportDraft;
      session.responses[item.id] = { flagged: !!flagged, reportDraft: draft || "", forceHidden: true };
      saveSession();
      render();
      return;
    }
    if (action === "sense") {
      response.sense = node.getAttribute("data-sense");
      const data = profile();
      if (response.attemptTs) ICMS.setSense(data, session.subjectId, item.id, response.attemptTs, response.sense);
      state.keepScroll = true;
      saveSession();
      render();
      return;
    }
    if (action === "save-report") {
      const text = (response.reportDraft || "").trim();
      const data = profile();
      ICMS.setReport(data, session.subjectId, {
        itemId: item.id,
        topicId: item.topicId,
        text: text,
        ts: Date.now(),
      });
      state.notice = text ? "Note saved on this device." : "Note removed.";
      state.keepScroll = true;
      render();
    }
  }

  function onKey(event) {
    if (event.key === "Enter" && event.target.id === "student-name") {
      event.preventDefault();
      continueName();
      return;
    }
    if (event.key === "Enter" && event.target.id === "spr-input") {
      event.preventDefault();
      submitCurrent();
      return;
    }
    if (event.target.matches("input, textarea")) return;
    if ((event.key === "Enter" || event.key === " ") && event.target.classList && event.target.classList.contains("choice")) {
      event.preventDefault();
      event.target.click();
      return;
    }
    const letter = event.key.toUpperCase();
    if (["A", "B", "C", "D"].indexOf(letter) >= 0 && state.view === "session" && state.session) {
      const item = itemById(subjectById(state.session.subjectId), state.session.itemIds[state.session.index]);
      if (!item || item.format !== "mc" || isRevealed(state.session, item.id)) return;
      const response = ensureResponse(item.id);
      response.response = letter;
      state.keepScroll = true;
      saveSession();
      render();
    }
  }

  function route() {
    const hash = location.hash || "#/";
    if (!ICMS.currentName()) {
      state.name = "";
      state.view = "name";
      state.pendingHash = hash;
      render();
      return;
    }
    state.name = ICMS.currentName();
    if (hash.indexOf("#/item/") === 0) {
      openItem(decodeURIComponent(hash.slice("#/item/".length)));
      return;
    }
    if (hash === "#/analysis") {
      state.view = "analysis";
      render();
      return;
    }
    if (hash === "#/build") {
      state.custom = loadCustom();
      state.view = "build";
      render();
      return;
    }
    if (hash === "#/session") {
      const session = state.session || ICMS.loadSession();
      if (session && session.itemIds && session.itemIds.length) {
        state.session = session;
        state.subjectId = session.subjectId || state.subjectId;
        state.view = session.finalized && !session.reviewing ? "results" : "session";
        render();
        return;
      }
    }
    state.view = "home";
    render();
  }

  async function boot() {
    state.view = "loading";
    render();
    try {
      if (!window.ICMS_DATA && location.protocol === "file:") {
        state.view = "error";
        state.error = "file";
        render();
        return;
      }
      let data = window.ICMS_DATA;
      if (!data) {
        const registry = await fetch("data/registry.json").then(function (res) {
          if (!res.ok) throw new Error("registry");
          return res.json();
        });
        const subjects = [];
        for (let i = 0; i < registry.subjects.length; i++) {
          const res = await fetch(registry.subjects[i].file);
          if (!res.ok) throw new Error("subject");
          subjects.push(await res.json());
        }
        data = { subjects: subjects };
      }
      state.subjects = data.subjects || [];
      if (!state.subjects.length) throw new Error("empty");
      const saved = localStorage.getItem(ICMS.SUBJECT_KEY);
      state.subjectId = state.subjects.some(function (subject) { return subject.id === saved; }) ? saved : state.subjects[0].id;
      state.prefs = ICMS.loadPrefs();
      state.session = ICMS.loadSession();
      route();
    } catch (err) {
      state.view = "error";
      state.error = "load";
      render();
    }
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden || !countdownActive(state.session)) return;
    if (remainingMs(state.session) <= 0) showResults();
    else paintCountdown();
  });
  app.addEventListener("click", onClick);
  app.addEventListener("input", onInput);
  app.addEventListener("keydown", onKey);
  window.addEventListener("hashchange", function () {
    if (suppressHash) {
      suppressHash = false;
      return;
    }
    route();
  });
  boot();
})();
