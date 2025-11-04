/**
 * Client utilities for x402 protocol
 * Helper functions for creating Payment Payloads
 */

import { PaymentPayload, PaymentRequirement } from './types';
import { encodePaymentPayload } from './paymentPayload';

/**
 * Create Payment Payload from signed transaction and payment requirement
 * Signed transaction should be serialized (Uint8Array) and Base64 encoded
 * This is what the client sends in the X-PAYMENT header
 */
export function createPaymentPayload(
  signedTransaction: Uint8Array | string, // Serialized transaction or Base64 string
  paymentRequirement: PaymentRequirement
): PaymentPayload {
  // If already Base64 string, use it; otherwise encode
  const transactionBase64 =
    typeof signedTransaction === 'string'
      ? signedTransaction
      : Buffer.from(signedTransaction).toString('base64');

  return {
    network: paymentRequirement.network,
    transaction: transactionBase64,
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
 * Signed transaction should be serialized (Uint8Array) and will be Base64 encoded
 */
export function createXPaymentHeaderFromTransaction(
  signedTransaction: Uint8Array | string,
  paymentRequirement: PaymentRequirement
): string {
  const payload = createPaymentPayload(signedTransaction, paymentRequirement);
  return createXPaymentHeader(payload);
}
