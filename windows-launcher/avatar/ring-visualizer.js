(() => {
  const BAR_COUNT = 32;
  const IDLE_COLOR = "#f7fafc";
  const ACTIVE_COLOR = "#a7f3d0";
  const VALID_STATES = new Set([
    "idle",
    "talking",
    "excited",
    "angry",
    "sad",
    "disgusted",
  ]);

  const STATE_PROFILES = Object.freeze({
    idle: Object.freeze({ rotationSpeed: 0.055, waveSpeed: 0.45, waveStrength: 0 }),
    talking: Object.freeze({ rotationSpeed: 0.18, waveSpeed: 2.2, waveStrength: 0.34 }),
    excited: Object.freeze({ rotationSpeed: 0.3, waveSpeed: 3.2, waveStrength: 0.46 }),
    angry: Object.freeze({ rotationSpeed: 0.23, waveSpeed: 2.8, waveStrength: 0.4 }),
    sad: Object.freeze({ rotationSpeed: 0.08, waveSpeed: 1.25, waveStrength: 0.22 }),
    disgusted: Object.freeze({ rotationSpeed: 0.12, waveSpeed: 1.8, waveStrength: 0.28 }),
  });

  function clampEnergy(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(1, number));
  }

  function normalizeState(value) {
    const state = String(value || "idle").toLowerCase();
    return VALID_STATES.has(state) ? state : "idle";
  }

  function createBarSeeds(count = BAR_COUNT, seed = 0x4d414e41) {
    let value = seed >>> 0;
    return Array.from({ length: count }, (_, index) => {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      const phase = (value / 0x100000000) * Math.PI * 2;
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      const drift = 0.17 + (value / 0x100000000) * 0.19;
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      const bias = 0.36 + (value / 0x100000000) * 0.24;
      return Object.freeze({ index, phase, drift, bias });
    });
  }

  function getFrameSnapshot({
    timeMs = 0,
    state = "idle",
    energy = 0,
    reducedMotion = false,
    seeds = createBarSeeds(),
  } = {}) {
    const normalizedState = normalizeState(state);
    const normalizedEnergy = clampEnergy(energy);
    const active = normalizedState !== "idle" || normalizedEnergy > 0.015;
    const profile = STATE_PROFILES[normalizedState];
    const seconds = reducedMotion ? 0 : Math.max(0, Number(timeMs) || 0) / 1000;
    const breath = reducedMotion ? 0 : Math.sin(seconds * 0.82) * 0.045;
    const rotation = reducedMotion ? 0 : seconds * profile.rotationSpeed;

    const barSeeds = Array.isArray(seeds) && seeds.length >= BAR_COUNT
      ? seeds
      : createBarSeeds();
    const bars = barSeeds.slice(0, BAR_COUNT).map((bar, index) => {
      const angle = (index / BAR_COUNT) * Math.PI * 2;
      const slowNoise = Math.sin(seconds * bar.drift + bar.phase);
      const secondaryNoise = Math.sin(
        seconds * bar.drift * 0.43 + bar.phase * 1.71,
      );
      const irregular = slowNoise * 0.68 + secondaryNoise * 0.32;
      const travelingWave = active
        ? Math.pow(
            0.5 +
              0.5 *
                Math.cos(angle - seconds * profile.waveSpeed + bar.phase * 0.08),
            normalizedState === "angry" ? 3.4 : 2.1,
          )
        : 0;
      const audioLift = normalizedEnergy * (0.34 + travelingWave * 0.55);
      const length = Math.max(
        0.2,
        Math.min(
          1,
          bar.bias +
            irregular * 0.13 +
            breath +
            travelingWave * profile.waveStrength +
            audioLift,
        ),
      );
      return Object.freeze({ angle, length, wave: travelingWave });
    });

    return Object.freeze({
      active,
      bars: Object.freeze(bars),
      breath,
      color: active ? ACTIVE_COLOR : IDLE_COLOR,
      energy: normalizedEnergy,
      rotation,
      state: normalizedState,
    });
  }

  function createManaRing(options = {}) {
    const canvas = options.canvas;
    if (!canvas || typeof canvas.getContext !== "function") {
      throw new TypeError("A canvas element is required.");
    }
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is not available.");

    const host = typeof window === "undefined" ? globalThis : window;
    const requestFrame =
      options.requestAnimationFrame || host.requestAnimationFrame?.bind(host);
    const cancelFrame =
      options.cancelAnimationFrame || host.cancelAnimationFrame?.bind(host);
    const motionQuery = host.matchMedia?.("(prefers-reduced-motion: reduce)");
    const seeds = createBarSeeds(BAR_COUNT, options.seed);
    let state = normalizeState(options.initialState);
    let energyTarget = 0;
    let energyValue = 0;
    let frameId = null;
    let lastTime = null;
    let width = 1;
    let height = 1;
    let pixelRatio = 1;
    let reducedMotion = options.reducedMotion ?? Boolean(motionQuery?.matches);
    let resizeObserver = null;

    function resize() {
      const bounds = canvas.getBoundingClientRect?.() || {};
      width = Math.max(1, Math.round(bounds.width || canvas.clientWidth || 234));
      height = Math.max(
        1,
        Math.round(bounds.height || canvas.clientHeight || 234),
      );
      pixelRatio = Math.max(
        1,
        Math.min(2.5, Number(options.pixelRatio || host.devicePixelRatio) || 1),
      );
      const nextWidth = Math.round(width * pixelRatio);
      const nextHeight = Math.round(height * pixelRatio);
      if (canvas.width !== nextWidth) canvas.width = nextWidth;
      if (canvas.height !== nextHeight) canvas.height = nextHeight;
    }

    function draw(snapshot, timeMs) {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);

      const size = Math.min(width, height);
      const centerX = width / 2;
      const centerY = height / 2;
      const innerRadius = size * 0.225;
      const minLength = size * 0.055;
      const lengthRange = size * 0.13;
      const barWidth = Math.max(2, size * 0.014);
      const activeGlow = snapshot.active ? 12 + snapshot.energy * 18 : 5;

      if (snapshot.active) {
        const pulse = reducedMotion ? 0.45 : ((timeMs / 1250) % 1);
        context.beginPath();
        context.arc(
          centerX,
          centerY,
          innerRadius * (0.72 + pulse * 0.38 + snapshot.energy * 0.12),
          0,
          Math.PI * 2,
        );
        context.strokeStyle = `rgba(167, 243, 208, ${0.2 * (1 - pulse) + 0.04})`;
        context.lineWidth = Math.max(1, size * 0.006);
        context.shadowColor = ACTIVE_COLOR;
        context.shadowBlur = 12;
        context.stroke();
      }

      context.save();
      context.translate(centerX, centerY);
      context.rotate(snapshot.rotation);
      context.fillStyle = snapshot.color;
      context.shadowColor = snapshot.color;
      context.shadowBlur = activeGlow;

      for (const bar of snapshot.bars) {
        const length = minLength + lengthRange * bar.length;
        context.save();
        context.rotate(bar.angle);
        context.globalAlpha = snapshot.active ? 0.72 + bar.wave * 0.28 : 0.72;
        context.fillRect(-barWidth / 2, -innerRadius - length, barWidth, length);
        context.restore();
      }
      context.restore();

      context.beginPath();
      context.arc(
        centerX,
        centerY,
        size * (0.018 + snapshot.energy * 0.012),
        0,
        Math.PI * 2,
      );
      context.fillStyle = snapshot.color;
      context.globalAlpha = snapshot.active ? 0.78 : 0.28;
      context.shadowColor = snapshot.color;
      context.shadowBlur = snapshot.active ? 20 : 8;
      context.fill();
      context.globalAlpha = 1;
      context.shadowBlur = 0;
    }

    function renderFrame(timeMs = host.performance?.now?.() || 0) {
      resize();
      const delta =
        lastTime === null ? 16 : Math.max(0, Math.min(100, timeMs - lastTime));
      lastTime = timeMs;
      const smoothing =
        1 - Math.exp(-delta / (energyTarget > energyValue ? 70 : 230));
      energyValue += (energyTarget - energyValue) * smoothing;
      const snapshot = getFrameSnapshot({
        timeMs,
        state,
        energy: energyValue,
        reducedMotion,
        seeds,
      });
      draw(snapshot, timeMs);
      return snapshot;
    }

    function loop(timeMs) {
      renderFrame(timeMs);
      if (requestFrame) frameId = requestFrame(loop);
    }

    function start() {
      if (frameId !== null || !requestFrame) {
        if (!requestFrame) renderFrame();
        return;
      }
      frameId = requestFrame(loop);
    }

    function stop() {
      if (frameId !== null && cancelFrame) cancelFrame(frameId);
      frameId = null;
    }

    function setState(nextState) {
      state = normalizeState(nextState);
    }

    function setEnergy(value) {
      energyTarget = clampEnergy(Number(value) * 4.5);
    }

    function handleMotionChange(event) {
      reducedMotion = Boolean(event.matches);
    }

    motionQuery?.addEventListener?.("change", handleMotionChange);
    if (typeof host.ResizeObserver === "function") {
      resizeObserver = new host.ResizeObserver(resize);
      resizeObserver.observe(canvas);
    } else {
      host.addEventListener?.("resize", resize);
    }

    resize();
    start();

    return Object.freeze({
      destroy() {
        stop();
        resizeObserver?.disconnect();
        host.removeEventListener?.("resize", resize);
        motionQuery?.removeEventListener?.("change", handleMotionChange);
      },
      renderFrame,
      resize,
      setEnergy,
      setState,
      start,
      stop,
    });
  }

  const api = Object.freeze({
    ACTIVE_COLOR,
    BAR_COUNT,
    IDLE_COLOR,
    clampEnergy,
    createBarSeeds,
    createManaRing,
    getFrameSnapshot,
    normalizeState,
  });

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.ManaRingVisualizer = api;
})();
