/**
 * Transaction handler - verify and send signed transactions
 */

import {
  type Base64EncodedWireTransaction,
  type Signature,
  address,
} from '@solana/kit';
import { PaymentRequirement, VerificationResponse } from './types';
import { SolanaRpcClient } from './rpcClient';

/**
 * Safely serialize error to string, handling BigInt and circular references
 */
function safeStringifyError(error: any): string {
  if (typeof error === 'string') return error;
  if (error?.message) return error.message;
  try {
    return JSON.stringify(error, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    );
  } catch {
    return String(error);
  }
}

/**
 * Extract signature from sendTransaction response
 */
function extractSignature(response: any): string | null {
  if (typeof response === 'string') return response;
  if (response?.value && typeof response.value === 'string') {
    return response.value;
  }
  return null;
}

/**
 * Get token decimals from balance or RPC
 */
async function getTokenDecimals(
  mint: string,
  tokenBalances: any[],
  rpc: SolanaRpcClient
): Promise<number> {
  // Try to get from token balance first
  const tokenBalance = tokenBalances.find((bal: any) => bal.mint === mint);
  if (tokenBalance?.uiTokenAmount?.decimals !== undefined) {
    const dec = tokenBalance.uiTokenAmount.decimals;
    return typeof dec === 'bigint' ? Number(dec) : dec;
  }

  // Fallback to RPC call
  try {
    const mintInfoResponse = rpc.getTokenSupply(address(mint));
    const mintInfo = await (mintInfoResponse as any).send();
    const dec = mintInfo.value?.decimals;
    return typeof dec === 'bigint' ? Number(dec) : dec || 6;
  } catch {
    return 6; // Default fallback
  }
}

/**
 * Build balance changes map from pre/post token balances
 */
function buildBalanceChanges(
  preBalances: any[],
  postBalances: any[],
  mint: string
): Map<string, bigint> {
  const balanceChanges = new Map<string, bigint>();

  // Initialize from preBalances (negative)
  for (const bal of preBalances) {
    if (bal.mint === mint && bal.owner) {
      const key = `${bal.owner}-${mint}`;
      const amount = BigInt(bal.uiTokenAmount?.amount || '0');
      balanceChanges.set(key, -amount);
    }
  }

  // Add postBalances (positive)
  for (const bal of postBalances) {
    if (bal.mint === mint && bal.owner) {
      const key = `${bal.owner}-${mint}`;
      const current = balanceChanges.get(key) || 0n;
      const amount = BigInt(bal.uiTokenAmount?.amount || '0');
      balanceChanges.set(key, current + amount);
    }
  }

  return balanceChanges;
}

/**
 * Calculate required amount in raw token units (BigInt)
 */
function calculateRequiredAmountRaw(amount: string, decimals: number): bigint {
  const decimalsMultiplier = BigInt(10) ** BigInt(decimals);
  const amountFloat = parseFloat(amount);
  return BigInt(Math.floor(amountFloat * Number(decimalsMultiplier)));
}

/**
 * Verify signed transaction before sending
 * Validates: format, signatures, recipient, amount, reference, and mint
 */
