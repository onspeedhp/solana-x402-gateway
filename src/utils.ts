/**
 * Utility functions
 */

import {
  generateKeyPair,
  getAddressFromPublicKey,
  type Address,
} from '@solana/kit';

/**
 * Generate a new reference keypair for payment tracking
 * Returns both the CryptoKeyPair and the address as a string
 */
export async function generateReferenceKeypair(): Promise<{
  keyPair: globalThis.CryptoKeyPair;
  address: Address;
}> {
  const keyPair = await generateKeyPair();
  const address = await getAddressFromPublicKey(keyPair.publicKey);
  return { keyPair, address };
}
