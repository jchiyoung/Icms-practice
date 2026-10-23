(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ICMS = Object.assign(root.ICMS || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const COMPARE = "Compare your answer with the steps below.";
  const ERROR_LABELS = {
    slip: "Careless slip",
    concept: "Concept mix-up",
    setup: "Set-up error",
    "set-up": "Set-up error",
    setup_error: "Set-up error",
    reading: "Reading error",
    calculation: "Calculation error",
    arithmetic: "Arithmetic error",
  };

  function strip(src) {
    const host = typeof globalThis !== "undefined" ? globalThis : this;
    if (host.ICMS && typeof host.ICMS.toPlainText === "function") return host.ICMS.toPlainText(src);
    if (typeof require === "function") {
      try {
        return require("./rich.js").toPlainText(src);
      } catch (err) {
        /* fall through */
      }
    }
    return String(src || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  function latestByItem(attempts) {
    const map = new Map();
    (attempts || []).forEach(function (attempt) {
      const prev = map.get(attempt.itemId);
      if (!prev || (attempt.ts || 0) >= (prev.ts || 0)) map.set(attempt.itemId, attempt);
    });
    return map;
  }

  function pct(part, whole) {
    if (!whole) return 0;
    return Math.round((100 * part) / whole);
  }

  function mode(values) {
    const counts = new Map();
    values.forEach(function (value) {
      counts.set(value, (counts.get(value) || 0) + 1);
    });
    let best = values[0] || "";
    let bestCount = -1;
    counts.forEach(function (count, value) {
      if (count > bestCount) {
        best = value;
        bestCount = count;
      }
    });
    return best;
  }

  function topicTitle(subject, id) {
    const domains = (subject && subject.domains) || [];
    for (let i = 0; i < domains.length; i++) {
      const topics = domains[i].topics || [];
      for (let j = 0; j < topics.length; j++) {
        if (topics[j].id === id) return topics[j].title;
      }
    }
    return id || "Topic";
  }

  function levelInfo(subject, id) {
    const levels = (subject && subject.levels) || [];
    for (let i = 0; i < levels.length; i++) {
      if (levels[i].id === id) return levels[i];
    }
    return { id: id, label: id, name: id };
  }

  function errorLabel(subject, id) {
    const key = String(id || "").trim();
    if (!key) return "Other mistakes";
    if (ERROR_LABELS[key]) return ERROR_LABELS[key];
    const map = (subject && subject.errorTypes) || {};
    if (map[key]) return map[key];
    return key.replace(/[-_]+/g, " ").replace(/\b\w/g, function (ch) {
      return ch.toUpperCase();
    });
  }

  function isDCode(code) {
    return /^D\d+$/i.test(String(code || "").trim());
  }

  function groupErrorLabel(subject, types) {
    const ids = [];
    (types || []).forEach(function (typeId) {
      const key = String(typeId || "").trim();
      if (ids.indexOf(key) < 0) ids.push(key);
    });
    const named = ids.filter(Boolean);
    if (!named.length) return "Other mistakes";
    if (named.length === 1) return errorLabel(subject, named[0]);
    return named.map(function (typeId) { return errorLabel(subject, typeId); }).join(", ");
  }

  function isMastered(attempt) {
    return attempt.correct === true && attempt.confidence === "sure";
  }

  function isTestMode(mode) {
    return mode === "timed" || mode === "test";
  }

  function testAttempts(attempts) {
    return (attempts || []).filter(function (attempt) {
      return isTestMode(attempt.mode);
    });
  }

  function selectCustomPool(items, attempts, spec) {
    const topicIds = spec.topicIds || [];
    const levels = spec.levels || [];
    const latest = latestByItem(attempts || []);
    const unseen = [];
    const missed = [];
    const known = [];
    (items || []).forEach(function (item) {
      if (topicIds.indexOf(item.topicId) < 0) return;
      if (levels.indexOf(item.level) < 0) return;
      const prev = latest.get(item.id);
      if (!prev) unseen.push(item);
      else if (prev.correct === false) missed.push(item);
      else known.push(item);
    });
    const pool = spec.preferUnseen ? unseen.slice() : unseen.concat(known);
    if (spec.includeMissed) missed.forEach(function (item) { pool.push(item); });
    return pool;
  }

  function sessionModeLabel(session) {
    session = session || {};
    if (session.kind === "custom" || session.mode === "test") {
      return session.mode === "timed" ? "Custom test, timed" : "Custom test";
    }
    if (session.mode === "timed") return "Practice test";
    return "Question bank";
  }

  function analyze(attempts, subject) {
    const list = Array.from(latestByItem(attempts).values());
    const attempted = list.length;
    const correct = list.filter(function (attempt) { return attempt.correct; }).length;
    const mastered = list.filter(isMastered).length;
    const shakyGuess = list.filter(function (attempt) {
      return attempt.correct && attempt.confidence === "guess";
    }).length;
    const shakyFifty = list.filter(function (attempt) {
      return attempt.correct && attempt.confidence === "fifty";
    }).length;
    const missed = list.filter(function (attempt) { return !attempt.correct; }).length;
    const sureButMissed = list.filter(function (attempt) {
      return !attempt.correct && attempt.confidence === "sure";
    }).length;
    const stillConfused = list.filter(function (attempt) { return attempt.sense === "confused"; }).length;

    const topicMap = new Map();
    const levelMap = new Map();
    list.forEach(function (attempt) {
      const topicId = attempt.topicId || "topic";
      if (!topicMap.has(topicId)) topicMap.set(topicId, []);
      topicMap.get(topicId).push(attempt);
      const levelId = attempt.level || "";
      if (!levelMap.has(levelId)) levelMap.set(levelId, []);
      levelMap.get(levelId).push(attempt);
    });

    function summarizeGroup(rows) {
      const right = rows.filter(function (attempt) { return attempt.correct; }).length;
      const got = rows.filter(isMastered).length;
      return {
        attempted: rows.length,
        correct: right,
        mastered: got,
        accuracy: pct(right, rows.length),
        mastery: pct(got, rows.length),
      };
    }

    const byTopic = Array.from(topicMap.entries()).map(function (entry) {
      return Object.assign({ topicId: entry[0], title: topicTitle(subject, entry[0]) }, summarizeGroup(entry[1]));
    }).sort(function (a, b) {
      return a.accuracy - b.accuracy || a.title.localeCompare(b.title);
    });

    const levelOrder = ((subject && subject.levels) || []).map(function (level) { return level.id; });
    const byLevel = Array.from(levelMap.entries()).map(function (entry) {
      const info = levelInfo(subject, entry[0]);
      return Object.assign({ levelId: entry[0], label: info.label, name: info.name }, summarizeGroup(entry[1]));
    }).sort(function (a, b) {
      const ai = levelOrder.indexOf(a.levelId);
      const bi = levelOrder.indexOf(b.levelId);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });

    const errorCounts = new Map();
    const mistakeMap = new Map();
    const other = { itemIds: [] };
    list.forEach(function (attempt) {
      if (attempt.correct) return;
      const typeId = attempt.errorType || "";
      errorCounts.set(typeId, (errorCounts.get(typeId) || 0) + 1);
      const feedback = attempt.feedback || "";
      const code = String(attempt.misconception || "").trim();
      if (!String(feedback).trim()) {
        other.itemIds.push(attempt.itemId);
        return;
      }
      if (!isDCode(code)) {
        const key = "item:" + attempt.itemId;
        mistakeMap.set(key, {
          key: key,
          misconception: "",
          dCode: false,
          feedbacks: [feedback],
          errorTypes: [typeId],
          itemIds: [attempt.itemId],
        });
        return;
      }
      const key = code.toUpperCase();
      if (!mistakeMap.has(key)) {
        mistakeMap.set(key, {
          key: key,
          misconception: key,
          dCode: true,
          feedbacks: [],
          errorTypes: [],
          itemIds: [],
        });
      }
      const group = mistakeMap.get(key);
      group.feedbacks.push(feedback);
      group.errorTypes.push(typeId);
      group.itemIds.push(attempt.itemId);
    });

    const mistakes = Array.from(mistakeMap.values()).map(function (group) {
      const feedbackHtml = mode(group.feedbacks.filter(Boolean)) || "";
      const distinct = [];
      const distinctHtml = [];
      group.feedbacks.forEach(function (feedback) {
        const text = strip(feedback);
        if (!text || text === strip(feedbackHtml) || distinct.indexOf(text) >= 0) return;
        distinct.push(text);
        distinctHtml.push(feedback);
      });
      return {
        key: group.key,
        misconception: group.misconception,
        dCode: !!group.dCode,
        errorType: mode(group.errorTypes.filter(Boolean)),
        errorLabel: groupErrorLabel(subject, group.errorTypes),
        count: group.itemIds.length,
        feedbackHtml: feedbackHtml,
        feedbackText: strip(feedbackHtml) || COMPARE,
        also: distinct.slice(0, 2),
        alsoHtml: distinctHtml.slice(0, 2),
        itemIds: group.itemIds.slice(),
      };
    }).sort(function (a, b) { return b.count - a.count || String(a.key).localeCompare(String(b.key)); });

    const conceptMap = new Map();
    list.forEach(function (attempt) {
      const key = (attempt.topicId || "") + "\0" + (attempt.level || "");
      if (!conceptMap.has(key)) conceptMap.set(key, []);
      conceptMap.get(key).push(attempt);
    });
    const conceptRows = Array.from(conceptMap.entries()).map(function (entry) {
      const rows = entry[1];
      const weak = rows.filter(function (attempt) { return !isMastered(attempt); });
      const sample = rows[0] || {};
      const title = topicTitle(subject, sample.topicId);
      const info = levelInfo(subject, sample.level);
      const levelName = info.name || info.label || "";
      let label = title || "This skill";
      if (title && levelName) label = title + " · " + levelName;
      else if (levelName) label = levelName;
      return {
        key: entry[0],
        label: label,
        topicTitle: "",
        attempted: rows.length,
        notMastered: weak.length,
        itemIds: weak.map(function (attempt) { return attempt.itemId; }),
      };
    }).filter(function (row) { return row.notMastered > 0; });
    const mergedConcepts = new Map();
    conceptRows.forEach(function (row) {
      const prev = mergedConcepts.get(row.label);
      if (!prev) {
        mergedConcepts.set(row.label, {
          key: row.label,
          label: row.label,
          topicTitle: "",
          attempted: row.attempted,
          notMastered: row.notMastered,
          itemIds: row.itemIds.slice(),
        });
        return;
      }
      prev.attempted += row.attempted;
      prev.notMastered += row.notMastered;
      row.itemIds.forEach(function (id) {
        if (prev.itemIds.indexOf(id) < 0) prev.itemIds.push(id);
      });
    });
    const concepts = Array.from(mergedConcepts.values())
      .sort(function (a, b) { return b.notMastered - a.notMastered || a.label.localeCompare(b.label); });

    const errorTypes = Array.from(errorCounts.entries()).map(function (entry) {
      return { id: entry[0] || "other", label: errorLabel(subject, entry[0]), count: entry[1] };
    }).sort(function (a, b) { return b.count - a.count; });

    return {
      attempted: attempted,
      correct: correct,
      accuracy: pct(correct, attempted),
      mastered: mastered,
      mastery: pct(mastered, attempted),
      shakyGuess: shakyGuess,
      shakyFifty: shakyFifty,
      missed: missed,
      sureButMissed: sureButMissed,
      stillConfused: stillConfused,
      byTopic: byTopic,
      byLevel: byLevel,
      errorTypes: errorTypes,
      mistakes: mistakes,
      patterns: mistakes.filter(function (row) { return row.dCode && row.count >= 2; }),
      otherMistakes: {
        count: other.itemIds.length,
        itemIds: other.itemIds.slice(),
        label: "Other mistakes",
        feedbackText: COMPARE,
      },
      concepts: concepts,
    };
  }

  function duration(ms) {
    const seconds = Math.max(0, Math.round((ms || 0) / 1000));
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    if (minutes <= 0) return rest + " sec";
    return minutes + " min " + rest + " sec";
  }

  function pushStats(lines, analysis) {
    lines.push("Answered: " + analysis.attempted);
    lines.push("Score: " + analysis.correct + "/" + analysis.attempted + " (" + analysis.accuracy + "%)");
    lines.push("Mastered (right and sure): " + analysis.mastered + "/" + analysis.attempted);
    lines.push("Correct but guessed: " + analysis.shakyGuess);
    lines.push("Correct but 50-50: " + analysis.shakyFifty);
    lines.push("Missed: " + analysis.missed);
    if (analysis.sureButMissed) lines.push("Sure, but missed: " + analysis.sureButMissed);
    lines.push("Still confused after the explanation: " + analysis.stillConfused);
  }

  function pushBars(lines, analysis) {
    if (analysis.byTopic.length) {
      lines.push("");
      lines.push("Accuracy by topic");
      analysis.byTopic.forEach(function (row) {
        lines.push("- " + row.title + ": " + row.correct + "/" + row.attempted + " right (" + row.accuracy + "%), " + row.mastered + " mastered");
      });
    }
    if (analysis.byLevel.length) {
      lines.push("");
      lines.push("Accuracy by level");
      analysis.byLevel.forEach(function (row) {
        lines.push("- " + row.label + ": " + row.correct + "/" + row.attempted + " right (" + row.accuracy + "%), " + row.mastered + " mastered");
      });
    }
    if (analysis.patterns.length) {
      lines.push("");
      lines.push("Repeated mistakes");
      analysis.patterns.forEach(function (row) {
        lines.push("- Missed " + row.count + " questions with the same mistake (" + row.errorLabel + "): " + (row.feedbackText || COMPARE));
        if (row.also && row.also.length) lines.push("  Also: " + row.also[0]);
        lines.push("  Items: " + row.itemIds.join(", "));
      });
    }
    const noted = analysis.mistakes.filter(function (row) { return !(row.dCode && row.count >= 2); });
    if (noted.length) {
      lines.push("");
      lines.push("Mistake notes");
      noted.slice(0, 8).forEach(function (row) {
        lines.push("- " + row.errorLabel + " (" + row.count + "): " + (row.feedbackText || COMPARE));
        lines.push("  Items: " + row.itemIds.join(", "));
      });
    }
    if (analysis.otherMistakes && analysis.otherMistakes.count) {
      lines.push("");
      lines.push("Other mistakes");
      lines.push("- " + (analysis.otherMistakes.feedbackText || COMPARE));
      lines.push("  Items: " + analysis.otherMistakes.itemIds.join(", "));
    }
    if (analysis.errorTypes.length) {
      lines.push("");
      lines.push("Mistake types");
      analysis.errorTypes.forEach(function (row) {
        lines.push("- " + row.label + ": " + row.count);
      });
    }
    if (analysis.concepts.length) {
      lines.push("");
      lines.push("Weak spots");
      analysis.concepts.slice(0, 8).forEach(function (row) {
        lines.push("- " + row.label + " — not mastered " + row.notMastered + " of " + row.attempted);
      });
    }
  }

  function pushReports(lines, reports) {
    lines.push("");
    lines.push("Problem reports");
    if (!reports || !reports.length) {
      lines.push("- none");
      return;
    }
    reports.forEach(function (report) {
      lines.push("- " + report.itemId + ": " + String(report.text || "").replace(/\s+/g, " ").trim());
    });
  }

  function formatAnalysisReport(options) {
    const analysis = options.analysis;
    const lines = [];
    lines.push("ICMS Practice");
    lines.push("Student: " + (options.name || "Student"));
    lines.push("Subject: " + (options.subject ? options.subject.title : ""));
    lines.push("My analysis");
    lines.push("");
    pushStats(lines, analysis);
    pushBars(lines, analysis);
    pushReports(lines, options.reports || []);
    lines.push("");
    lines.push("Mastered means the answer was right and the student was sure. A correct guess is not mastered.");
    return lines.join("\n");
  }

  function formatSessionReport(options) {
    const session = options.session;
    const analysis = options.analysis;
    const lines = [];
    lines.push("ICMS Practice");
    lines.push("Student: " + (options.name || "Student"));
    lines.push("Subject: " + (options.subject ? options.subject.title : ""));
    lines.push("Set: " + (session.title || "Practice"));
    lines.push("Mode: " + sessionModeLabel(session));
    lines.push("Level: " + (session.levelLabel || session.level || "All"));
    const wrong = [];
    const flagged = [];
    (session.itemIds || []).forEach(function (id) {
      const response = session.responses[id];
      if (!response) return;
      if (response.flagged) flagged.push(id);
      if (response.correct === false) wrong.push(id);
    });
    lines.push("Score: " + analysis.correct + "/" + analysis.attempted);
    lines.push("Time: " + duration(session.elapsedMs || 0));
    lines.push("Wrong item IDs: " + (wrong.length ? wrong.join(", ") : "none"));
    if (flagged.length) lines.push("Flagged: " + flagged.join(", "));
    lines.push("");
    lines.push("This set");
    pushStats(lines, analysis);
    pushBars(lines, analysis);
    pushReports(lines, options.reports || []);
    if (options.allAnalysis && options.allAnalysis.attempted) {
      lines.push("");
      lines.push("All-time snapshot");
      lines.push("Answered " + options.allAnalysis.attempted + ", right " + options.allAnalysis.correct + " (" + options.allAnalysis.accuracy + "%), mastered " + options.allAnalysis.mastered + ".");
      options.allAnalysis.byTopic.forEach(function (row) {
        lines.push("- " + row.title + ": " + row.correct + "/" + row.attempted + " right, " + row.mastered + " mastered");
      });
    }
    lines.push("");
    lines.push("Mastered means the answer was right and the student was sure. A correct guess is not mastered.");
    return lines.join("\n");
  }

  return {
    analyze: analyze,
    isTestMode: isTestMode,
    testAttempts: testAttempts,
    selectCustomPool: selectCustomPool,
    sessionModeLabel: sessionModeLabel,
    formatAnalysisReport: formatAnalysisReport,
    formatSessionReport: formatSessionReport,
    topicTitle: topicTitle,
    levelInfo: levelInfo,
    errorLabel: errorLabel,
    isMastered: isMastered,
    pct: pct,
    duration: duration,
    strip: strip,
  };
});
