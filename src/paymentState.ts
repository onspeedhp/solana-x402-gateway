/**
 * In-memory store for verified payment references with TTL.
 * Key: reference (base58 public key string)
 * Value: expiry timestamp (milliseconds since epoch)
 */
export class PaymentState {
  private store: Map<string, number>;
  private ttlMs: number;

  constructor(ttlSeconds: number) {
    this.store = new Map();
    this.ttlMs = ttlSeconds * 1000;
  }

  /**
   * Check if a reference is paid and not expired
   */
  isPaid(reference: string): boolean {
    const expiry = this.store.get(reference);
    if (!expiry) {
      return false;
    }

    if (Date.now() > expiry) {
      // Expired, remove it
      this.store.delete(reference);
      return false;
    }

    return true;
  }

  /**
   * Mark a reference as paid
   */
  markPaid(reference: string): void {
    const expiry = Date.now() + this.ttlMs;
    this.store.set(reference, expiry);
  }

  /**
   * Remove a reference (manual cleanup)
   */
  remove(reference: string): void {
    this.store.delete(reference);
  }

  /**
   * Clean up expired entries (call periodically)
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [ref, expiry] of this.store.entries()) {
      if (now > expiry) {
        this.store.delete(ref);
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * Get current size (for debugging)
   */
  size(): number {
    return this.store.size;
  }
}
