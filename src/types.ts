/**
 * x402 Protocol Types
 */

/**
 * Payment Requirement - Describes what payment is required
 * Returned in HTTP 402 Payment Required Response
 */
export interface PaymentRequirement {
  network: string; // e.g., "devnet", "mainnet-beta"
  mint: string; // USDC mint address
  amount: string; // Amount as string (e.g., "0.05")
  recipient: string; // Recipient wallet address
  reference: string; // Reference account address (unique for this request)
  expires_in: number; // Expiration time in seconds
}

/**
 * Payment Required Response - HTTP 402 response body
 */
export interface PaymentRequiredResponse {
  paymentRequirements: PaymentRequirement[];
}

/**
 * Payment Payload - Created by client and sent in X-PAYMENT header (Base64 encoded)
 */
export interface PaymentPayload {
  network: string; // e.g., "devnet", "mainnet-beta"
  transaction: string; // Signed transaction (serialized, Base64 encoded)
  reference: string; // Reference account address
}

/**
 * Verification Response
 */
export interface VerificationResponse {
  valid: boolean;
  error?: string;
}
