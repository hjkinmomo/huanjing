(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HermesSharedState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KEY = 'huanjing_public_normal_legacy_v1';
  const SHADOW = KEY + ':shadow_v1';
  const LOCK = 'hermes-project5-shared-state-v1';
  const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  function checksum(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }
  function read(storage) {
    const primary = storage.getItem(KEY);
    if (primary) {
      try { const state = JSON.parse(primary); if (record(state)) return {state, primary, recovered:false}; } catch {}
    }
    const raw = storage.getItem(SHADOW);
    if (raw) {
      try {
        const shadow = JSON.parse(raw);
        if (record(shadow.state) && (!shadow.checksum || shadow.checksum === checksum(JSON.stringify(shadow.state)))) {
          return {state:shadow.state, primary, recovered:true};
        }
      } catch {}
    }
    if (primary || raw) throw new Error('原有资料无法读取，已停止写入。请先在旧入口恢复备份。');
    return {state:{}, primary:null, recovered:false};
  }
  async function exclusive(locks, action) {
    if (!locks?.request) throw new Error('此浏览器不支持安全存储锁，请使用新版桌面浏览器。');
    return locks.request(LOCK, {ifAvailable:true}, lock => {
      if (!lock) throw new Error('旧版页面或另一个窗口正在使用共享资料。请关闭旧版页面后重试。');
      return action();
    });
  }
  function commit(storage, snapshot, next, at) {
    if (snapshot.recovered) throw new Error('当前读取的是恢复快照，请先在旧入口恢复资料，再赠礼。');
    if (storage.getItem(KEY) !== snapshot.primary) throw new Error('资料已在其他窗口变化，请重新选择礼物。');
    next.persistence = {...next.persistence, lastSavedAt:at};
    if (next.memoryDurability) {
      next.memoryDurability = {...next.memoryDurability, lastCheckpointAt:at, lastChecksum:''};
      next.memoryDurability.lastChecksum = checksum(JSON.stringify(next));
    }
    // The primary is the single commit point. A shadow failure after it is a warning, not a failed gift.
    const serialized = JSON.stringify(next);
    storage.setItem(KEY, serialized);
    let warning = '';
    try { storage.setItem(SHADOW, JSON.stringify({schema:'hermes_state_shadow_v1', savedAt:at, checksum:checksum(serialized), state:next})); }
    catch { warning = '赠礼已保存，但恢复副本暂未更新，请勿清除浏览器数据。'; }
    return {state:next, warning};
  }
  async function openLegacy(start) {
    const show = message => {
      const banner = document.createElement('div'); banner.setAttribute('role','alert');
      banner.style.cssText='position:fixed;inset:0;z-index:99999;background:#231d25;color:#f1e7eb;display:grid;place-content:center;gap:20px;padding:40px;font:16px/1.8 sans-serif';
      const text = document.createElement('p'); text.textContent = message;
      const retry = document.createElement('button'); retry.textContent='重新打开'; retry.onclick=()=>location.reload();
      banner.append(text,retry); document.body.append(banner);
    };
    try {
      await exclusive(navigator.locks, async () => {
        await start();
        // Legacy code writes whole snapshots synchronously. Reserve the writer for its lifetime,
        // rather than pretending per-action locks cover its timers and unawaited saves.
        await new Promise(() => {});
      });
    } catch (error) { show(error.message); }
  }
  return Object.freeze({KEY, SHADOW, LOCK, checksum, read, commit, exclusive, openLegacy});
});
