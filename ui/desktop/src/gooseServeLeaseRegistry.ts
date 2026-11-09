import { brandText } from './branding';
import type { GooseServeExitSignal, GooseServeResult, Logger } from './gooseServe';

export const GOOSE_SERVE_EXITED_USER_MESSAGE = brandText('desktop.gooseServeLeaseRegistry.text4');

export interface GooseServeLease {
  acpUrl: string;
  secretKey: string;
  cleanup: () => Promise<void>;
  windowIds: Set<number>;
  cleanedUp: boolean;
  exited: boolean;
  exitCode: number | null;
  exitSignal: GooseServeExitSignal;
}

export class GooseServeLeaseRegistry {
  private leasesByWindowId = new Map<number, GooseServeLease>();
  private leaseSessions = new WeakMap<GooseServeLease, AbortSignal>();
  private pendingLeases = new Map<number, Promise<void>>();

  constructor(private readonly logger: Logger) {}

  create(result: GooseServeResult, secretKey: string): GooseServeLease {
    const lease: GooseServeLease = {
      acpUrl: result.acpUrl,
      secretKey,
      cleanup: result.cleanup,
      windowIds: new Set<number>(),
      cleanedUp: false,
      exited: false,
      exitCode: null,
      exitSignal: null,
    };

    const markExited = ({
      code,
      signal,
      logUnexpected,
    }: {
      code?: number | null;
      signal?: GooseServeExitSignal;
      logUnexpected: boolean;
    }) => {
      const firstExit = !lease.exited;
      lease.exited = true;
      if (code !== undefined) {
        lease.exitCode = code;
      }
      if (signal !== undefined) {
        lease.exitSignal = signal;
      }

      if (logUnexpected && firstExit && !lease.cleanedUp) {
        this.logger.error(brandText('desktop.gooseServeLeaseRegistry.text5'), {
          code: lease.exitCode,
          signal: lease.exitSignal,
          windowIds: [...lease.windowIds],
        });
      }
    };

    result.process.once('exit', (code, signal) => {
      markExited({ code, signal, logUnexpected: true });
    });

    if (result.hasExited()) {
      const exitDetails = result.getExitDetails();
      markExited({ code: exitDetails.code, signal: exitDetails.signal, logUnexpected: false });
    }

    return lease;
  }

  createExternal(
    acpUrl: string,
    secretKey: string,
    cleanup: () => Promise<void> = async () => undefined
  ): GooseServeLease {
    return {
      acpUrl,
      secretKey,
      cleanup,
      windowIds: new Set<number>(),
      cleanedUp: false,
      exited: false,
      exitCode: null,
      exitSignal: null,
    };
  }

  get(windowId: number): GooseServeLease | null {
    return this.leasesByWindowId.get(windowId) ?? null;
  }

  getForSession(windowId: number, session: AbortSignal | null): GooseServeLease | null {
    const lease = this.get(windowId);
    return lease && session && !session.aborted && this.leaseSessions.get(lease) === session
      ? lease
      : null;
  }

  async ensureForSession(
    windowId: number,
    session: AbortSignal,
    windowClosed: AbortSignal,
    start: () => Promise<GooseServeLease>
  ): Promise<void> {
    if (session.aborted || windowClosed.aborted || this.getForSession(windowId, session)) return;
    const pending = this.pendingLeases.get(windowId);
    if (pending) return pending;

    const starting = (async () => {
      const lease = await start();
      if (session.aborted || windowClosed.aborted) {
        await this.cleanupLease(lease);
        return;
      }
      this.leaseSessions.set(lease, session);
      this.attachWindow(windowId, lease);
    })();
    this.pendingLeases.set(windowId, starting);
    try {
      await starting;
    } finally {
      this.pendingLeases.delete(windowId);
    }
  }

  getAcpUrl(windowId: number): string | null {
    const lease = this.get(windowId);
    if (!lease) {
      return null;
    }
    if (lease.exited) {
      throw new Error(GOOSE_SERVE_EXITED_USER_MESSAGE);
    }
    return lease.acpUrl;
  }

  getSecretKey(windowId: number): string | null {
    const lease = this.get(windowId);
    if (!lease) {
      return null;
    }
    if (lease.exited) {
      throw new Error(GOOSE_SERVE_EXITED_USER_MESSAGE);
    }
    return lease.secretKey;
  }

  attachWindow(windowId: number, lease: GooseServeLease) {
    lease.windowIds.add(windowId);
    this.leasesByWindowId.set(windowId, lease);
  }

  async releaseWindow(windowId: number) {
    const lease = this.leasesByWindowId.get(windowId);
    this.leasesByWindowId.delete(windowId);

    if (!lease) {
      return;
    }

    lease.windowIds.delete(windowId);
    if (lease.windowIds.size === 0) {
      await this.cleanupLease(lease);
    }
  }

  async cleanupLease(lease: GooseServeLease) {
    if (lease.cleanedUp) {
      return;
    }

    lease.cleanedUp = true;
    for (const windowId of lease.windowIds) {
      this.leasesByWindowId.delete(windowId);
    }
    lease.windowIds.clear();

    try {
      await lease.cleanup();
    } catch (error) {
      this.logger.error('Failed to cleanup goose serve backend:', error);
    }
  }

  activeLeaseCount(): number {
    return this.uniqueLeases().length;
  }

  async cleanupAll() {
    await Promise.all(this.uniqueLeases().map((lease) => this.cleanupLease(lease)));
  }

  private uniqueLeases(): GooseServeLease[] {
    return [...new Set(this.leasesByWindowId.values())];
  }
}
