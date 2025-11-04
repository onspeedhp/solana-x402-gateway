/**
 * x402 Resource Server Middleware
 * Simple middleware to onboard x402 payment protocol
 *
 * Usage:
 * ```ts
 * import { x402ResourceServer } from 'solana-x402-gateway';
 *
 * app.use('/api/protected', x402ResourceServer({
 *   network: 'devnet',
 *   rpcEndpoint: 'https://api.devnet.solana.com',
 *   paymentRequirements: [{
 *     scheme: 'x402',
 *     mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
 *     amount: 0.05,
 *     recipient: 'YOUR_WALLET_ADDRESS',
 *   }],
 * }));
 * ```
 */

import { Request, Response, NextFunction } from 'express';
import {
  generateKeyPair,
  getAddressFromPublicKey,
} from '@solana/kit';
import { PaymentState } from './paymentState';
import { createSolanaRpcClient } from './rpcClient';
import { parsePaymentPayload, validatePaymentPayload } from './paymentPayload';
import {
  verifySignedTransaction,
  sendSignedTransaction,
  verifyTransactionConfirmed,
} from './transactionHandler';
import { PaymentRequirement, PaymentPayload } from './types';

const X_PAYMENT_HEADER = 'x-payment';
const X_PAYMENT_RESPONSE_HEADER = 'x-payment-response';

export interface PaymentRequirementConfig {
  mint: string; // USDC mint address
  amount: number; // Amount in USDC (e.g., 0.05)
  recipient: string; // Recipient wallet address
}

export interface ResourceServerOptions {
  /** Solana network: 'devnet' | 'mainnet-beta' | 'testnet' */
  network: 'devnet' | 'mainnet-beta' | 'testnet';
  /** Solana RPC endpoint URL */
  rpcEndpoint: string;
  /** Payment requirements configuration */
  paymentRequirements: PaymentRequirementConfig[];
  /** TTL in seconds for cached payment verifications (default: 300) */
  ttlSeconds?: number;
  /** Custom logger function (optional) */
  logger?: (message: string) => void;
}

const DEFAULT_TTL_SECONDS = 300;

/**
 * x402 Resource Server middleware
 * Implements the x402 payment protocol for Express applications
 */
