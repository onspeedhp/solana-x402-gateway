/**
 * Payment Payload utilities
 * Handles X-PAYMENT header with Base64 encoded JSON
 */

import { PaymentPayload } from './types';

/**
 * Parse Payment Payload from X-PAYMENT header
 * The header contains Base64 encoded JSON
 */
export function parsePaymentPayload(headerValue: string): PaymentPayload {
  try {
    const decoded = Buffer.from(headerValue, 'base64').toString('utf-8');
    const payload = JSON.parse(decoded) as PaymentPayload;
    return payload;
  } catch (error) {
    throw new Error(`Invalid Payment Payload format: ${error}`);
  }
}

/**
 * Encode Payment Payload to Base64 string for X-PAYMENT header
 */
export function encodePaymentPayload(payload: PaymentPayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, 'utf-8').toString('base64');
}

/**
 * Validate Payment Payload structure
 */
export function validatePaymentPayload(payload: PaymentPayload): boolean {
  return (
    typeof payload.network === 'string' &&
    typeof payload.transaction === 'string' &&
    typeof payload.reference === 'string'
  );
}
