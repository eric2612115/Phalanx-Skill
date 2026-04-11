/**
 * On-chain / protocol allowlist. Honest boundary: application-layer only.
 */
export class WhitelistPolicy {
  private readonly allowedTargets: Set<string>;

  constructor(allowedTargets: ReadonlySet<string>) {
    this.allowedTargets = new Set(allowedTargets);
  }

  isAllowedTarget(target: string | undefined): boolean {
    if (target === undefined || target.length === 0) {
      return true;
    }
    return this.allowedTargets.has(target);
  }

  addTarget(target: string): void {
    const trimmed = target.trim();
    if (trimmed.length > 0) {
      this.allowedTargets.add(trimmed);
    }
  }

  addTargets(targets: readonly string[]): void {
    for (const target of targets) {
      this.addTarget(target);
    }
  }

  snapshot(): readonly string[] {
    return [...this.allowedTargets].sort((a, b) => a.localeCompare(b));
  }
}
