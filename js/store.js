(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ICMS = Object.assign(root.ICMS || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CURRENT_KEY = "icms.currentStudent";
  const PREFS_KEY = "icms.prefs.v1";
  const SUBJECT_KEY = "icms.subject";
  const SESSION_KEY = "icms.session.v1";

  function profileKey(name) {
    return "icms.profile.v1." + String(name || "").trim().toLowerCase();
  }

  function emptyProfile(name) {
    return { name: name, subjects: {} };
  }

  function bucket(profile, subjectId) {
    if (!profile.subjects[subjectId]) profile.subjects[subjectId] = { attempts: [], reports: [] };
    const data = profile.subjects[subjectId];
    data.attempts = data.attempts || [];
    data.reports = data.reports || [];
    return data;
  }

  function loadProfile(name) {
    if (!name || typeof localStorage === "undefined") return emptyProfile(name || "");
    const raw = localStorage.getItem(profileKey(name));
    if (!raw) return emptyProfile(name);
    try {
      const data = JSON.parse(raw);
      data.name = data.name || name;
      data.subjects = data.subjects || {};
      return data;
    } catch (err) {
      return emptyProfile(name);
    }
  }

  function saveProfile(profile) {
    if (typeof localStorage === "undefined") return;
    const key = profileKey(profile.name);
    const write = function () {
      localStorage.setItem(key, JSON.stringify(profile));
    };
    try {
      write();
    } catch (err) {
      Object.keys(profile.subjects || {}).forEach(function (id) {
        const data = profile.subjects[id];
        if (data.attempts && data.attempts.length > 80) data.attempts = data.attempts.slice(-80);
        if (data.reports && data.reports.length > 40) data.reports = data.reports.slice(-40);
      });
      write();
    }
  }

  function recordAttempt(profile, subjectId, attempt) {
    const data = bucket(profile, subjectId);
    data.attempts.push(attempt);
    if (data.attempts.length > 3000) data.attempts = data.attempts.slice(-2000);
    saveProfile(profile);
  }

  function setReport(profile, subjectId, report) {
    const data = bucket(profile, subjectId);
    data.reports = data.reports.filter(function (entry) {
      return entry.itemId !== report.itemId;
    });
    if (report.text && String(report.text).trim()) data.reports.push(report);
    saveProfile(profile);
  }

  function setSense(profile, subjectId, itemId, ts, sense) {
    const data = bucket(profile, subjectId);
    for (let i = data.attempts.length - 1; i >= 0; i--) {
      if (data.attempts[i].itemId === itemId && data.attempts[i].ts === ts) {
        data.attempts[i].sense = sense;
        break;
      }
    }
    saveProfile(profile);
  }

  function latestByItem(attempts) {
    const map = new Map();
    (attempts || []).forEach(function (attempt) {
      const prev = map.get(attempt.itemId);
      if (!prev || (attempt.ts || 0) >= (prev.ts || 0)) map.set(attempt.itemId, attempt);
    });
    return map;
  }

  function loadPrefs() {
    const base = { level: "all", mode: "timed", count: 10 };
    if (typeof localStorage === "undefined") return base;
    try {
      return Object.assign(base, JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"));
    } catch (err) {
      return base;
    }
  }

  function savePrefs(prefs) {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }

  function currentName() {
    if (typeof localStorage === "undefined") return "";
    return localStorage.getItem(CURRENT_KEY) || "";
  }

  function setCurrentName(name) {
    localStorage.setItem(CURRENT_KEY, name);
  }

  function loadSession() {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  function saveSession(session) {
    if (typeof sessionStorage === "undefined") return;
    if (!session) sessionStorage.removeItem(SESSION_KEY);
    else sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  return {
    CURRENT_KEY: CURRENT_KEY,
    SUBJECT_KEY: SUBJECT_KEY,
    loadProfile: loadProfile,
    saveProfile: saveProfile,
    recordAttempt: recordAttempt,
    setReport: setReport,
    setSense: setSense,
    latestByItem: latestByItem,
    loadPrefs: loadPrefs,
    savePrefs: savePrefs,
    currentName: currentName,
    setCurrentName: setCurrentName,
    loadSession: loadSession,
    saveSession: saveSession,
    bucket: bucket,
  };
});
