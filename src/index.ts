/**
 * Solana x402 SDK - Main entry point
 *
 * Simple SDK to onboard x402 payment protocol
 */

// x402 Resource Server (main middleware)
export {
  x402ResourceServer,
  type ResourceServerOptions,
  type PaymentRequirementConfig,
} from './resourceServer';

// Types
export type {
  PaymentRequirement,
  PaymentRequiredResponse,
  PaymentPayload,
} from './types';

// Client utilities (for creating Payment Payloads)
export {
  createPaymentPayload,
  createXPaymentHeader,
  createXPaymentHeaderFromTransaction,
} from './client';
