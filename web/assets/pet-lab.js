(() => {
  const pet = document.getElementById("pet");
  const sprite = document.getElementById("petSprite");
  const stage = document.getElementById("stage");
  const label = document.getElementById("stateLabel");
  const logBox = document.getElementById("log");

  const root = "./assets/pets/shira/";
  const r02Root = "./assets/pets/shira/r02/";
  const r03Root = "./assets/pets/shira/r03/";
  const actionFrames = {
    idle: [0, 1, 2, 3],
    walk: [0, 1, 2, 3],
    drag: [0, 1, 2, 3],
    fall: [0, 1, 2, 3],
    land: [0, 1, 2, 3],
    sleep: [0, 1, 2, 3],
    wake: [0, 1, 2, 3, 4, 5]
  };
  const actionRoots = {
    idle: r02Root,
    walk: r02Root,
    sleep: r02Root,
    wake: r02Root,
    drag: r03Root,
    fall: r03Root,
    land: r03Root
  };
  const frames = Object.fromEntries(
    Object.entries(actionFrames).map(([action, indexes]) => [
      action,
      indexes.map(i => `${actionRoots[action] || root}${action}_${String(i).padStart(2, "0")}.png`)
    ])
  );
  Object.values(frames).flat().forEach(src => {
    const img = new Image();
    img.src = src;
  });

  const state = {
    action: "idle",
    frame: 0,
    x: 120,
    y: 64,
    vx: 34,
    vy: 0,
    dir: 1,
    dragging: false,
    pointerId: null,
    lastMove: null,
    lastUserAt: performance.now(),
    frameMs: 180,
    frameAt: 0,
    landUntil: 0,
    wakeUntil: 0
  };

  const nativeFacing = -1;
  const frameDurations = {
    idle: [4200, 120, 6500, 5200],
    walk: [170, 170, 170, 170],
    drag: [150, 150, 150, 150],
    fall: [160, 160, 160, 160],
    land: [180, 230, 320, 520],
    sleep: [900, 1100, 1500, 30000],
    wake: [360, 420, 440, 520, 560, 700]
  };

  function log(text) {
    const row = document.createElement("div");
    row.textContent = text;
    logBox.prepend(row);
    while (logBox.children.length > 5) logBox.lastChild.remove();
  }

  function setAction(action, reason = "") {
    if (!frames[action] || state.action === action) return;
    state.action = action;
    state.frame = 0;
    state.frameAt = performance.now();
    state.frameMs = frameDurations[action]?.[0] || 170;
    label.textContent = action;
    if (reason) log(`${action}: ${reason}`);
    render();
  }

  function actionDuration(action) {
    return (frameDurations[action] || []).reduce((sum, ms) => sum + ms, 0);
  }

  function bounds() {
    const r = stage.getBoundingClientRect();
    return { width: r.width, height: r.height, floor: 64 };
  }

  function render() {
    const turn = state.dir === nativeFacing ? "scaleX(1)" : "scaleX(-1)";
    pet.style.left = `${state.x}px`;
    pet.style.bottom = `${state.y}px`;
    pet.style.transform = turn;
    sprite.src = frames[state.action][state.frame % frames[state.action].length];
  }

  function groundClamp() {
    const b = bounds();
    state.x = Math.max(8, Math.min(state.x, b.width - 208));
    state.y = Math.max(b.floor, Math.min(state.y, b.height - 290));
  }

  function resetPet() {
    const b = bounds();
    state.x = Math.max(48, Math.min(120, b.width - 208));
    state.y = b.floor;
    state.vx = 34;
    state.vy = 0;
    state.dir = 1;
    setAction("idle", "回到舞台");
    render();
  }

  function tick(now) {
    if (!state.frameAt) state.frameAt = now;
    if (now - state.frameAt > state.frameMs) {
      if (state.action === "sleep" && state.frame === frames.sleep.length - 1) {
        state.frame = frames.sleep.length - 1;
      } else if (state.action === "wake" && state.frame === frames.wake.length - 1) {
        state.frame = frames.wake.length - 1;
      } else {
        state.frame = (state.frame + 1) % frames[state.action].length;
      }
      state.frameAt = now;
      state.frameMs = frameDurations[state.action]?.[state.frame] || 170;
    }

    const b = bounds();
    if (!state.dragging) {
      if (state.action === "walk") {
        state.x += state.vx * state.dir / 60;
        if (state.x < 8 || state.x > b.width - 208) {
          state.dir *= -1;
          state.x = Math.max(8, Math.min(state.x, b.width - 208));
        }
      }

      if (state.action === "fall") {
        state.vy -= 0.18;
        state.x += state.vx / 60;
        state.y += state.vy;
        if (state.y <= b.floor) {
          state.y = b.floor;
          state.vy = 0;
          state.landUntil = now + 650;
          setAction("land", "落地");
        }
      }

      if (state.action === "land" && now > state.landUntil) setAction("idle", "站稳了");
      if (state.action === "wake" && now > state.wakeUntil) setAction("idle", "醒来了");
      if (now - state.lastUserAt > 35000 && !["sleep", "fall", "land", "wake"].includes(state.action)) {
        setAction("sleep", "太久没人理，人家先睡一下");
      }
    }

    groundClamp();
    render();
    requestAnimationFrame(tick);
  }

  pet.addEventListener("pointerdown", event => {
    state.dragging = true;
    state.pointerId = event.pointerId;
    state.lastMove = { x: event.clientX, y: event.clientY, t: performance.now(), vx: 0, vy: 0 };
    pet.classList.add("dragging");
    pet.setPointerCapture(event.pointerId);
    state.lastUserAt = performance.now();
    setAction("drag", "被拎起来了");
  });

  pet.addEventListener("pointermove", event => {
    if (!state.dragging || event.pointerId !== state.pointerId) return;
    const rect = stage.getBoundingClientRect();
    const now = performance.now();
    const dt = Math.max(16, now - state.lastMove.t);
    const vx = (event.clientX - state.lastMove.x) / dt * 1000;
    const vy = (state.lastMove.y - event.clientY) / dt * 1000;
    state.x = event.clientX - rect.left - 100;
    state.y = rect.bottom - event.clientY - 176;
    state.dir = vx < -20 ? -1 : vx > 20 ? 1 : state.dir;
    state.lastMove = { x: event.clientX, y: event.clientY, t: now, vx, vy };
    groundClamp();
    render();
  });

  function release(event) {
    if (!state.dragging) return;
    if (state.pointerId !== null && pet.hasPointerCapture?.(state.pointerId)) {
      try {
        pet.releasePointerCapture(state.pointerId);
      } catch {
        // Some browser automation surfaces synthesize pointer ids differently.
      }
    }
    pet.classList.remove("dragging");
    state.dragging = false;
    state.pointerId = null;
    const move = state.lastMove || { vx: 0, vy: 0 };
    const speed = Math.hypot(move.vx, move.vy);
    const highDrop = state.y > bounds().floor + 80;
    if (speed > 700 || highDrop) {
      state.vx = Math.max(-420, Math.min(420, move.vx));
      state.vy = Math.max(5, Math.min(10, move.vy / 120 || 6));
      state.dir = state.vx < 0 ? -1 : 1;
      setAction("fall", "被甩出去了");
    } else {
      state.landUntil = performance.now() + 600;
      setAction("land", "轻轻放下");
    }
  }

  pet.addEventListener("pointerup", release);
  pet.addEventListener("pointercancel", release);
  pet.addEventListener("lostpointercapture", release);
  window.addEventListener("pointerup", release, true);
  window.addEventListener("pointercancel", release, true);

  pet.addEventListener("dblclick", () => {
    state.lastUserAt = performance.now();
    state.wakeUntil = performance.now() + actionDuration("wake") + 120;
    setAction("wake", "被叫醒");
  });

  stage.addEventListener("pointermove", event => {
    if (state.dragging || ["sleep", "fall", "land", "wake"].includes(state.action)) return;
    const rect = stage.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const petCenter = state.x + 100;
    if (Math.abs(mouseX - petCenter) < 220) {
      state.dir = mouseX > petCenter ? 1 : -1;
      setAction("walk", "追着鼠标走");
      state.lastUserAt = performance.now();
    }
  });

  document.querySelector(".toolbar").addEventListener("click", event => {
    const action = event.target.dataset.action;
    if (!action) return;
    state.lastUserAt = performance.now();
    if (action === "reset") return resetPet();
    if (action === "wake") state.wakeUntil = performance.now() + actionDuration("wake") + 120;
    if (action === "fall") {
      const b = bounds();
      state.y = Math.max(b.floor + 180, b.height - 290);
      state.vx = 90;
      state.vy = 6;
      state.dir = 1;
    }
    if (action === "land") state.landUntil = performance.now() + actionDuration("land") + 160;
    setAction(action, "手动触发");
  });

  resetPet();
  requestAnimationFrame(tick);
})();
