(function () {
  "use strict";

  const app = document.getElementById("app");
  const state = {
    subjects: [],
    subjectId: "",
    view: "loading",
    error: "",
    session: null,
    prefs: { level: "all", mode: "practice", count: 10 },
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
    if (session.mode === "timed") return !!session.finalized;
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

  function freezeElapsed(session) {
    if (!session || session.elapsedFrozen) return;
    const started = session.startedAt || Date.now();
    session.elapsedMs = Math.max(0, Date.now() - started);
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
    if (session.mode !== "timed") {
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
      itemIds: spec.itemIds,
      index: 0,
      startedAt: startedAt,
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
    if (session.mode === "timed" && !session.finalized) {
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
    if (session.mode === "timed" && !session.finalized) finalizeTimed();
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
      if (session.mode === "timed" && !session.finalized && !session.completed) {
        tools += '<span id="timer" class="header-btn">' + h(ICMS.duration(Date.now() - session.startedAt)) + "</span>";
      }
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
    return (
      '<header class="app-header">' +
      '<div class="brand"><span class="mark">IC</span><span><span class="brand-text">ICMS Practice</span><span class="brand-sub">IC Math &amp; Science</span></span></div>' +
      tools +
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
    const latest = ICMS.latestByItem(attemptsOf(subject.id));
    const rows = Array.from(latest.values());
    const right = rows.filter(function (row) { return row.correct; }).length;
    const mastered = rows.filter(function (row) { return row.correct && row.confidence === "sure"; }).length;
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
      '<button type="button" class="chip" data-action="set-pref" data-pref="mode" data-value="practice" aria-pressed="' + (state.prefs.mode === "practice" ? "true" : "false") + '">Practice</button>' +
      '<button type="button" class="chip" data-action="set-pref" data-pref="mode" data-value="timed" aria-pressed="' + (state.prefs.mode === "timed" ? "true" : "false") + '">Timed set</button>';
    const countChips = sizes.map(function (size) {
      return '<button type="button" class="chip" data-action="set-pref" data-pref="count" data-value="' + size + '" aria-pressed="' + (String(state.prefs.count) === String(size) ? "true" : "false") + '">' + size + "</button>";
    }).join("") + '<button type="button" class="chip" data-action="set-pref" data-pref="count" data-value="all" aria-pressed="' + (state.prefs.count === "all" ? "true" : "false") + '">All</button>';
    const modeNote = state.prefs.mode === "timed"
      ? "A timer runs. You get the score and explanations at the end."
      : "You check each question before the next one.";
    let topics = "";
    (subject.domains || []).forEach(function (domain) {
      topics += '<h2 class="domain-title">' + h(domain.title) + "</h2>";
      (domain.topics || []).forEach(function (topic) {
        const pool = subject.items.filter(function (item) {
          return item.topicId === topic.id && (state.prefs.level === "all" || item.level === state.prefs.level);
        });
        const mine = rows.filter(function (row) { return row.topicId === topic.id; });
        const mineRight = mine.filter(function (row) { return row.correct; }).length;
        const detail = pool.length
          ? pool.length + " questions" + (mine.length ? " · " + mineRight + "/" + mine.length + " right" : "")
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
      '<p class="screen-hint">Choose a level and a mode, then tap a topic.</p>' +
      (state.notice ? '<p class="notice">' + h(state.notice) + "</p>" : "") +
      resume +
      (rows.length ? '<div class="stats"><div class="stat"><b>' + rows.length + '</b><span>Answered</span></div><div class="stat"><b>' + right + "/" + rows.length + '</b><span>Right</span></div><div class="stat"><b>' + mastered + '</b><span>Mastered</span></div><div class="stat"><b>' + (rows.length ? Math.round((100 * mastered) / rows.length) : 0) + '%</b><span>Mastery</span></div></div>' : "") +
      '<section class="card setup">' +
      "<p>Level</p><div class=\"chips\">" + levelChips + "</div>" +
      "<p>How to practice</p><div class=\"chips\">" + modeChips + "</div><p class=\"mode-note\">" + modeNote + "</p>" +
      "<p>How many</p><div class=\"chips\">" + countChips + "</div>" +
      (wrongIds.length ? '<button type="button" class="btn ghost" data-action="retry-wrong">Retry ' + wrongIds.length + " missed question" + (wrongIds.length === 1 ? "" : "s") + "</button>" : "") +
      "</section>" +
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
      : session.mode === "timed"
        ? "A timer is running. You'll see results at the end."
        : "Choose an answer and how sure you are, then check.";
    let submitLabel = "Check";
    if (session.mode === "timed" && !session.finalized) submitLabel = last ? "Finish" : "Save and next";
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

  function renderResults() {
    const session = state.session;
    const subject = subjectById(session.subjectId) || currentSubject();
    const analysis = ICMS.analyze(sessionAttempts(session), subject);
    const all = ICMS.analyze(attemptsOf(subject.id), subject);
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
      '<div class="card stack"><p><strong>' + h(session.title) + "</strong> · " + h(session.levelLabel || "All") + " · " + (session.mode === "timed" ? "Timed set" : "Practice") + "</p>" +
      "<p>Wrong item IDs: " + h(wrongIds.length ? wrongIds.join(", ") : "none") + "</p>" +
      '<div class="row no-print"><button type="button" class="btn primary" id="copy-btn" data-action="copy" data-copy="session">Copy results</button><button type="button" class="btn ghost" data-action="print">Print</button>' +
      (wrongIds.length ? '<button type="button" class="btn ghost" data-action="retry-ids">Retry wrong</button>' : "") +
      '<button type="button" class="btn ghost" data-action="topics">Topics</button></div>' +
      '<details class="no-print"><summary>Preview the text</summary><pre class="copy-block" id="copy-block">' + h(text) + "</pre></details></div>" +
      analysisTables(analysis) +
      '<h2>Review questions</h2><div class="topics">' + list + "</div>"
    );
  }

  function renderAnalysis() {
    const subject = currentSubject();
    const analysis = ICMS.analyze(attemptsOf(subject.id), subject);
    const reports = reportsOf(subject.id);
    state.practiceSets = { patterns: analysis.patterns, concepts: analysis.concepts };
    const text = ICMS.formatAnalysisReport({ name: state.name, subject: subject, analysis: analysis, reports: reports });
    const notMastered = Array.from(ICMS.latestByItem(attemptsOf(subject.id)).values()).filter(function (row) {
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
      (analysis.attempted ? analysisTables(analysis) : '<section class="card"><h2>Nothing to analyze yet</h2><p>Answer a few questions and this page will fill in.</p><button type="button" class="btn primary" data-action="topics">Back to topics</button></section>') +
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
    const y = state.keepScroll ? window.scrollY : 0;
    let body = "";
    if (state.view === "loading") body = '<p class="loading">Loading questions…</p>';
    else if (state.view === "error") body = renderError();
    else if (state.view === "name") body = renderName();
    else if (state.view === "home") body = renderHome();
    else if (state.view === "session") body = renderSession();
    else if (state.view === "results") body = renderResults();
    else if (state.view === "analysis") body = renderAnalysis();
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
    clearInterval(timerId);
    if (state.view === "session" && state.session && state.session.mode === "timed" && !state.session.finalized) {
      timerId = setInterval(function () {
        const el = document.getElementById("timer");
        if (el && state.session) el.textContent = ICMS.duration(Date.now() - state.session.startedAt);
      }, 1000);
    }
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
      const ids = Array.from(ICMS.latestByItem(attemptsOf(currentSubject().id)).values()).filter(function (row) { return !row.correct; }).map(function (row) { return row.itemId; });
      return startIds(ids, "Missed questions");
    }
    if (action === "retry-unmastered") {
      const ids = Array.from(ICMS.latestByItem(attemptsOf(currentSubject().id)).values()).filter(function (row) {
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
          allAnalysis: ICMS.analyze(attemptsOf(state.session.subjectId), subjectById(state.session.subjectId) || subject),
          reports: reports,
        });
      } else {
        text = ICMS.formatAnalysisReport({
          name: state.name,
          subject: subject,
          analysis: ICMS.analyze(attemptsOf(subject.id), subject),
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
      if (session.mode === "timed" && !session.finalized) return submitCurrent();
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
