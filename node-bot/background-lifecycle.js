function createBackgroundLifecycle(options) {
  const {
    initialLoad,
    runCompactor,
    runReviewer,
    jobsPaused = () => false,
    refreshMs = 3600000,
    reviewMs = 3600000,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    logger = console,
  } = options;

  let startPromise = null;
  let stopped = true;
  const timers = new Set();
  const activeJobs = new Set();

  function trackJob(promise, label) {
    const job = Promise.resolve(promise)
      .catch((error) => logger.warn(`${label} failed:`, error?.message || error))
      .finally(() => activeJobs.delete(job));
    activeJobs.add(job);
    return job;
  }

  function schedule(job, intervalMs, label) {
    if (!(intervalMs > 0) || stopped) return;
    const timer = setIntervalFn(() => {
      if (!stopped && !jobsPaused()) trackJob(job(), label);
    }, intervalMs);
    timers.add(timer);
  }

  async function start() {
    if (startPromise) return startPromise;
    stopped = false;
    startPromise = (async () => {
      try {
        await initialLoad();
        if (stopped) return;
        if (!jobsPaused()) trackJob(runCompactor(), "Compactor initial run");
        schedule(runCompactor, refreshMs, "Background memory refresh");
        schedule(
          () => runReviewer(true, { skipIfUnchanged: true }),
          reviewMs,
          "Background memory reviewer periodic run",
        );
      } catch (error) {
        await stop();
        startPromise = null;
        throw error;
      }
    })();
    return startPromise;
  }

  async function stop() {
    stopped = true;
    for (const timer of timers) clearIntervalFn(timer);
    timers.clear();
    await Promise.allSettled([...activeJobs]);
  }

  return {
    start,
    stop,
    status: () => ({ running: !stopped, timerCount: timers.size }),
  };
}

module.exports = { createBackgroundLifecycle };
