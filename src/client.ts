/**
 * Client utilities for x402 protocol
 * Helper functions for creating Payment Payloads
 */

import { PaymentPayload, PaymentRequirement } from './types';
import { encodePaymentPayload } from './paymentPayload';

/**
 * Create Payment Payload from signed transaction and payment requirement
 * Signed transaction MUST be Base64 encoded string
 * This is what the client sends in the X-PAYMENT header
 */
export function createPaymentPayload(
  signedTransactionBase64: string, // Base64 encoded signed transaction
  paymentRequirement: PaymentRequirement
): PaymentPayload {
  return {
    network: paymentRequirement.network,
    transaction: signedTransactionBase64,
    reference: paymentRequirement.reference,
  };
}

/**
 * Create X-PAYMENT header value from Payment Payload
 * Returns Base64 encoded JSON string ready to use in HTTP header
 */
export function createXPaymentHeader(paymentPayload: PaymentPayload): string {
  return encodePaymentPayload(paymentPayload);
}

/**
 * Convenience function to create X-PAYMENT header from signed transaction and payment requirement
 * Signed transaction MUST be Base64 encoded string
 */
export function createXPaymentHeaderFromTransaction(
  signedTransactionBase64: string, // Base64 encoded signed transaction
  paymentRequirement: PaymentRequirement
): string {
  const payload = createPaymentPayload(signedTransactionBase64, paymentRequirement);
  return createXPaymentHeader(payload);
}
