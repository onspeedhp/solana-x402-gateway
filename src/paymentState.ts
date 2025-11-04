/**
 * In-memory store for verified payment references with TTL.
 * Key: reference (base58 public key string)
 * Value: { expiry: number, signature: string }
 */
export class PaymentState {
  private store: Map<string, { expiry: number; signature: string }>;
  private ttlMs: number;

  constructor(ttlSeconds: number) {
    this.store = new Map();
    this.ttlMs = ttlSeconds * 1000;
  }

  /**
   * Check if a reference is paid and not expired
   */
  isPaid(reference: string): boolean {
    const entry = this.store.get(reference);
    if (!entry) {
      return false;
    }

    if (Date.now() > entry.expiry) {
      // Expired, remove it
      this.store.delete(reference);
      return false;
    }

    return true;
  }

  /**
   * Get signature for a paid reference
   */
  getSignature(reference: string): string | null {
    const entry = this.store.get(reference);
    return entry?.signature || null;
  }

  /**
   * Mark a reference as paid with transaction signature
   */
  markPaid(reference: string, signature: string): void {
    const expiry = Date.now() + this.ttlMs;
    this.store.set(reference, { expiry, signature });
  }

  /**
   * Clean up expired entries (call periodically)
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [ref, entry] of this.store.entries()) {
      if (now > entry.expiry) {
        this.store.delete(ref);
        cleaned++;
      }
    }
    return cleaned;
  }
}
