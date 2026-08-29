export class SendQuota {
  private readonly counts = new Map<string, { day: string; count: number }>();

  constructor(private readonly dailyCap: number) {}

  consume(actor: string): void {
    if (this.dailyCap <= 0) return;
    const day = new Date().toISOString().slice(0, 10);
    const current = this.counts.get(actor);
    const count = current?.day === day ? current.count : 0;
    if (count >= this.dailyCap) {
      const error = new Error(`Daily send cap of ${this.dailyCap} messages reached.`);
      (error as Error & { code: string }).code = "sendQuotaExceeded";
      throw error;
    }
    this.counts.set(actor, { day, count: count + 1 });
  }
}

export class RateLimiter {
  private readonly hits: number[] = [];

  constructor(private readonly perMinute: number) {}

  consume(): void {
    const now = Date.now();
    while (this.hits.length && now - this.hits[0] > 60_000) this.hits.shift();
    if (this.hits.length >= this.perMinute) {
      const error = new Error("Too many tool calls. Wait a moment and retry.");
      (error as Error & { code: string }).code = "rateLimited";
      throw error;
    }
    this.hits.push(now);
  }
}
