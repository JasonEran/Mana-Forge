const assert = require("node:assert/strict");
const test = require("node:test");

const { createBackgroundLifecycle } = require("../background-lifecycle");

test("background lifecycle starts once and clears every timer on stop", async () => {
  const timers = [];
  const cleared = [];
  let loads = 0;
  let compactions = 0;
  const lifecycle = createBackgroundLifecycle({
    initialLoad: async () => loads++,
    runCompactor: async () => compactions++,
    runReviewer: async () => {},
    setIntervalFn: (handler, ms) => {
      const timer = { handler, ms };
      timers.push(timer);
      return timer;
    },
    clearIntervalFn: (timer) => cleared.push(timer),
    refreshMs: 10,
    reviewMs: 20,
  });

  await Promise.all([lifecycle.start(), lifecycle.start()]);
  assert.equal(loads, 1);
  assert.equal(compactions, 1);
  assert.deepEqual(timers.map((timer) => timer.ms), [10, 20]);
  assert.deepEqual(lifecycle.status(), { running: true, timerCount: 2 });

  await lifecycle.stop();
  assert.deepEqual(cleared, timers);
  assert.deepEqual(lifecycle.status(), { running: false, timerCount: 0 });
});

test("background lifecycle cleans up when startup fails", async () => {
  const lifecycle = createBackgroundLifecycle({
    initialLoad: async () => {
      throw new Error("load failed");
    },
    runCompactor: async () => {},
    runReviewer: async () => {},
  });

  await assert.rejects(lifecycle.start(), /load failed/);
  assert.deepEqual(lifecycle.status(), { running: false, timerCount: 0 });
});
