/**
 * Solana x402 SDK - Main entry point
 *
 * This SDK provides middleware and utilities for integrating
 * x402 payment verification into your existing applications.
 */

export { X402Middleware, X402Options } from './middleware';
export { PaymentVerifier } from './paymentVerifier';
export { PaymentState } from './paymentState';
export { createSolanaRpcClient, SolanaRpcClient } from './rpcClient';
export { generateReferenceKeypair } from './utils';

// Re-export types
export type { PaymentVerificationOptions } from './paymentVerifier';
