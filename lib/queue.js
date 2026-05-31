// Async queue for serializing concurrent operations.
// Ensures only N operations run at a time (default: 1).

const { logInfo } = require('./logger');

/**
 * AsyncQueue serializes operations to prevent concurrent execution.
 * Useful for ensuring only one build, one design save, etc. at a time.
 *
 * @param {number} maxConcurrency - Max operations running simultaneously (default: 1)
 * @param {number} maxQueued - Max tasks allowed to wait in the queue (default: 20).
 *   add() fast-fails with a rejected Promise when this depth is reached, preventing
 *   unbounded memory growth from accumulated task closures and Promise executor refs.
 */
class AsyncQueue {
  constructor(maxConcurrency = 1, maxQueued = 20) {
    this.maxConcurrency = maxConcurrency;
    this.maxQueued = maxQueued;
    this.queue = [];
    this.running = 0;
  }

  /**
   * Add a task to the queue.
   * Task is an async function that returns a Promise.
   * The add() method returns a Promise that resolves when the task completes,
   * or rejects immediately if the queue depth cap has been reached.
   *
   * @param {Function} task - Async function to execute
   * @param {string} label - Optional label for logging
   * @returns {Promise} Resolves to task result when complete
   */
  async add(task, label = 'task') {
    // Fast-fail before allocating any Promise executor or closure references.
    // Return a pre-rejected Promise so all await call sites catch this uniformly.
    if (this.queue.length >= this.maxQueued) {
      return Promise.reject(new Error('Queue full — try again later'));
    }
    return new Promise((resolve, reject) => {
      // Enqueue the task
      this.queue.push({ task, label, resolve, reject });
      // Try to run pending tasks
      this.process();
    });
  }

  /**
   * Process queued tasks, respecting maxConcurrency limit.
   * @private
   */
  async process() {
    // Don't exceed max concurrent operations
    if (this.running >= this.maxConcurrency) {
      return;
    }

    // Queue is empty, nothing to do
    if (this.queue.length === 0) {
      return;
    }

    // Dequeue the next task
    this.running += 1;
    const { task, label, resolve, reject } = this.queue.shift();

    try {
      logInfo('queue:task-start', { label });
      const result = await task();
      logInfo('queue:task-end', { label });
      resolve(result);
    } catch (err) {
      logInfo('queue:task-error', { label, reason: err.message });
      reject(err);
    } finally {
      // Decrement running count and process next task
      this.running -= 1;
      this.process();
    }
  }

  /**
   * Get current queue statistics.
   *
   * @returns {Object} { running, queued, maxConcurrency }
   */
  stats() {
    return {
      running: this.running,
      queued: this.queue.length,
      maxConcurrency: this.maxConcurrency,
    };
  }
}

// Export global queue instances.
// maxQueued = 10: with a 60 s build timeout and the buildLimiter (10 req/min),
// a legitimate user can never legitimately accumulate more than ~10 waiting tasks.
// Anything beyond that is a flood or a runaway client.
const buildQueue = new AsyncQueue(1, 10);
const designSaveQueue = new AsyncQueue(1, 10);

module.exports = { AsyncQueue, buildQueue, designSaveQueue };
