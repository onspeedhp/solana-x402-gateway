/**
 * Solana RPC client factory
 */

import { createSolanaRpc, devnet, mainnet, testnet } from '@solana/kit';

export type SolanaRpcClient = ReturnType<typeof createSolanaRpc>;

/**
 * Create a Solana RPC client for the specified network
 */
export function createSolanaRpcClient(
  network: 'devnet' | 'mainnet-beta' | 'testnet',
  rpcEndpoint: string
): SolanaRpcClient {
  const cluster = (() => {
    switch (network) {
      case 'devnet':
        return devnet(rpcEndpoint);
      case 'mainnet-beta':
        return mainnet(rpcEndpoint);
      case 'testnet':
        return testnet(rpcEndpoint);
      default:
        throw new Error(`Unknown network: ${network}`);
    }
  })();

  return createSolanaRpc(cluster);
}
