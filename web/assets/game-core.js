(function initializeHermesGameCore(globalScope) {
  "use strict";

  function createSeededRandom(seed = Date.now()) {
    let state = (Number(seed) >>> 0) || 0x6d2b79f5;
    return function seededRandom() {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function orderSignature(items, keyOf = value => String(value?.id ?? value)) {
    return items.map(keyOf).join("|");
  }

  function hasAdjacentPair(items, keyOf) {
    return items.some((item, index) => index > 0 && keyOf(items[index - 1]) === keyOf(item));
  }

  function fisherYates(items, random) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
  }

  function shuffleDeck(items, random = Math.random, options = {}) {
    const source = [...items];
    if (source.length < 2) return source;
    const keyOf = typeof options.keyOf === "function" ? options.keyOf : value => String(value?.id ?? value);
    const previousSignature = Array.isArray(options.previousOrder)
      ? orderSignature(options.previousOrder, keyOf)
      : String(options.previousSignature || "");
    let fallback = source;
    for (let attempt = 0; attempt < 48; attempt += 1) {
      const candidate = fisherYates(source, random);
      fallback = candidate;
      const repeated = previousSignature && orderSignature(candidate, keyOf) === previousSignature;
      const adjacent = options.avoidAdjacentPairs && hasAdjacentPair(candidate, keyOf);
      if (!repeated && !adjacent) return candidate;
    }
    if (previousSignature && orderSignature(fallback, keyOf) === previousSignature) {
      return [...fallback.slice(1), fallback[0]];
    }
    return fallback;
  }

  function chooseLegalCell({ width, height, occupied = new Set(), random = Math.random, inset = 0, excluded = [] }) {
    const blocked = occupied instanceof Set ? occupied : new Set(occupied);
    const excludedKeys = new Set(excluded.map(cell => `${cell.x},${cell.y}`));
    const cells = [];
    for (let y = inset; y < height - inset; y += 1) {
      for (let x = inset; x < width - inset; x += 1) {
        const key = `${x},${y}`;
        if (!blocked.has(key) && !excludedKeys.has(key)) cells.push({ x, y });
      }
    }
    if (!cells.length) return null;
    return cells[Math.min(cells.length - 1, Math.floor(random() * cells.length))];
  }

  function normalizeGameKey(key) {
    return String(key || "").toLowerCase();
  }

  function shouldPauseGame({ reason, hidden = false, activeGame = null }) {
    if (!activeGame) return false;
    if (reason === "visibility") return Boolean(hidden);
    return reason === "panel-exit" || reason === "blur";
  }

  function gradeSession({ completed, accuracy = 0, timeRatio = 1, mistakes = 0 }) {
    if (!completed) return mistakes <= 2 && accuracy >= 0.65 ? "B" : "C";
    const score = (Math.max(0, Math.min(1, accuracy)) * 58)
      + (Math.max(0, Math.min(1.2, 1.35 - timeRatio)) * 25)
      + Math.max(0, 22 - mistakes * 4);
    if (score >= 91) return "S";
    if (score >= 74) return "A";
    if (score >= 56) return "B";
    return "C";
  }

  function createSession({ id, gameId, difficulty = "normal", now = Date.now() }) {
    return {
      id: id || `${gameId || "game"}-${now}-${Math.random().toString(16).slice(2, 8)}`,
      gameId: gameId || "game",
      difficulty,
      startedAt: now,
      pausedAt: 0,
      pausedMs: 0,
      attempts: 0,
      mistakes: 0,
      completed: false,
      settled: false
    };
  }

  function pauseSession(session, now = Date.now()) {
    if (!session || session.pausedAt || session.settled) return session;
    session.pausedAt = now;
    return session;
  }

  function resumeSession(session, now = Date.now()) {
    if (!session?.pausedAt || session.settled) return session;
    session.pausedMs += Math.max(0, now - session.pausedAt);
    session.pausedAt = 0;
    return session;
  }

  function elapsedMs(session, now = Date.now()) {
    if (!session) return 0;
    const end = session.pausedAt || now;
    return Math.max(0, end - session.startedAt - Number(session.pausedMs || 0));
  }

  function settleSession(input, ledger = []) {
    const sessionId = String(input?.sessionId || "");
    if (!sessionId) return { accepted: false, reason: "missing_session", receipt: null };
    if (ledger.some(item => item?.sessionId === sessionId)) {
      return { accepted: false, reason: "duplicate_session", receipt: null };
    }
    const receipt = {
      id: `receipt-${sessionId}`,
      sessionId,
      gameId: String(input.gameId || "game"),
      completed: Boolean(input.completed),
      score: Number(input.score || 0),
      grade: String(input.grade || "C"),
      reward: Math.max(0, Math.round(Number(input.reward || 0))),
      at: input.at || new Date().toISOString()
    };
    return { accepted: true, reason: "accepted", receipt };
  }

  const api = Object.freeze({
    createSeededRandom,
    shuffleDeck,
    chooseLegalCell,
    normalizeGameKey,
    shouldPauseGame,
    gradeSession,
    createSession,
    pauseSession,
    resumeSession,
    elapsedMs,
    settleSession
  });

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.HermesGameCore = api;
})(typeof window !== "undefined" ? window : globalThis);
