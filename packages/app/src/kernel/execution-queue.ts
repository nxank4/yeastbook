// Execution queue — sequential cell execution with cancel, timeout, dedup

export type QueueEntry = {
  cellId: string;
  code: string;
  executionCount: number;
  resolve: () => void;
  reject: (err: Error) => void;
  cancelToken: { cancelled: boolean };
  queuedAt: number;
};

export type Executor = (
  entry: QueueEntry
) => Promise<void>;

const MAX_QUEUE_SIZE = 20;
const EXECUTION_TIMEOUT_MS = 30_000;

export class ExecutionQueue {
  private queue: QueueEntry[] = [];
  private running: QueueEntry | null = null;
  private processing = false;

  onStatusChange?: (cellId: string, status: "queued" | "cancelled") => void;
  onQueueUpdate?: (queueLength: number) => void;

  get length(): number {
    return this.queue.length;
  }

  get currentEntry(): QueueEntry | null {
    return this.running;
  }

  enqueue(
    cellId: string,
    code: string,
    executionCount: number,
    executor: Executor
  ): Promise<void> {
    // If same cellId is currently running, skip (don't queue)
    if (this.running && this.running.cellId === cellId) {
      return Promise.resolve();
    }

    // Dedup: if same cellId already queued, cancel previous entry
    const existingIdx = this.queue.findIndex((e) => e.cellId === cellId);
    if (existingIdx !== -1) {
      const existing = this.queue[existingIdx];
      existing.cancelToken.cancelled = true;
      existing.resolve(); // resolve silently
      this.queue.splice(existingIdx, 1);
    }

    // Max queue: evict oldest if exceeded
    while (this.queue.length >= MAX_QUEUE_SIZE) {
      const evicted = this.queue.shift()!;
      evicted.cancelToken.cancelled = true;
      evicted.resolve();
      this.onStatusChange?.(evicted.cellId, "cancelled");
    }

    return new Promise<void>((resolve, reject) => {
      const entry: QueueEntry = {
        cellId,
        code,
        executionCount,
        resolve,
        reject,
        cancelToken: { cancelled: false },
        queuedAt: Date.now(),
      };

      this.queue.push(entry);
      this.onStatusChange?.(cellId, "queued");
      this.onQueueUpdate?.(this.queue.length);

      if (!this.processing) {
        this.processNext(executor);
      }
    });
  }

  private async processNext(executor: Executor): Promise<void> {
    if (this.queue.length === 0) {
      this.processing = false;
      this.running = null;
      return;
    }

    this.processing = true;
    const entry = this.queue.shift()!;
    this.running = entry;
    this.onQueueUpdate?.(this.queue.length);

    if (entry.cancelToken.cancelled) {
      entry.resolve();
      this.running = null;
      return this.processNext(executor);
    }

    // Timeout
    const timeoutId = setTimeout(() => {
      entry.cancelToken.cancelled = true;
      entry.reject(new Error(`Execution timed out after ${EXECUTION_TIMEOUT_MS / 1000}s`));
    }, EXECUTION_TIMEOUT_MS);

    try {
      await executor(entry);
      clearTimeout(timeoutId);
      if (!entry.cancelToken.cancelled) {
        entry.resolve();
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (!entry.cancelToken.cancelled) {
        entry.reject(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      this.running = null;
      // Always process next, even on error
      this.processNext(executor);
    }
  }

  cancelCell(cellId: string): boolean {
    // Check if it's in the queue
    const idx = this.queue.findIndex((e) => e.cellId === cellId);
    if (idx !== -1) {
      const entry = this.queue[idx];
      entry.cancelToken.cancelled = true;
      entry.resolve();
      this.queue.splice(idx, 1);
      this.onStatusChange?.(cellId, "cancelled");
      this.onQueueUpdate?.(this.queue.length);
      return true;
    }

    // Check if it's the running cell
    if (this.running && this.running.cellId === cellId) {
      this.running.cancelToken.cancelled = true;
      this.onStatusChange?.(cellId, "cancelled");
      return true;
    }

    return false;
  }

  cancelAll(): void {
    // Cancel all queued entries
    for (const entry of this.queue) {
      entry.cancelToken.cancelled = true;
      entry.resolve();
      this.onStatusChange?.(entry.cellId, "cancelled");
    }
    this.queue = [];

    // Cancel running entry
    if (this.running) {
      this.running.cancelToken.cancelled = true;
      this.onStatusChange?.(this.running.cellId, "cancelled");
    }

    this.onQueueUpdate?.(0);
  }
}
