# solana-x402-gateway

[![npm version](https://img.shields.io/npm/v/solana-x402-gateway.svg)](https://www.npmjs.com/package/solana-x402-gateway)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

A TypeScript SDK for integrating **x402 payment verification** (Solana USDC) into your Express applications. Implement pay-per-request APIs using the HTTP 402 Payment Required status code pattern.

## Features

- 🔐 **Express Middleware** - Simple middleware integration for protected routes
- 💰 **Solana USDC Payments** - Built on Solana's fast and low-cost blockchain
- ⚡ **Built with @solana/kit** - Modern, tree-shakable Solana SDK
- 🔄 **Payment Caching** - In-memory cache with TTL to reduce RPC calls
- 📝 **TypeScript** - Full type safety and IntelliSense support
- 🎯 **Reference Accounts** - Unique payment references prevent payment collisions

## Installation

```bash
npm install solana-x402-gateway
```

**Peer Dependencies:**

```bash
npm install express
```

## Quick Start

### Server Setup

```typescript
import express from 'express';
import { X402Middleware } from 'solana-x402-gateway';

const app = express();
app.use(express.json());

// Apply x402 middleware to protected routes
app.use(
  '/api/premium',
  X402Middleware({
    network: 'devnet',
    rpcEndpoint: 'https://api.devnet.solana.com',
    price: {
      amount: 0.05, // 0.05 USDC
      mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // USDC devnet
    },
    merchantWallet: 'YOUR_SOLANA_WALLET_ADDRESS',
    ttlSeconds: 300, // Cache verified payments for 5 minutes
  })
);

// Protected route - requires payment
app.get('/api/premium/data', (req, res) => {
  res.json({
    message: 'Premium data unlocked!',
    data: {
      /* your protected data */
    },
  });
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
```

### Client Integration

When a client calls the API and receives an HTTP 402 response, they need to follow these steps:

1. **Extract payment information** from the 402 response
2. **Create a transaction** to transfer USDC including the reference account
3. **Send the transaction** to the Solana blockchain
4. **Wait for transaction confirmation**
5. **Retry the request** with the `X-Payment-Reference` header

Below are two implementation options: one using `@solana/web3.js` (popular, beginner-friendly) and one using `@solana/kit` (modern, tree-shakeable).

#### Option 1: Using @solana/web3.js (Recommended for beginners)

```typescript
import { Connection, PublicKey, Keypair, Transaction } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

async function makeRequestWithPayment(
  url: string,
  wallet: Keypair,
  connection: Connection
) {
  // Step 1: Make initial request
  let response = await fetch(url);

  // Step 2: Check if payment is required (status 402)
  if (response.status === 402) {
    const payment = await response.json();
    // payment contains:
    // {
    //   scheme: 'x402',
    //   network: 'devnet',
    //   mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    //   amount: '0.05',           // Amount of USDC to pay
    //   recipient: '...',         // Recipient wallet address
    //   reference: '...',         // Reference address (unique for this request)
    //   expires_in: 300           // Expiration time (seconds)
    // }

    // Step 3: Create and send payment transaction
    const signature = await createPaymentTransaction(
      wallet,
      connection,
      payment
    );

    // Step 4: Wait for transaction confirmation
    await connection.confirmTransaction(signature, 'confirmed');

    // Step 5: Retry request with reference header
    response = await fetch(url, {
      headers: {
        'X-Payment-Reference': payment.reference,
      },
    });
  }

  return response.json();
}

async function createPaymentTransaction(
  wallet: Keypair,
  connection: Connection,
  payment: any
) {
  // Convert addresses from string to PublicKey
  const mint = new PublicKey(payment.mint);
  const recipient = new PublicKey(payment.recipient);
  const reference = new PublicKey(payment.reference);

  // Get token account addresses for sender and recipient
  const senderTokenAccount = await getAssociatedTokenAddress(
    mint,
    wallet.publicKey
  );
  const recipientTokenAccount = await getAssociatedTokenAddress(
    mint,
    recipient
  );

  // Convert amount: USDC has 6 decimals
  // Example: 0.05 USDC = 50000 (0.05 * 1,000,000)
  const amount = BigInt(Math.floor(parseFloat(payment.amount) * 1_000_000));

  // Create USDC transfer instruction
  const transferIx = createTransferInstruction(
    senderTokenAccount,
    recipientTokenAccount,
    wallet.publicKey,
    amount,
    [],
    TOKEN_PROGRAM_ID
  );

  // IMPORTANT: Add reference account to transaction
  // This helps the server identify which request this payment belongs to
  transferIx.keys.push({
    pubkey: reference,
    isSigner: false,
    isWritable: true,
  });

  // Create transaction
  const transaction = new Transaction().add(transferIx);

  // Get latest blockhash and sign transaction
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = wallet.publicKey;
  transaction.sign(wallet);

  // Send transaction to blockchain
  const signature = await connection.sendRawTransaction(
    transaction.serialize()
  );

  return signature;
}
```

#### Option 2: Using @solana/kit (Modern, tree-shakeable)

```typescript
import {
  createSolanaRpc,
  address,
  getAddressFromPublicKey,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
  sendAndConfirmTransactionFactory,
  pipe,
} from '@solana/kit';
import {
  getAssociatedTokenAddressSync,
  getTransferInstruction,
} from '@solana/spl-token';

async function makeRequestWithPayment(
  url: string,
  wallet: CryptoKeyPair,
  rpcUrl: string
) {
  // Step 1: Make initial request
  let response = await fetch(url);

  // Step 2: Check if payment is required (status 402)
  if (response.status === 402) {
    const payment = await response.json();

    // Create RPC client
    const rpc = createSolanaRpc(rpcUrl);
    const walletAddress = await getAddressFromPublicKey(wallet.publicKey);

    // Step 3: Create and send payment transaction
    const signature = await createPaymentTransaction(rpc, wallet, payment);

    // Step 4: Wait for transaction confirmation
    const { sendAndConfirmTransaction } = sendAndConfirmTransactionFactory({
      rpc,
    });
    await sendAndConfirmTransaction(signature, { commitment: 'confirmed' });

    // Step 5: Retry request with reference header
    response = await fetch(url, {
      headers: {
        'X-Payment-Reference': payment.reference,
      },
    });
  }

  return response.json();
}

async function createPaymentTransaction(
  rpc: any,
  wallet: CryptoKeyPair,
  payment: any
) {
  const walletAddress = await getAddressFromPublicKey(wallet.publicKey);
  const mintAddress = address(payment.mint);
  const recipientAddress = address(payment.recipient);
  const referenceAddress = address(payment.reference);

  // Get token account addresses
  const senderTokenAccount = getAssociatedTokenAddressSync(
    mintAddress,
    walletAddress
  );
  const recipientTokenAccount = getAssociatedTokenAddressSync(
    mintAddress,
    recipientAddress
  );

  // Convert amount: USDC has 6 decimals
  const amount = BigInt(Math.floor(parseFloat(payment.amount) * 1_000_000));

  // Create USDC transfer instruction
  const transferIx = getTransferInstruction(
    senderTokenAccount,
    recipientTokenAccount,
    walletAddress,
    amount
  );

  // IMPORTANT: Add reference account to transaction
  transferIx.keys.push({
    pubkey: referenceAddress,
    isSigner: false,
    isWritable: true,
  });

  // Get latest blockhash
  const { value: blockhash } = await rpc.getLatestBlockhash().send();

  // Create and sign transaction message
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayer(walletAddress, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(blockhash, tx)
  );

  transactionMessage.instructions.push(transferIx);

  const signedTransaction = await signTransaction([wallet], transactionMessage);

  // Send transaction
  return await rpc.sendTransaction(signedTransaction).send();
}
```

## How It Works

The x402 payment flow is straightforward:

1. **Client sends request** → Server responds with **HTTP 402 Payment Required** along with payment details (amount, recipient address, reference account)

2. **Client creates transaction** → Transfers USDC to merchant wallet, **must include reference account** in the transaction

3. **Client retries request** → Includes `X-Payment-Reference` header containing the reference account address

4. **Server verifies payment** → SDK automatically:

   - Finds transactions related to the reference account
   - Verifies the payment amount is sufficient
   - Verifies the recipient address is correct
   - Checks that the reference account is included in the transaction

5. **Request proceeds** → If payment is valid, the request continues to your route handler

## API Reference

### `X402Middleware(options)`

Express middleware function that handles x402 payment verification.

#### Options

```typescript
interface X402Options {
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
```

### Advanced Usage

#### Custom Reference Generation

```typescript
import { generateReferenceKeypair } from 'solana-x402-gateway';

app.use(
  '/api/premium',
  X402Middleware({
    // ... other options
    generateReference: async () => {
      const { address } = await generateReferenceKeypair();
      return address;
    },
  })
);
```

#### Custom Logger

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

app.use(
  '/api/premium',
  X402Middleware({
    // ... other options
    logger: (message) => logger.info(`[x402] ${message}`),
  })
);
```

#### Programmatic Payment Verification

```typescript
import { PaymentVerifier, createSolanaRpcClient } from 'solana-x402-gateway';

const rpc = createSolanaRpcClient('devnet', 'https://api.devnet.solana.com');
const verifier = new PaymentVerifier(rpc);

const isPaid = await verifier.verifyPayment({
  reference: 'REFERENCE_PUBLIC_KEY',
  mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  recipient: 'MERCHANT_WALLET_ADDRESS',
  amount: 0.05,
});

if (isPaid) {
  console.log('Payment verified!');
}
```

## Configuration

### USDC Mint Addresses

- **Devnet**: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- **Mainnet**: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`

### RPC Endpoints

- **Public Devnet**: `https://api.devnet.solana.com`
- **Public Mainnet**: `https://api.mainnet-beta.solana.com`

> 💡 **Tip**: For production, consider using private RPC providers (QuickNode, Alchemy, Helius, etc.) for better rate limits, reliability, and performance.

## Why Reference Accounts?

Each time the server returns an HTTP 402, it creates a unique **reference account** (a unique public key address) for that request. This solves the following problem:

**Problem without reference:**

- If 10 users pay simultaneously, the server cannot determine which payment belongs to which request
- A scenario could occur where User A pays but User B receives access

**Solution with reference:**

- Each request gets its own reference account (like an order ID)
- When the client pays, they must include the reference account in the transaction
- The server simply finds transactions related to that reference account to identify which request the payment belongs to

This pattern mirrors [Solana Pay](https://docs.solanapay.com/) and ensures 100% accurate payment-to-request matching.

## Payment Verification

The SDK automatically verifies payments through the following steps:

1. **Find transactions** → Calls `getSignaturesForAddress(reference)` to get a list of transactions related to the reference account

2. **Get transaction details** → For each transaction, calls `getTransaction()` to view details

3. **Check conditions:**

   - ✅ Is the token USDC? (compare mint address)
   - ✅ Is the recipient address the merchant wallet?
   - ✅ Is the amount sufficient? (>= required amount)
   - ✅ Is the reference account included in the transaction? (to ensure this payment belongs to this request)

4. **Cache results** → If payment is valid, the SDK caches it in memory (default 5 minutes) to avoid repeated RPC calls and improve processing speed

## HTTP 402 Response Format

When the server requires payment, the middleware returns a JSON response with status code 402:

```json
{
  "scheme": "x402", // Scheme name (always "x402")
  "network": "devnet", // Network: "devnet" | "mainnet-beta" | "testnet"
  "mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", // USDC token address
  "amount": "0.05", // Amount of USDC to pay (string format)
  "recipient": "MERCHANT_WALLET_ADDRESS", // Recipient wallet address
  "reference": "REFERENCE_PUBLIC_KEY", // Reference account address (unique for this request)
  "expires_in": 300 // Expiration time (seconds) - default 5 minutes
}
```

The client needs to use this information to create the payment transaction.

## Troubleshooting

### Payment verification fails

**Problem:** Client has paid but server still reports payment not received

**Solutions:**

- ✅ Wait a few seconds after sending the transaction - blockchain needs time to confirm
- ✅ Check that the reference account is included in the transaction (required)
- ✅ Verify the payment amount is correct (including decimals)
- ✅ Check if the RPC endpoint can see your transaction (may need to wait for indexing)
- ✅ Verify the USDC mint address matches the network (devnet/mainnet are different)

### Middleware not working

**Problem:** Middleware doesn't block requests or doesn't return 402

**Solutions:**

- ✅ Check middleware order - must be placed BEFORE route handlers
- ✅ Verify all options are correctly configured
- ✅ Enable custom logger to view detailed logs
- ✅ Ensure Express `json()` middleware is applied if using JSON requests

### RPC errors

**Problem:** Cannot connect to Solana RPC

**Solutions:**

- ✅ Check if the RPC endpoint is accessible
- ✅ Verify the network matches the RPC endpoint (devnet/mainnet)
- ✅ If using public RPC, you may hit rate limits - consider switching to a private RPC provider
- ✅ For production, use a private RPC provider (QuickNode, Alchemy, Helius) for better rate limits

## TypeScript Support

Full TypeScript support with comprehensive type definitions included. All exports are typed and provide IntelliSense support in your IDE.

## Examples

### Example 1: Simple Express App

```typescript
import express from 'express';
import { X402Middleware } from 'solana-x402-gateway';

const app = express();
app.use(express.json());

// Public route - no payment required
app.get('/api/public', (req, res) => {
  res.json({ message: 'Free data', data: 'Free content' });
});

// Protected route - requires 0.05 USDC payment
app.use(
  '/api/premium',
  X402Middleware({
    network: 'devnet',
    rpcEndpoint: 'https://api.devnet.solana.com',
    price: {
      amount: 0.05, // 0.05 USDC
      mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // USDC devnet
    },
    merchantWallet: process.env.MERCHANT_WALLET!, // Recipient wallet address
  })
);

// This route is only accessible after payment
app.get('/api/premium/data', (req, res) => {
  res.json({
    message: 'Premium content unlocked!',
    secret: 'This is premium data that requires payment',
  });
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
```

### Example 2: Multiple Routes With Different Prices

```typescript
const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const MERCHANT_WALLET = 'YOUR_MERCHANT_WALLET_ADDRESS';

// Premium route - 0.05 USDC
app.use(
  '/api/premium',
  X402Middleware({
    network: 'devnet',
    rpcEndpoint: 'https://api.devnet.solana.com',
    price: { amount: 0.05, mint: USDC_DEVNET },
    merchantWallet: MERCHANT_WALLET,
  })
);

// Ultra-premium route - 0.10 USDC (more expensive)
app.use(
  '/api/ultra-premium',
  X402Middleware({
    network: 'devnet',
    rpcEndpoint: 'https://api.devnet.solana.com',
    price: { amount: 0.1, mint: USDC_DEVNET },
    merchantWallet: MERCHANT_WALLET,
  })
);

app.get('/api/premium/data', (req, res) => {
  res.json({ tier: 'premium', price: '0.05 USDC' });
});

app.get('/api/ultra-premium/data', (req, res) => {
  res.json({ tier: 'ultra-premium', price: '0.10 USDC' });
});
```

### Example 3: Using Custom Logger

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'x402-payments.log' }),
    new winston.transports.Console(),
  ],
});

app.use(
  '/api/premium',
  X402Middleware({
    // ... other options
    logger: (message) => {
      logger.info(`[x402-payment] ${message}`);
    },
  })
);
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT © 2024

## Related Projects

- [@solana/kit](https://github.com/anza-xyz/kit) - Modern Solana JavaScript SDK
- [Solana Pay](https://docs.solanapay.com/) - Payment standard for Solana
- [Express](https://expressjs.com/) - Fast, unopinionated web framework

---

**Built with ❤️ using @solana/kit**
