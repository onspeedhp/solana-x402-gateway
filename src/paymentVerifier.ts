import { address } from '@solana/kit';

// Type for the RPC client from @solana/kit
type SolanaRpcApi = any;

export interface PaymentVerificationOptions {
  reference: string;
  mint: string;
  recipient: string;
  amount: number;
}

/**
 * Payment verifier class for checking Solana USDC payments
 */
export class PaymentVerifier {
  constructor(private rpc: SolanaRpcApi) {}

  /**
   * Verify a payment by checking if a transaction exists that transfers
   * the required amount of tokens (mint) to the recipient, using the
   * reference account as a unique identifier.
   */
  async verifyPayment(opts: PaymentVerificationOptions): Promise<boolean> {
    return verifyPaymentByReference(this.rpc, opts);
  }
}

/**
 * Verify a payment by checking if a transaction exists that transfers
 * the required amount of tokens (mint) to the recipient, using the
 * reference account as a unique identifier.
 */
export async function verifyPaymentByReference(
  rpc: SolanaRpcApi,
  opts: PaymentVerificationOptions
): Promise<boolean> {
  try {
    // Step 1: Get signatures for the reference account
    const sigsResponse = rpc.getSignaturesForAddress(address(opts.reference), {
      limit: 5,
    });
    const sigs = await (sigsResponse as any).send();

    if (!sigs || sigs.length === 0) {
      return false;
    }

    // Step 2: Check the most recent signature first
    for (const sig of sigs) {
      const txResponse = rpc.getTransaction(sig.signature as string, {
        encoding: 'jsonParsed',
        maxSupportedTransactionVersion: 0,
      });
      const tx = await (txResponse as any).send();

      if (!tx || !tx.meta) {
        continue;
      }

      // Step 3: Check if transaction was successful
      if (tx.meta.err) {
        continue;
      }

      // Step 4: Look for the token transfer in postTokenBalances
      // We need to find a transfer where:
      // - mint matches our configured mint
      // - owner matches the merchant wallet
      // - amount >= required amount

      const postBalances = tx.meta.postTokenBalances || [];
      const preBalances = tx.meta.preTokenBalances || [];

      // Build a map of owner -> token balance changes
      const balanceChanges = new Map<string, number>();

      // Initialize from preBalances
      for (const bal of preBalances) {
        if (bal.mint === opts.mint && bal.owner) {
          const key = `${bal.owner}-${bal.mint}`;
          const amount = parseFloat(bal.uiTokenAmount?.uiAmountString || '0');
          balanceChanges.set(key, -amount);
        }
      }

      // Add postBalances
      for (const bal of postBalances) {
        if (bal.mint === opts.mint && bal.owner) {
          const key = `${bal.owner}-${bal.mint}`;
          const current = balanceChanges.get(key) || 0;
          const amount = parseFloat(bal.uiTokenAmount?.uiAmountString || '0');
          balanceChanges.set(key, current + amount);
        }
      }

      // Check if merchant received the required amount
      const merchantKey = `${opts.recipient}-${opts.mint}`;
      const merchantReceived = balanceChanges.get(merchantKey) || 0;

      if (merchantReceived >= opts.amount) {
        // Also verify the reference account is involved in the transaction
        // by checking account keys
        const accountKeys = tx.transaction?.message?.accountKeys || [];
        const referenceInvolved = accountKeys.some(
          (key: any) => key.pubkey === opts.reference
        );

        if (referenceInvolved) {
          return true;
        }
      }

      // Also check inner instructions for token transfers
      const innerInstructions = tx.meta.innerInstructions || [];
      for (const inner of innerInstructions) {
        for (const ix of inner.instructions) {
          // Type guard: check if instruction is parsed (not partially decoded)
          if ('parsed' in ix && ix.parsed) {
            const parsed = ix.parsed as any; // Type assertion for parsed instruction
            if (
              parsed.type === 'transfer' &&
              parsed.info?.mint === opts.mint &&
              parsed.info?.destination === opts.recipient
            ) {
              const transferAmount = parseFloat(
                parsed.info?.tokenAmount?.uiAmountString || '0'
              );
              if (transferAmount >= opts.amount) {
                // Check if reference is in the transaction
                const accountKeys = tx.transaction?.message?.accountKeys || [];
                const referenceInvolved = accountKeys.some(
                  (key: any) => key.pubkey === opts.reference
                );
                if (referenceInvolved) {
                  return true;
                }
              }
            }
          }
        }
      }
    }

    return false;
  } catch (error) {
    console.error('Payment verification error:', error);
    return false;
  }
}
