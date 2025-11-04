# solana-x402-gateway

[![npm version](https://img.shields.io/npm/v/solana-x402-gateway.svg)](https://www.npmjs.com/package/solana-x402-gateway)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A simple TypeScript SDK for integrating **x402 payment verification** (Solana USDC) into your Express applications. Implement pay-per-request APIs using the HTTP 402 Payment Required status code pattern.

## Installation

```bash
npm install solana-x402-gateway express
```

## Quick Start

### Server Setup

```typescript
import express from 'express';
import { x402ResourceServer } from 'solana-x402-gateway';

const app = express();
app.use(express.json());

// Apply x402 middleware to routes
// This middleware will automatically:
// 1. Check for X-PAYMENT header
// 2. If missing, return HTTP 402 with payment details
// 3. If present, verify payment and send transaction to blockchain
// 4. Only call next() if payment is verified
app.use(
  '/api',
  x402ResourceServer({
    network: 'devnet',
    rpcEndpoint: 'https://api.devnet.solana.com',
    paymentRequirements: [
      {
        mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // USDC devnet
        amount: 0.05, // 0.05 USDC
        recipient: 'YOUR_SOLANA_WALLET_ADDRESS', // Your wallet to receive payments
      },
    ],
  })
);

// These routes will only execute if payment is verified
app.get('/api/data', (req, res) => {
  res.json({
    result: 'some data',
    value: 123,
  });
});

app.get('/api/user/:id', (req, res) => {
  res.json({
    id: req.params.id,
    name: 'John Doe',
  });
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
```

### Client Integration

```typescript
import { createXPaymentHeaderFromTransaction } from 'solana-x402-gateway';
import { Connection, PublicKey, Keypair, Transaction } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

async function fetchData(url: string, wallet: Keypair, connection: Connection) {
  // Step 1: Make initial request
  let response = await fetch(url);

  // Step 2: Check if payment is required (HTTP 402)
  if (response.status === 402) {
    const { paymentRequirements } = await response.json();
    const payment = paymentRequirements[0];

    // Step 3: Create and sign payment transaction
    const signedTransaction = await createPaymentTransaction(
      wallet,
      connection,
      payment
    );

    // Step 4: Send signed transaction to server in X-PAYMENT header
    const xPaymentHeader = createXPaymentHeaderFromTransaction(
      signedTransaction, // Serialized signed transaction (Uint8Array)
      payment
    );

    // Retry request with payment
    response = await fetch(url, {
      headers: { 'X-PAYMENT': xPaymentHeader },
    });
  }

  // Step 5: Handle response
  if (response.ok) {
    const data = await response.json();
    return data;
  }

  throw new Error(`Request failed: ${response.status}`);
}

async function createPaymentTransaction(
  wallet: Keypair,
  connection: Connection,
  payment: any
) {
  const mint = new PublicKey(payment.mint);
  const recipient = new PublicKey(payment.recipient);
  const reference = new PublicKey(payment.reference);

  // Get token accounts
  const senderTokenAccount = await getAssociatedTokenAddress(
    mint,
    wallet.publicKey
  );
  const recipientTokenAccount = await getAssociatedTokenAddress(
    mint,
    recipient
  );

  // Convert amount (USDC has 6 decimals)
  const amount = BigInt(Math.floor(parseFloat(payment.amount) * 1_000_000));

  // Create transfer instruction
  const transferIx = createTransferInstruction(
    senderTokenAccount,
    recipientTokenAccount,
    wallet.publicKey,
    amount,
    [],
    TOKEN_PROGRAM_ID
  );

  // IMPORTANT: Add reference account to transaction
  transferIx.keys.push({
    pubkey: reference,
    isSigner: false,
    isWritable: true,
  });

  // Create and sign transaction
  const transaction = new Transaction().add(transferIx);
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = wallet.publicKey;
  transaction.sign(wallet);

  // Return serialized transaction (don't send to blockchain yet!)
  return transaction.serialize();
}
```

## How It Works

1. Client requests protected resource → Server returns **HTTP 402** with payment details
2. Client creates and signs Solana transaction (transfer USDC + include reference account)
3. Client sends signed transaction to server in **X-PAYMENT** header
4. Server verifies signed transaction → Sends to blockchain → Waits for confirmation
5. Server returns **200 OK** with requested resource

## API Reference

### `x402ResourceServer(options)`

```typescript
interface ResourceServerOptions {
  network: 'devnet' | 'mainnet-beta' | 'testnet';
  rpcEndpoint: string;
  paymentRequirements: PaymentRequirementConfig[];
  ttlSeconds?: number; // Default: 300 (5 minutes)
  logger?: (message: string) => void;
}

interface PaymentRequirementConfig {
  mint: string; // USDC mint address
  amount: number; // Amount in USDC
  recipient: string; // Your wallet address to receive payments
}
```

### Client Utilities

```typescript
// Create X-PAYMENT header from signed transaction
createXPaymentHeaderFromTransaction(
  signedTransaction: Uint8Array | string,
  paymentRequirement: PaymentRequirement
): string

// Create Payment Payload object
createPaymentPayload(
  signedTransaction: Uint8Array | string,
  paymentRequirement: PaymentRequirement
): PaymentPayload

// Encode Payment Payload to Base64
createXPaymentHeader(payload: PaymentPayload): string
```

## Configuration

### USDC Mint Addresses

- **Devnet**: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- **Mainnet**: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`

### Response Format

**402 Payment Required:**

```json
{
  "paymentRequirements": [
    {
      "network": "devnet",
      "mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      "amount": "0.05",
      "recipient": "YOUR_WALLET_ADDRESS",
      "reference": "UNIQUE_REFERENCE_ADDRESS",
      "expires_in": 300
    }
  ]
}
```

**Payment Payload (X-PAYMENT header):**

```json
{
  "network": "devnet",
  "transaction": "<BASE64_ENCODED_SIGNED_TRANSACTION>",
  "reference": "REFERENCE_ADDRESS"
}
```

(Entire JSON is Base64 encoded)

## Important Notes

- **Reference Account**: Each request gets a unique reference account. The client **must include this reference in the transaction** so the server can match payments to requests.
- **Signed Transaction**: Client creates and signs the transaction but does **not** send it to blockchain. The server handles sending the transaction after verification.
- **Payment Verification**: Server verifies the signed transaction, sends it to blockchain, and confirms it before fulfilling the request.
- **Caching**: Verified payments are cached (default 5 minutes) to reduce redundant verifications.

## License

MIT © 2024