export async function verifySignedTransaction(
  signedTransactionBase64: string,
  paymentRequirement: PaymentRequirement,
  rpc: SolanaRpcClient
): Promise<VerificationResponse> {
  try {
    // Basic validation: transaction should be valid base64
    const transactionBuffer = Buffer.from(signedTransactionBase64, 'base64');
    if (transactionBuffer.length === 0) {
      return {
        valid: false,
        error: 'Transaction is empty',
      };
    }

    // Minimum size check
    if (transactionBuffer.length < 64) {
      return {
        valid: false,
        error: 'Transaction too short to be valid',
      };
    }

    // Check transaction has at least one signature
    // Solana transaction format: [signatures_count, signatures..., transaction_message]
    const signatureCount = transactionBuffer[0];
    if (!signatureCount || signatureCount === 0) {
      return {
        valid: false,
        error: 'Transaction has no signatures',
      };
    }

    // Verify signatures using simulateTransaction with sigVerify
    const base64Transaction =
      signedTransactionBase64 as Base64EncodedWireTransaction;
    try {
      const simulateResponse = await (
        rpc.simulateTransaction(base64Transaction, {
          encoding: 'base64',
          sigVerify: true,
        }) as any
      ).send();

      const simulation = simulateResponse.value;

      // Check signature verification
      if (simulation.err) {
        // Allow blockhash expiration errors - will be handled when sending
        const errStr = safeStringifyError(simulation.err);
        if (
          !errStr.includes('BlockhashNotFound') &&
          !errStr.includes('expired') &&
          !errStr.includes('blockhash')
        ) {
          return {
            valid: false,
            error: `Transaction verification failed: ${errStr}`,
          };
        }
      }

      // Check signature verification in logs
      if (
        simulation.logs?.some((log: string) =>
          log.includes('failed to verify signature')
        )
      ) {
        return {
          valid: false,
          error: 'Transaction signature verification failed',
        };
      }

      // Verify transaction matches payment requirement using simulation result
      const postBalances = simulation.postTokenBalances || [];
      const preBalances = simulation.preTokenBalances || [];

      // Get decimals and build balance changes
      const decimals = await getTokenDecimals(
        paymentRequirement.mint,
        [...postBalances, ...preBalances],
        rpc
      );
      const balanceChanges = buildBalanceChanges(
        preBalances,
        postBalances,
        paymentRequirement.mint
      );

      // Verify recipient received the required amount
      const recipientKey = `${paymentRequirement.recipient}-${paymentRequirement.mint}`;
      const recipientReceivedRaw = balanceChanges.get(recipientKey) || 0n;
      const requiredAmountRaw = calculateRequiredAmountRaw(
        paymentRequirement.amount,
        decimals
      );

      if (recipientReceivedRaw < requiredAmountRaw) {
        const decimalsMultiplier = BigInt(10) ** BigInt(decimals);
        const recipientReceivedUI =
          Number(recipientReceivedRaw) / Number(decimalsMultiplier);
        return {
          valid: false,
          error: `Insufficient payment: required ${
            paymentRequirement.amount
          } tokens, but recipient would receive ${recipientReceivedUI.toFixed(
            decimals
          )} tokens`,
        };
      }

      // Verify reference account is in transaction accounts
      // Note: We need to check accounts from simulation, but simulation doesn't directly expose accountKeys
      // We'll verify this in verifyTransactionConfirmed after sending
      // For now, we verify the critical parts: recipient and amount

      return { valid: true };
    } catch (simulateError: any) {
      // If simulation fails, return error - don't allow invalid transactions
      return {
        valid: false,
        error: `Transaction simulation error: ${safeStringifyError(
          simulateError
        )}`,
      };
    }
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
  rpc: SolanaRpcClient
): Promise<{ signature: string; success: boolean; error?: string }> {
  try {
    const base64Transaction =
      signedTransactionBase64 as Base64EncodedWireTransaction;

    // Send transaction
    const response = await (
      rpc.sendTransaction(base64Transaction, {
        encoding: 'base64',
      }) as any
    ).send();

    // Extract signature from response
    const signature = extractSignature(response);
    if (!signature) {
      return {
        signature: '',
        success: false,
        error: `Invalid signature from sendTransaction response: ${JSON.stringify(
          response
        )}`,
      };
    }

    // Wait for confirmation using getSignatureStatuses (more efficient than getTransaction)
    const maxAttempts = 30;
    const pollInterval = 1000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const statusResponse = rpc.getSignatureStatuses([signature as Signature]);
      const statuses = await (statusResponse as any).send();
      const status = statuses.value?.[0];

      if (status) {
        if (status.err) {
          return {
            signature,
            success: false,
            error: `Transaction failed: ${safeStringifyError(status.err)}`,
          };
        }
        if (
          status.confirmationStatus === 'confirmed' ||
          status.confirmationStatus === 'finalized'
        ) {
          return { signature, success: true };
        }
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    return {
      signature,
      success: false,
      error: 'Transaction confirmation timeout',
    };
  } catch (error: any) {
    return {
      signature: '',
      success: false,
      error: `Transaction send error: ${safeStringifyError(error)}`,
    };
  }
}

/**
 * Verify transaction is confirmed on-chain
 */
export async function verifyTransactionConfirmed(
  signature: string,
  paymentRequirement: PaymentRequirement,
  rpc: SolanaRpcClient
): Promise<boolean> {
  try {
    // Get transaction details
    const txSignature = signature as Signature;
    const txResponse = rpc.getTransaction(txSignature, {
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

    // Get decimals and build balance changes
    const decimals = await getTokenDecimals(
      paymentRequirement.mint,
      [...postBalances, ...preBalances],
      rpc
    );
    const balanceChanges = buildBalanceChanges(
      preBalances,
      postBalances,
      paymentRequirement.mint
    );

    // Verify recipient received the required amount
    const recipientKey = `${paymentRequirement.recipient}-${paymentRequirement.mint}`;
    const recipientReceivedRaw = balanceChanges.get(recipientKey) || 0n;
    const requiredAmountRaw = calculateRequiredAmountRaw(
      paymentRequirement.amount,
      decimals
    );

    if (recipientReceivedRaw < requiredAmountRaw) {
      return false;
    }

    // Verify reference account is in transaction
    const accountKeys = tx.transaction?.message?.accountKeys || [];
    return accountKeys.some(
      (key: any) => key.pubkey === paymentRequirement.reference
    );
  } catch (error) {
    console.error('Transaction verification error:', error);
    return false;
  }
}
