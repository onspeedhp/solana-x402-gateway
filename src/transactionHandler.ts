/**
 * Transaction handler - verify and send signed transactions
 */

import { address } from '@solana/kit';
import {
  PaymentPayload,
  PaymentRequirement,
  VerificationResponse,
} from './types';

// Type for the RPC client from @solana/kit
type SolanaRpcApi = any;

/**
 * Verify signed transaction before sending
 * Checks that transaction is properly signed and matches payment requirement
 */
export async function verifySignedTransaction(
  signedTransactionBase64: string,
  paymentRequirement: PaymentRequirement,
  rpc: SolanaRpcApi
): Promise<VerificationResponse> {
  try {
    // Deserialize transaction
    const transactionBuffer = Buffer.from(signedTransactionBase64, 'base64');
    const transaction = transactionBuffer; // Will need to parse this properly

    // TODO: Parse transaction and verify:
    // - Transaction is properly signed
    // - Reference account is in transaction
    // - Amount and recipient match payment requirement
    // - Transaction hasn't been sent yet (check recent blockhash)

    // For now, return valid - will implement full verification
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: `Transaction verification error: ${error}`,
    };
  }
}

/**
 * Send signed transaction to blockchain and wait for confirmation
 */
export async function sendSignedTransaction(
  signedTransactionBase64: string,
  rpc: SolanaRpcApi
): Promise<{ signature: string; success: boolean; error?: string }> {
  try {
    // Deserialize transaction
    const transactionBuffer = Buffer.from(signedTransactionBase64, 'base64');

    // Send transaction
    const response = await rpc.sendTransaction(transactionBuffer).send();
    const signature = response.value;

    // Wait for confirmation
    // TODO: Implement proper confirmation waiting
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds

    return { signature, success: true };
  } catch (error) {
    return {
      signature: '',
      success: false,
      error: `Transaction send error: ${error}`,
    };
  }
}

/**
 * Verify transaction is confirmed on-chain
 */
export async function verifyTransactionConfirmed(
  signature: string,
  paymentRequirement: PaymentRequirement,
  rpc: SolanaRpcApi
): Promise<boolean> {
  try {
    // Get transaction details
    const txResponse = rpc.getTransaction(signature, {
      encoding: 'jsonParsed',
      maxSupportedTransactionVersion: 0,
    });
    const tx = await (txResponse as any).send();

    if (!tx || !tx.meta) {
      return false;
    }

    // Check if transaction was successful
    if (tx.meta.err) {
      return false;
    }

    // Verify payment details
    const postBalances = tx.meta.postTokenBalances || [];
    const preBalances = tx.meta.preTokenBalances || [];

    // Build balance changes map
    const balanceChanges = new Map<string, number>();

    for (const bal of preBalances) {
      if (bal.mint === paymentRequirement.mint && bal.owner) {
        const key = `${bal.owner}-${bal.mint}`;
        const amount = parseFloat(bal.uiTokenAmount?.uiAmountString || '0');
        balanceChanges.set(key, -amount);
      }
    }

    for (const bal of postBalances) {
      if (bal.mint === paymentRequirement.mint && bal.owner) {
        const key = `${bal.owner}-${bal.mint}`;
        const current = balanceChanges.get(key) || 0;
        const amount = parseFloat(bal.uiTokenAmount?.uiAmountString || '0');
        balanceChanges.set(key, current + amount);
      }
    }

    // Check if merchant received the required amount
    const merchantKey = `${paymentRequirement.recipient}-${paymentRequirement.mint}`;
    const merchantReceived = balanceChanges.get(merchantKey) || 0;

    if (merchantReceived >= parseFloat(paymentRequirement.amount)) {
      // Verify reference account is in transaction
      const accountKeys = tx.transaction?.message?.accountKeys || [];
      const referenceInvolved = accountKeys.some(
        (key: any) => key.pubkey === paymentRequirement.reference
      );

      return referenceInvolved;
    }

    return false;
  } catch (error) {
    console.error('Transaction verification error:', error);
    return false;
  }
}
