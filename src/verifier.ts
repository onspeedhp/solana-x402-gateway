/**
 * Payment verifier - local on-chain verification
 */

import { address } from '@solana/kit';
import {
  PaymentPayload,
  PaymentRequirement,
  VerificationResponse,
} from './types';

// Type for the RPC client from @solana/kit
type SolanaRpcApi = any;

export interface LocalVerificationOptions {
  paymentPayload: PaymentPayload;
  paymentRequirement: PaymentRequirement;
  rpc: SolanaRpcApi;
}

/**
 * Verify payment by reference - checks on-chain transaction
 */
interface VerifyPaymentByReferenceOptions {
  reference: string;
  mint: string;
  recipient: string;
  amount: number;
}

async function verifyPaymentByReference(
  rpc: SolanaRpcApi,
  opts: VerifyPaymentByReferenceOptions
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
        // Verify the reference account is involved in the transaction
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
          if ('parsed' in ix && ix.parsed) {
            const parsed = ix.parsed as any;
            if (
              parsed.type === 'transfer' &&
              parsed.info?.mint === opts.mint &&
              parsed.info?.destination === opts.recipient
            ) {
              const transferAmount = parseFloat(
                parsed.info?.tokenAmount?.uiAmountString || '0'
              );
              if (transferAmount >= opts.amount) {
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

/**
 * Verify payment locally (direct on-chain verification)
 */
export async function verifyPaymentLocally(
  options: LocalVerificationOptions
): Promise<VerificationResponse> {
  const { paymentPayload, paymentRequirement, rpc } = options;

  // Verify network match
  if (paymentPayload.network !== paymentRequirement.network) {
    return {
      valid: false,
      error: 'Network mismatch',
    };
  }

  // Verify reference matches
  if (paymentPayload.reference !== paymentRequirement.reference) {
    return {
      valid: false,
      error: 'Reference mismatch',
    };
  }

  // Verify payment on-chain
  try {
    const isValid = await verifyPaymentByReference(rpc, {
      reference: paymentPayload.reference,
      mint: paymentRequirement.mint,
      recipient: paymentRequirement.recipient,
      amount: parseFloat(paymentRequirement.amount),
    });

    if (!isValid) {
      return {
        valid: false,
        error: 'Payment not found or invalid on-chain',
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: `Verification error: ${error}`,
    };
  }
}
