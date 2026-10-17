/* Presentation only: no character text, portrait, pet state or permission changes. */
(() => {
  "use strict";
  const key = "hermes.characterTheme.enabled.v1";
  let enabled = true;
  let role = "";
  let manualTheme = false;
  try { enabled = localStorage.getItem(key) !== "false"; } catch { /* Session-only preference. */ }
  const toggle = document.getElementById("characterThemeEnabled");
  const sidebar = document.querySelector?.(".sidebar");
  const nav = document.querySelector?.(".destination-nav");
  const utility = document.querySelector?.(".sidebar-utility");
  const topActions = document.getElementById("characterTopActions");
  const petDock = document.querySelector?.('.pet-dock');
  const petMount = document.querySelector?.('#portraitPetMount');
  const petHome = petDock?.parentNode;
  const petNext = petDock?.nextSibling;
  function syncPetMount(panelId = document.querySelector?.('.panel.is-active')?.id) {
    if (!petDock || !petMount || !petHome) return;
    const inRail = role === 'shira' && !manualTheme && panelId === 'chat';
    if (inRail && petDock.parentNode !== petMount) petMount.append(petDock);
    else if (!inRail && petDock.parentNode !== petHome) {
      petHome.insertBefore(petDock, petNext?.parentNode === petHome ? petNext : null);
    }
  }
  let modeButton;
  if (sidebar && topActions && nav && utility) {
    modeButton = document.createElement("button");
    modeButton.className = "character-daynight";
    modeButton.type = "button";
    modeButton.addEventListener("click", () => {
      enabled = !enabled;
      try { localStorage.setItem(key, String(enabled)); } catch { /* Session only. */ }
      apply();
    });
    sidebar.append(modeButton);
  }
  function apply(nextRole = role, hasManualTheme = manualTheme) {
    role = nextRole;
    manualTheme = hasManualTheme;
    const active = enabled && role === "shira" && !manualTheme;
    const layout = role === "shira" && !manualTheme;
    if (layout) document.documentElement.dataset.characterLayout = "shira";
    else delete document.documentElement.dataset.characterLayout;
    if (modeButton) {
      if (layout) { topActions.append(nav, utility); nav.setAttribute("aria-orientation", "horizontal"); }
      else { sidebar.insertBefore(nav, modeButton); sidebar.insertBefore(utility, modeButton); nav.setAttribute("aria-orientation", "vertical"); }
      modeButton.hidden = !layout;
      modeButton.textContent = enabled ? "☀ 日间模式" : "☾ 夜间模式";
      modeButton.setAttribute("aria-label", enabled ? "切换日间模式" : "切换希拉夜间主题");
    }
    if (active) document.documentElement.dataset.characterTheme = "shira-nocturne";
    else delete document.documentElement.dataset.characterTheme;
    if (toggle) toggle.checked = enabled;
    syncPetMount();
  }
  toggle?.addEventListener("change", () => {
    enabled = toggle.checked;
    try { localStorage.setItem(key, String(enabled)); } catch { /* Keep session usable. */ }
    apply();
  });
  window.HermesCharacterTheme = Object.freeze({ apply, syncPetMount });
})();
