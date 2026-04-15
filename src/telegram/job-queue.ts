export type TelegramJobStatus = "queued" | "editing";

export interface TelegramJob {
  readonly id: string;
  readonly summary: string;
  readonly status: TelegramJobStatus;
}

export interface TelegramJobQueueSnapshot {
  readonly jobs: readonly TelegramJob[];
}

export interface TelegramJobCallbackAction {
  readonly action: "cancel" | "edit";
  readonly jobId: string;
}

export class TelegramJobQueue {
  private jobs: TelegramJob[] = [];
  private counter = 0;

  enqueue(summary: string): TelegramJob {
    const job: TelegramJob = {
      id: `j${++this.counter}`,
      summary: summary.trim(),
      status: "queued",
    };
    this.jobs.push(job);
    return job;
  }

  list(): TelegramJobQueueSnapshot {
    return { jobs: [...this.jobs] };
  }

  hydrate(snapshot: readonly TelegramJob[]): void {
    this.jobs = snapshot.map((job) => ({ ...job }));
    const counters = this.jobs
      .map((job) => Number(job.id.replace(/^j/, "")))
      .filter((value) => Number.isFinite(value));
    this.counter = counters.length > 0 ? Math.max(...counters) : 0;
  }

  cancel(jobId: string): TelegramJob | undefined {
    const index = this.jobs.findIndex((job) => job.id === jobId);
    if (index === -1) {
      return undefined;
    }
    const [removed] = this.jobs.splice(index, 1);
    return removed;
  }

  beginEdit(jobId: string): TelegramJob | undefined {
    const job = this.jobs.find((item) => item.id === jobId);
    if (!job) {
      return undefined;
    }
    this.jobs = this.jobs.map((item) => (item.id === jobId ? { ...item, status: "editing" } : item));
    return this.jobs.find((item) => item.id === jobId);
  }

  applyEdit(summary: string): TelegramJob | undefined {
    const editing = this.jobs.find((job) => job.status === "editing");
    if (!editing) {
      return undefined;
    }
    const next = { ...editing, summary: summary.trim(), status: "queued" as const };
    this.jobs = this.jobs.map((job) => (job.id === editing.id ? next : job));
    return next;
  }

  activeEditingJob(): TelegramJob | undefined {
    return this.jobs.find((job) => job.status === "editing");
  }
}

export function buildTelegramJobCallbackData(
  action: TelegramJobCallbackAction["action"],
  jobId: string,
): string {
  return `phx_job:${action}:${jobId}`;
}

export function parseTelegramJobCallbackData(input: string): TelegramJobCallbackAction | null {
  const parts = input.split(":");
  if (parts.length !== 3 || parts[0] !== "phx_job") {
    return null;
  }
  if ((parts[1] !== "cancel" && parts[1] !== "edit") || !parts[2]) {
    return null;
  }
  return {
    action: parts[1],
    jobId: parts[2],
  };
}
