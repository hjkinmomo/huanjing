(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HermesCompanionCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FONT_SCALES = new Set(["small", "medium", "large"]);
  const DENSITIES = new Set(["comfortable", "compact"]);
  const PORTRAIT_FRAMES = new Set(["none", "holographic", "prism", "pulse", "starlight"]);
  const UI_STATES = new Set(["idle", "loading", "empty", "offline", "error", "ready"]);
  const RELATIONSHIP_POLICY = Object.freeze({
    gift: Object.freeze({ dailyCap: 25, duplicateCooldownMs: 6 * 60 * 60 * 1000 }),
    game: Object.freeze({ dailyCap: 10, duplicateCooldownMs: 30 * 60 * 1000 }),
    conversation: Object.freeze({ dailyCap: 4, duplicateCooldownMs: 0 }),
    moment_comment: Object.freeze({ dailyCap: 2, duplicateCooldownMs: 60 * 60 * 1000 }),
    moment_like: Object.freeze({ dailyCap: 0, duplicateCooldownMs: Infinity }),
    purchase: Object.freeze({ dailyCap: 0, duplicateCooldownMs: Infinity })
  });

  function normalizeAppearance(input = {}) {
    return {
      fontScale: FONT_SCALES.has(input.fontScale) ? input.fontScale : "medium",
      density: DENSITIES.has(input.density) ? input.density : "comfortable",
      portraitFrame: PORTRAIT_FRAMES.has(input.portraitFrame) ? input.portraitFrame : "holographic",
      reducedMotion: input.reducedMotion === true
    };
  }

  function normalizeUiState(value) {
    return UI_STATES.has(value) ? value : "idle";
  }

  function momentDraftKey(event) {
    return `moment-draft:${String(event?.id || "")}:${String(event?.roleId || "shared")}`;
  }

  function dueComments(items, now) {
    const stamp = Date.parse(now);
    if (!Number.isFinite(stamp)) return [];
    return (Array.isArray(items) ? items : [])
      .filter(item => !item.publishedAt && Number.isFinite(Date.parse(item.dueAt)) && Date.parse(item.dueAt) <= stamp)
      .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || String(a.id).localeCompare(String(b.id)));
  }

  function canShareEvent(event, viewerRoleId) {
    if (!event || event.deletedAt) return false;
    if (event.visibility === "shared" || event.visibility === "all-characters") return true;
    return event.visibility === "private" && event.roleId === viewerRoleId;
  }

  function cloneValue(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function matchWorldbook(entries, text) {
    const haystack = String(text || "").toLocaleLowerCase();
    return (Array.isArray(entries) ? entries : [])
      .filter(entry => entry && entry.enabled !== false)
      .filter(entry => entry.constant === true || (
        Array.isArray(entry.keys)
        && entry.keys.some(key => haystack.includes(String(key).toLocaleLowerCase()))
      ))
      .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || String(a.id).localeCompare(String(b.id)));
  }

  function normalizeCharacterRevision(input = {}) {
    const card = input.card && typeof input.card === "object" ? cloneValue(input.card) : {};
    const loreBook = (Array.isArray(input.loreBook) ? input.loreBook : []).map((entry, index) => ({
      ...cloneValue(entry || {}),
      id: String(entry?.id || `lore-${index}`),
      keys: Array.isArray(entry?.keys) ? entry.keys.map(String).map(key => key.trim()).filter(Boolean) : [],
      content: String(entry?.content || ""),
      enabled: entry?.enabled !== false,
      selective: entry?.selective === true,
      constant: entry?.constant === true,
      priority: Math.max(0, Math.min(1000, Number(entry?.priority || 0)))
    }));
    return { roleId: String(input.roleId || ""), card, loreBook };
  }

  function relationshipTier(score) {
    const value = Math.max(0, Number(score || 0));
    if (value >= 75) return { id: "trusted", label: "信赖", minimum: 75, next: null };
    if (value >= 30) return { id: "familiar", label: "熟悉", minimum: 30, next: 75 };
    return { id: "new", label: "初识", minimum: 0, next: 30 };
  }

  function relationshipDelta({ roleId, sourceType, sourceId, requested, ledger, now } = {}) {
    const policy = RELATIONSHIP_POLICY[sourceType] || { dailyCap: 0, duplicateCooldownMs: Infinity };
    const nowMs = Date.parse(now);
    if (!roleId || !sourceId || !Number.isFinite(nowMs)) {
      return { accepted: 0, reason: "invalid", dailyUsed: 0, dailyCap: policy.dailyCap };
    }
    const entries = (Array.isArray(ledger) ? ledger : [])
      .filter(entry => entry?.roleId === roleId && entry?.sourceType === sourceType);
    const day = String(now).slice(0, 10);
    const dailyUsed = entries
      .filter(entry => String(entry.at || "").slice(0, 10) === day)
      .reduce((sum, entry) => sum + Math.max(0, Number(entry.accepted || 0)), 0);
    const duplicate = entries.find(entry => entry.sourceId === sourceId
      && Number.isFinite(Date.parse(entry.at))
      && nowMs - Date.parse(entry.at) < policy.duplicateCooldownMs);
    if (duplicate) return { accepted: 0, reason: "cooldown", dailyUsed, dailyCap: policy.dailyCap };
    const remaining = Math.max(0, policy.dailyCap - dailyUsed);
    const accepted = Math.max(0, Math.min(remaining, Number(requested || 0)));
    return { accepted, reason: accepted > 0 ? "accepted" : "daily_cap", dailyUsed, dailyCap: policy.dailyCap };
  }

  return Object.freeze({
    normalizeAppearance,
    normalizeUiState,
    momentDraftKey,
    dueComments,
    canShareEvent,
    matchWorldbook,
    normalizeCharacterRevision,
    relationshipTier,
    relationshipDelta
  });
});
