(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ICMS = Object.assign(root.ICMS || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function strip(src) {
    return String(src || "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/\\\$/g, "$")
      .replace(/\$/g, "")
      .replace(/\s+/g, " ")
      .trim();
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
    if (!id) return "Other miss";
    const map = (subject && subject.errorTypes) || {};
    if (map[id]) return map[id];
    return String(id).replace(/[-_]+/g, " ").replace(/\b\w/g, function (ch) {
      return ch.toUpperCase();
    });
  }

  function isMastered(attempt) {
    return attempt.correct === true && attempt.confidence === "sure";
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
    list.forEach(function (attempt) {
      if (attempt.correct) return;
      const typeId = attempt.errorType || "";
      errorCounts.set(typeId, (errorCounts.get(typeId) || 0) + 1);
      const code = attempt.misconception || "";
      const key = code || ("text:" + strip(attempt.feedback).slice(0, 80));
      if (!mistakeMap.has(key)) {
        mistakeMap.set(key, { key: key, misconception: code, feedbacks: [], errorTypes: [], itemIds: [] });
      }
      const group = mistakeMap.get(key);
      group.feedbacks.push(attempt.feedback || "");
      group.errorTypes.push(typeId);
      group.itemIds.push(attempt.itemId);
    });

    const mistakes = Array.from(mistakeMap.values()).map(function (group) {
      const feedbackHtml = mode(group.feedbacks.filter(Boolean)) || "";
      const errorType = mode(group.errorTypes);
      const distinct = [];
      group.feedbacks.forEach(function (feedback) {
        const text = strip(feedback);
        if (!text || text === strip(feedbackHtml) || distinct.indexOf(text) >= 0) return;
        distinct.push(text);
      });
      return {
        key: group.key,
        misconception: group.misconception,
        errorType: errorType,
        errorLabel: errorLabel(subject, errorType),
        count: group.itemIds.length,
        feedbackHtml: feedbackHtml,
        feedbackText: strip(feedbackHtml),
        also: distinct.slice(0, 2),
        itemIds: group.itemIds.slice(),
      };
    }).sort(function (a, b) { return b.count - a.count; });

    const conceptMap = new Map();
    list.forEach(function (attempt) {
      const tags = attempt.concepts && attempt.concepts.length ? attempt.concepts : [attempt.familyLabel || "General"];
      tags.forEach(function (tag) {
        if (!conceptMap.has(tag)) conceptMap.set(tag, []);
        conceptMap.get(tag).push(attempt);
      });
    });
    const concepts = Array.from(conceptMap.entries()).map(function (entry) {
      const rows = entry[1];
      const weak = rows.filter(function (attempt) { return !isMastered(attempt); });
      const families = [];
      weak.forEach(function (attempt) {
        const label = attempt.familyLabel || "";
        if (label && families.indexOf(label) < 0) families.push(label);
      });
      const fromSubject = subject && subject.conceptLabels ? subject.conceptLabels[entry[0]] : "";
      const label = families.slice(0, 2).join(" · ") || fromSubject || entry[0];
      const topicIds = [];
      rows.forEach(function (attempt) {
        if (topicIds.indexOf(attempt.topicId) < 0) topicIds.push(attempt.topicId);
      });
      return {
        key: entry[0],
        label: label,
        code: entry[0],
        topicTitle: topicIds.map(function (id) { return topicTitle(subject, id); }).join(", "),
        attempted: rows.length,
        notMastered: weak.length,
        families: families,
        itemIds: weak.map(function (attempt) { return attempt.itemId; }),
      };
    }).filter(function (row) { return row.notMastered > 0; })
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
      patterns: mistakes.filter(function (row) { return row.count >= 2; }),
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
        lines.push("- Missed " + row.count + " questions with the same mistake (" + row.errorLabel + "): " + (row.feedbackText || "See the explanation."));
        if (row.also && row.also.length) lines.push("  Also: " + row.also[0]);
        lines.push("  Items: " + row.itemIds.join(", "));
      });
    } else if (analysis.mistakes.length) {
      lines.push("");
      lines.push("Mistake notes");
      analysis.mistakes.slice(0, 8).forEach(function (row) {
        lines.push("- " + row.errorLabel + " (" + row.count + "): " + (row.feedbackText || "No extra note."));
        lines.push("  Items: " + row.itemIds.join(", "));
      });
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
        lines.push("- " + row.label + " — " + row.topicTitle + " — not mastered " + row.notMastered + " of " + row.attempted);
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
    lines.push("Mode: " + (session.mode === "timed" ? "Timed set" : session.mode === "retry" ? "Retry" : "Practice"));
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