export function x402ResourceServer(options: ResourceServerOptions) {
  const {
    network,
    rpcEndpoint,
    paymentRequirements,
    ttlSeconds = DEFAULT_TTL_SECONDS,
    logger = console.log,
  } = options;

  // Initialize payment state and RPC client
  const paymentState = new PaymentState(ttlSeconds);
  const rpcClient = createSolanaRpcClient(network, rpcEndpoint);

  // Setup periodic cleanup
  setInterval(() => {
    const cleaned = paymentState.cleanup();
    if (cleaned > 0) {
      logger(`Cleaned up ${cleaned} expired payment references`);
    }
  }, 60000); // Every minute

  return async (req: Request, res: Response, next: NextFunction) => {
    const xPaymentHeader = req.headers[X_PAYMENT_HEADER] as string | undefined;

    // No X-PAYMENT header - return 402 Payment Required
    if (!xPaymentHeader) {
      return await sendPaymentRequiredResponse(req, res, options);
    }

    try {
      // Parse and validate payment payload
      const paymentPayload = parsePaymentPayload(xPaymentHeader);
      if (!validatePaymentPayload(paymentPayload)) {
        logger(`Invalid Payment Payload format`);
        return await sendPaymentRequiredResponse(req, res, options);
      }

      // Find matching payment requirement
      const paymentRequirement = findMatchingPaymentRequirement(
        paymentPayload,
        paymentRequirements,
        network
      );
      if (!paymentRequirement) {
        logger(`No matching payment requirement found`);
        return await sendPaymentRequiredResponse(req, res, options);
      }

      // Check cache first
      const cacheKey = paymentPayload.reference;
      if (paymentState.isPaid(cacheKey)) {
        logger(`Payment ${cacheKey} already verified (cached)`);
        const cachedSignature = paymentState.getSignature(cacheKey);
        return await handleVerifiedPayment(
          req,
          res,
          next,
          cachedSignature || 'cached'
        );
      }

      // Step 1: Verify signed transaction before sending
      logger(
        `Verifying signed transaction for reference: ${paymentPayload.reference}`
      );
      const verificationResult = await verifySignedTransaction(
        paymentPayload.transaction,
        paymentRequirement,
        rpcClient
      );
      if (!verificationResult.valid) {
        logger(`Transaction verification failed: ${verificationResult.error}`);
        return await sendPaymentRequiredResponse(req, res, options);
      }

      // Step 2: Send transaction to blockchain
      logger(
        `Sending transaction to blockchain for reference: ${paymentPayload.reference}`
      );
      const sendResult = await sendSignedTransaction(
        paymentPayload.transaction,
        rpcClient
      );
      if (!sendResult.success) {
        logger(`Transaction send failed: ${sendResult.error}`);
        return await sendPaymentRequiredResponse(req, res, options);
      }

      // Step 3: Verify transaction is confirmed on-chain
      logger(`Verifying transaction confirmation: ${sendResult.signature}`);
      const isConfirmed = await verifyTransactionConfirmed(
        sendResult.signature,
        paymentRequirement,
        rpcClient
      );
      if (!isConfirmed) {
        logger(
          `Transaction confirmation failed for signature: ${sendResult.signature}`
        );
        return await sendPaymentRequiredResponse(req, res, options);
      }

      // Payment verified and confirmed
      logger(
        `Payment verified and confirmed for reference: ${paymentPayload.reference}`
      );
      paymentState.markPaid(cacheKey, sendResult.signature);
      return await handleVerifiedPayment(req, res, next, sendResult.signature);
    } catch (error) {
      logger(`Error processing payment: ${error}`);
      return await sendPaymentRequiredResponse(req, res, options);
    }
  };
}

/**
 * Send HTTP 402 Payment Required Response
 */
async function sendPaymentRequiredResponse(
  req: Request,
  res: Response,
  options: ResourceServerOptions
): Promise<void> {
  const paymentRequirements = await Promise.all(
    options.paymentRequirements.map(async (reqConfig) => {
      // Generate unique reference for this requirement
      const keyPair = await generateKeyPair();
      const reference = await getAddressFromPublicKey(keyPair.publicKey);

      return {
        network: options.network,
        mint: reqConfig.mint,
        amount: reqConfig.amount.toString(),
        recipient: reqConfig.recipient,
        reference,
        expires_in: options.ttlSeconds || DEFAULT_TTL_SECONDS,
      };
    })
  );

  res.status(402).json({
    paymentRequirements,
  });
}

/**
 * Handle verified payment - add X-PAYMENT-RESPONSE header and continue
 */
async function handleVerifiedPayment(
  req: Request,
  res: Response,
  next: NextFunction,
  transactionSignature: string
): Promise<void> {
  // Add X-PAYMENT-RESPONSE header with settlement response
  const responsePayload = {
    success: true,
    transaction: transactionSignature,
  };
  res.setHeader(
    X_PAYMENT_RESPONSE_HEADER,
    Buffer.from(JSON.stringify(responsePayload), 'utf-8').toString('base64')
  );

  // Continue to route handler
  next();
}

/**
 * Find matching payment requirement based on payment payload
 * Returns the first requirement if network matches
 */
function findMatchingPaymentRequirement(
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirementConfig[],
  network: string
): PaymentRequirement | null {
  if (
    paymentRequirements.length === 0 ||
    paymentPayload.network !== network
  ) {
    return null;
  }

  const config = paymentRequirements[0];
  return {
    network,
    mint: config.mint,
    amount: config.amount.toString(),
    recipient: config.recipient,
    reference: paymentPayload.reference,
    expires_in: DEFAULT_TTL_SECONDS,
  };
}
