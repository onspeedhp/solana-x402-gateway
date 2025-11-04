/**
 * Express middleware for x402 payment verification
 *
 * Usage:
 * ```ts
 * import { X402Middleware } from 'solana-x402-gateway';
 *
 * app.use('/api/protected', X402Middleware({
 *   network: 'devnet',
 *   rpcEndpoint: 'https://api.devnet.solana.com',
 *   price: { amount: 0.05, mint: '...' },
 *   merchantWallet: '...',
 *   ttlSeconds: 300
 * }));
 * ```
 */

import { Request, Response, NextFunction } from 'express';
import {
  generateKeyPair,
  getAddressFromPublicKey,
  type Address,
} from '@solana/kit';
import { PaymentState } from './paymentState';
import { PaymentVerifier } from './paymentVerifier';
import { createSolanaRpcClient } from './rpcClient';

export interface X402Options {
  /** Solana network: 'devnet' | 'mainnet-beta' | 'testnet' */
  network: 'devnet' | 'mainnet-beta' | 'testnet';
  /** Solana RPC endpoint URL */
  rpcEndpoint: string;
  /** Payment price configuration */
  price: {
    /** Amount in USDC (e.g., 0.05) */
    amount: number;
    /** USDC mint address */
    mint: string;
  };
  /** Merchant wallet address that receives payments */
  merchantWallet: string;
  /** TTL in seconds for cached payment verifications (default: 300) */
  ttlSeconds?: number;
  /** Custom header name for payment reference (default: 'X-Payment-Reference') */
  referenceHeader?: string;
  /** Custom function to generate reference address (optional) */
  generateReference?: () => Promise<Address>;
  /** Custom logger function (optional) */
  logger?: (message: string) => void;
}

const DEFAULT_REFERENCE_HEADER = 'X-Payment-Reference';
const DEFAULT_TTL_SECONDS = 300;

/**
 * Express middleware for x402 payment verification
 *
 * This middleware checks for payment before allowing requests to proceed.
 * If no payment reference is provided, it returns HTTP 402 with payment details.
 * If a reference is provided, it verifies the payment on-chain.
 */
export function X402Middleware(options: X402Options) {
  const {
    network,
    rpcEndpoint,
    price,
    merchantWallet,
    ttlSeconds = DEFAULT_TTL_SECONDS,
    referenceHeader = DEFAULT_REFERENCE_HEADER,
    generateReference,
    logger = console.log,
  } = options;

  // Initialize payment state and verifier
  const paymentState = new PaymentState(ttlSeconds);
  const rpcClient = createSolanaRpcClient(network, rpcEndpoint);
  const verifier = new PaymentVerifier(rpcClient);

  // Setup periodic cleanup
  setInterval(() => {
    const cleaned = paymentState.cleanup();
    if (cleaned > 0) {
      logger(`Cleaned up ${cleaned} expired payment references`);
    }
  }, 60000); // Every minute

  return async (req: Request, res: Response, next: NextFunction) => {
    const reference = req.headers[referenceHeader.toLowerCase()] as
      | string
      | undefined;

    // Store options in request for use in send402Response
    attachX402Options(req, options);

    // No reference provided - return 402 with payment details
    if (!reference) {
      return await send402Response(req, res, options, generateReference);
    }

    // Check if already paid (in-memory cache)
    if (paymentState.isPaid(reference)) {
      logger(`Reference ${reference} already verified (cached)`);
      return next();
    }

    // Verify payment on-chain
    logger(`Verifying payment for reference: ${reference}`);
    const isPaid = await verifier.verifyPayment({
      reference,
      mint: price.mint,
      recipient: merchantWallet,
      amount: price.amount,
    });

    if (!isPaid) {
      logger(`Payment verification failed for reference: ${reference}`);
      return await send402Response(
        req,
        res,
        options,
        generateReference,
        reference
      );
    }

    // Payment verified, mark as paid
    logger(`Payment verified for reference: ${reference}`);
    paymentState.markPaid(reference);
    next();
  };
}

/**
 * Send HTTP 402 Payment Required response
 */
async function send402Response(
  req: Request,
  res: Response,
  options: X402Options,
  generateReference?: () => Promise<Address>,
  existingReference?: string
): Promise<void> {
  // Generate a new reference address for this request
  let reference: Address;
  if (existingReference) {
    reference = existingReference as Address;
  } else if (generateReference) {
    reference = await generateReference();
  } else {
    const keyPair = await generateKeyPair();
    reference = await getAddressFromPublicKey(keyPair.publicKey);
  }

  const response = {
    scheme: 'x402',
    network: options.network,
    mint: options.price.mint,
    amount: options.price.amount.toString(),
    recipient: options.merchantWallet,
    reference,
    expires_in: options.ttlSeconds || DEFAULT_TTL_SECONDS,
  };

  res.status(402).json(response);
}

/**
 * Attach x402 options to request object for use in send402Response
 * This is a helper for the middleware to pass options to the response handler
 */
export function attachX402Options(req: Request, options: X402Options): void {
  (req as any).x402Options = options;
}
