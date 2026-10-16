import { fork, type ChildProcess, type Serializable } from "node:child_process";
import path from "node:path";
import { PptxExportError } from "./export-types.ts";

export interface WorkerPoolOptions {
  workerPath?: string;
  concurrency?: number;
  maxQueue?: number;
  timeoutMs?: number;
  queueTimeoutMs?: number;
  heapMb?: number;
}
interface Job {
  payload: unknown;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort: () => void;
  timer?: ReturnType<typeof setTimeout>;
  child?: ChildProcess;
  done: boolean;
}
const failure = (code: string, status: number) => new PptxExportError({
  EXPORT_BUSY: "导出任务较多，请稍后重试",
  EXPORT_TIMEOUT: "导出处理超时，请减少页面或简化复杂内容后重试",
  EXPORT_CANCELLED: "导出已取消",
  EXPORT_FAILED: "PPTX 导出进程异常退出，请重试或选择高保真 PPTX",
}[code] ?? "PPTX 导出失败", code, status);

/** A process is used instead of a thread so a native renderer can be killed too.
 * All instances used by the app share one pool across Next development reloads.
 * The heap limit bounds V8; input/pixel/work budgets separately bound native work.
 */
export class ExportWorkerPool {
  private readonly options: Required<WorkerPoolOptions>;
  private readonly queue: Job[] = [];
  private readonly active = new Set<Job>();
  private closed = false;
  constructor(options: WorkerPoolOptions = {}) {
    this.options = {
      workerPath: options.workerPath ?? path.join(process.cwd(), "scripts", "pptx-export-worker.ts"),
      concurrency: Math.max(1, Math.min(2, options.concurrency ?? 1)),
      maxQueue: Math.max(0, Math.min(16, options.maxQueue ?? 4)),
      timeoutMs: Math.max(10, options.timeoutMs ?? 45_000),
      queueTimeoutMs: Math.max(10, options.queueTimeoutMs ?? 90_000),
      heapMb: Math.max(64, Math.min(512, options.heapMb ?? 384)),
    };
  }
  get state() { return { active: this.active.size, queued: this.queue.length }; }
  run<T>(payload: unknown, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(failure("EXPORT_CANCELLED", 499));
    if (this.closed) return Promise.reject(failure("EXPORT_FAILED", 500));
    if (this.active.size >= this.options.concurrency && this.queue.length >= this.options.maxQueue) {
      return Promise.reject(failure("EXPORT_BUSY", 429));
    }
    return new Promise<T>((resolve, reject) => {
      const job: Job = {
        payload, resolve: value => resolve(value as T), reject, signal, done: false,
        abort: () => this.finish(job, failure("EXPORT_CANCELLED", 499)),
      };
      signal?.addEventListener("abort", job.abort, { once: true });
      if (this.active.size < this.options.concurrency) this.start(job);
      else {
        this.queue.push(job);
        job.timer = setTimeout(() => this.finish(job, failure("EXPORT_TIMEOUT", 504)), this.options.queueTimeoutMs);
      }
    });
  }
  close() {
    this.closed = true;
    for (const job of [...this.queue, ...this.active]) this.finish(job, failure("EXPORT_CANCELLED", 499));
  }
  private start(job: Job) {
    if (job.done) return;
    clearTimeout(job.timer);
    this.active.add(job);
    // Explicit args avoid inheriting test-runner/debugger flags or unsafe NODE_OPTIONS.
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    try {
      const child = fork(this.options.workerPath, [], {
        execPath: process.execPath,
        execArgv: ["--experimental-strip-types", `--max-old-space-size=${this.options.heapMb}`],
        serialization: "advanced", stdio: ["ignore", "ignore", "ignore", "ipc"], env,
      });
      job.child = child;
      job.timer = setTimeout(() => this.finish(job, failure("EXPORT_TIMEOUT", 504)), this.options.timeoutMs);
      child.once("error", () => this.finish(job, failure("EXPORT_FAILED", 500)));
      child.once("exit", () => this.finish(job, failure("EXPORT_FAILED", 500)));
      child.once("message", (message: unknown) => {
        if (!message || typeof message !== "object" || !("ok" in message)) {
          this.finish(job, failure("EXPORT_FAILED", 500)); return;
        }
        const response = message as { ok: boolean; value?: unknown; error?: { code?: string; message?: string; status?: number } };
        if (response.ok) this.finish(job, undefined, response.value);
        else {
          const error = response.error;
          const allowed = new Set(["INVALID_MODE", "INVALID_SVG", "INVALID_CANVAS", "UNSAFE_SVG", "SVG_LIMIT", "RESOURCE_LIMIT", "EXPORT_FAILED"]);
          if (!error || !allowed.has(error.code ?? "")) this.finish(job, failure("EXPORT_FAILED", 500));
          else this.finish(job, new PptxExportError(error.message ?? "PPTX 导出失败", error.code, error.status));
        }
      });
      child.send(job.payload as Serializable, error => { if (error) this.finish(job, failure("EXPORT_FAILED", 500)); });
    } catch { this.finish(job, failure("EXPORT_FAILED", 500)); }
  }
  private finish(job: Job, error?: Error, value?: unknown) {
    if (job.done) return;
    job.done = true;
    clearTimeout(job.timer);
    job.signal?.removeEventListener("abort", job.abort);
    const index = this.queue.indexOf(job);
    if (index >= 0) this.queue.splice(index, 1);
    const wasActive = this.active.delete(job);
    if (job.child && !job.child.killed) job.child.kill("SIGKILL");
    if (error) job.reject(error); else job.resolve(value);
    // Do not start the next child until the previous OS process is reaped.
    const drain = () => {
      while (!this.closed && this.active.size < this.options.concurrency && this.queue.length) this.start(this.queue.shift()!);
    };
    if (wasActive && job.child?.pid && job.child.exitCode === null && job.child.signalCode === null) {
      // Reserve the slot until exit, including jobs canceled or timed out.
      this.active.add(job);
      job.child.once("exit", () => { this.active.delete(job); drain(); });
    } else drain();
  }
}

const poolKey = Symbol.for("ppt-agent.export-worker-pool.v1");
const pools = globalThis as typeof globalThis & { [poolKey]?: ExportWorkerPool };
export function getExportWorkerPool(): ExportWorkerPool {
  return pools[poolKey] ??= new ExportWorkerPool();
}
