import { describe, test, expect } from "bun:test";
import { ExecutionQueue } from "../packages/app/src/kernel/execution-queue.ts";
import type { QueueEntry, Executor } from "../packages/app/src/kernel/execution-queue.ts";

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

describe("ExecutionQueue", () => {
  test("executes cells sequentially", async () => {
    const queue = new ExecutionQueue();
    const order: string[] = [];

    const executor: Executor = async (entry) => {
      order.push(`start:${entry.cellId}`);
      await delay(10);
      order.push(`end:${entry.cellId}`);
    };

    const p1 = queue.enqueue("cell-1", "code1", 1, executor);
    const p2 = queue.enqueue("cell-2", "code2", 2, executor);
    const p3 = queue.enqueue("cell-3", "code3", 3, executor);

    await Promise.all([p1, p2, p3]);

    expect(order).toEqual([
      "start:cell-1", "end:cell-1",
      "start:cell-2", "end:cell-2",
      "start:cell-3", "end:cell-3",
    ]);
  });

  test("deduplicates same cellId in queue", async () => {
    const queue = new ExecutionQueue();
    const executed: string[] = [];

    const executor: Executor = async (entry) => {
      await delay(20);
      executed.push(`${entry.cellId}:${entry.code}`);
    };

    // First call starts executing immediately
    const p1 = queue.enqueue("cell-1", "first", 1, executor);
    // These two have the same cellId — second should replace the first queued
    const p2 = queue.enqueue("cell-2", "old-code", 2, executor);
    const p3 = queue.enqueue("cell-2", "new-code", 3, executor);

    await Promise.all([p1, p2, p3]);

    // cell-2 should have executed only once with "new-code"
    expect(executed).toEqual(["cell-1:first", "cell-2:new-code"]);
  });

  test("max queue size evicts oldest", async () => {
    const queue = new ExecutionQueue();
    const executed: string[] = [];

    const executor: Executor = async (entry) => {
      await delay(50);
      executed.push(entry.cellId);
    };

    // Start one to block the queue
    const p0 = queue.enqueue("blocker", "code", 0, executor);

    // Queue 25 entries (max is 20)
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 25; i++) {
      promises.push(queue.enqueue(`cell-${i}`, "code", i + 1, executor));
    }

    await Promise.all([p0, ...promises]);

    // blocker + last 20 entries should have executed
    // First 5 (cell-0 through cell-4) should have been evicted
    expect(executed).toContain("blocker");
    expect(executed).not.toContain("cell-0");
    expect(executed).not.toContain("cell-4");
    expect(executed).toContain("cell-5");
    expect(executed).toContain("cell-24");
  });

  test("error does not block next cell", async () => {
    const queue = new ExecutionQueue();
    const results: string[] = [];

    const executor: Executor = async (entry) => {
      if (entry.cellId === "bad") throw new Error("boom");
      results.push(entry.cellId);
    };

    const p1 = queue.enqueue("bad", "code", 1, executor).catch(() => {});
    const p2 = queue.enqueue("good", "code", 2, executor);

    await Promise.all([p1, p2]);
    expect(results).toEqual(["good"]);
  });

  test("cancelAll clears everything", async () => {
    const queue = new ExecutionQueue();
    let cancelled: string[] = [];

    queue.onStatusChange = (cellId, status) => {
      if (status === "cancelled") cancelled.push(cellId);
    };

    const executor: Executor = async (entry) => {
      await delay(50);
    };

    // Fire and forget — these will resolve/reject via cancel
    queue.enqueue("cell-1", "code", 1, executor).catch(() => {});
    queue.enqueue("cell-2", "code", 2, executor).catch(() => {});
    queue.enqueue("cell-3", "code", 3, executor).catch(() => {});

    // Let cell-1 start, then cancel all
    await delay(5);
    queue.cancelAll();

    // Give the queue a moment to settle
    await delay(100);

    // All should be cancelled
    expect(cancelled).toContain("cell-1");
    expect(cancelled).toContain("cell-2");
    expect(cancelled).toContain("cell-3");
  });

  test("cancelCell removes specific entry from queue", async () => {
    const queue = new ExecutionQueue();
    const executed: string[] = [];

    const executor: Executor = async (entry) => {
      await delay(20);
      executed.push(entry.cellId);
    };

    const p1 = queue.enqueue("cell-1", "code", 1, executor);
    queue.enqueue("cell-2", "code", 2, executor);
    const p3 = queue.enqueue("cell-3", "code", 3, executor);

    // Cancel cell-2 while it's queued
    const removed = queue.cancelCell("cell-2");
    expect(removed).toBe(true);

    await Promise.all([p1, p3]);

    expect(executed).toEqual(["cell-1", "cell-3"]);
  });

  test("skip enqueue if same cellId is currently running", async () => {
    const queue = new ExecutionQueue();
    let execCount = 0;

    const executor: Executor = async () => {
      execCount++;
      await delay(30);
    };

    const p1 = queue.enqueue("cell-1", "code", 1, executor);
    // cell-1 is running, this should be skipped
    await delay(5);
    const p2 = queue.enqueue("cell-1", "code2", 2, executor);

    await Promise.all([p1, p2]);
    expect(execCount).toBe(1);
  });

  test("fires onQueueUpdate callbacks", async () => {
    const queue = new ExecutionQueue();
    const lengths: number[] = [];

    queue.onQueueUpdate = (len) => lengths.push(len);

    const executor: Executor = async (entry) => {
      await delay(10);
    };

    const p1 = queue.enqueue("cell-1", "code", 1, executor);
    const p2 = queue.enqueue("cell-2", "code", 2, executor);
    const p3 = queue.enqueue("cell-3", "code", 3, executor);

    await Promise.all([p1, p2, p3]);

    // Should have been called with increasing then decreasing lengths
    expect(lengths.length).toBeGreaterThan(0);
    // Final call should be 0
    expect(lengths[lengths.length - 1]).toBe(0);
  });
});
