const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ACTIVE_COLOR,
  BAR_COUNT,
  IDLE_COLOR,
  clampEnergy,
  createBarSeeds,
  getFrameSnapshot,
  normalizeState,
} = require("../avatar/ring-visualizer");

test("the Mana ring always contains 32 deterministic bars", () => {
  const first = createBarSeeds();
  const second = createBarSeeds();
  assert.equal(BAR_COUNT, 32);
  assert.equal(first.length, BAR_COUNT);
  assert.deepEqual(first, second);
  assert.notEqual(first[0].phase, first[1].phase);

  const frame = getFrameSnapshot({ timeMs: 1234, seeds: first });
  assert.equal(frame.bars.length, BAR_COUNT);
  assert.ok(frame.bars.every((bar) => bar.length >= 0.2 && bar.length <= 1));
  assert.equal(getFrameSnapshot({ seeds: [] }).bars.length, BAR_COUNT);
});

test("idle breathes in white with slow, smooth irregular motion", () => {
  const first = getFrameSnapshot({ timeMs: 1_000, state: "idle" });
  const next = getFrameSnapshot({ timeMs: 1_016, state: "idle" });
  assert.equal(first.active, false);
  assert.equal(first.color, IDLE_COLOR);
  assert.ok(next.rotation > first.rotation);
  assert.ok(Math.abs(next.breath - first.breath) < 0.01);
  assert.ok(
    next.bars.every((bar, index) => Math.abs(bar.length - first.bars[index].length) < 0.01),
  );
});

test("active states use a pale-green traveling energy wave", () => {
  const frame = getFrameSnapshot({
    timeMs: 2_000,
    state: "talking",
    energy: 0.45,
  });
  assert.equal(frame.active, true);
  assert.equal(frame.color, ACTIVE_COLOR);
  assert.equal(frame.energy, 0.45);
  assert.ok(frame.bars.some((bar) => bar.wave > 0.8));
  assert.ok(frame.bars.some((bar) => bar.wave < 0.2));
});

test("state, energy, and reduced-motion inputs are bounded", () => {
  assert.equal(normalizeState("EXCITED"), "excited");
  assert.equal(normalizeState("unknown"), "idle");
  assert.equal(clampEnergy(-1), 0);
  assert.equal(clampEnergy(2), 1);
  assert.equal(clampEnergy("invalid"), 0);

  const first = getFrameSnapshot({ timeMs: 1_000, reducedMotion: true });
  const next = getFrameSnapshot({ timeMs: 9_000, reducedMotion: true });
  assert.equal(first.rotation, 0);
  assert.deepEqual(first.bars, next.bars);
});
