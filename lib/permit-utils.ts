import { Token } from '@uniswap/sdk-core';
import { getAddress, type Hex } from 'viem';
import { PERMIT_TYPES, PERMIT2_DOMAIN_NAME } from './swap-constants';

// Constants
export const PERMIT2_ADDRESS = getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3");
export const MAX_UINT_160 = (1n << 160n) - 1n;
export const MAX_UINT_48 = (1n << 48n) - 1n;

// Default expiration durations
export const PERMIT_EXPIRATION_DURATION_SECONDS = 30 * 24 * 60 * 60; // 30 days
export const PERMIT_SIG_DEADLINE_DURATION_SECONDS = 30 * 60; // 30 minutes

// Types for permit data structures
export interface PermitDetails {
    token: string;
    amount: string;
    expiration: number;
    nonce: number;
}

export interface PermitBatch {
    details: PermitDetails[];
    spender: string;
    sigDeadline: string;
}

export interface PermitSingle {
    details: PermitDetails;
    spender: string;
    sigDeadline: string;
}

export interface SignedPermit {
    signature: string;
    permitData: PermitBatch | PermitSingle;
}

// EIP-712 typed data structures
export interface PermitBatchTypedData {
    domain: {
        name: string;
        chainId: number;
        verifyingContract: string;
    };
    types: {
        PermitBatch: Array<{ name: string; type: string }>;
        TokenPermissions: Array<{ name: string; type: string }>;
    };
    value: PermitBatch;
}

export interface PermitSingleTypedData {
    domain: {
        name: string;
        chainId: number;
        verifyingContract: string;
    };
    types: {
        PermitSingle: Array<{ name: string; type: string }>;
        TokenPermissions: Array<{ name: string; type: string }>;
    };
    value: PermitSingle;
}

/**
 * Generates typed data for a batch permit signature
 */
export function generatePermitBatchTypedData(
    permits: PermitDetails[],
    spender: string,
    chainId: number,
    sigDeadline?: string
): PermitBatchTypedData {
    const deadline = sigDeadline || (Math.floor(Date.now() / 1000) + PERMIT_SIG_DEADLINE_DURATION_SECONDS).toString();

    return {
        domain: {
            name: PERMIT2_DOMAIN_NAME,
            chainId: chainId,
            verifyingContract: PERMIT2_ADDRESS
        },
        types: {
            PermitBatch: [
                { name: 'details', type: 'TokenPermissions[]' },
                { name: 'spender', type: 'address' },
                { name: 'sigDeadline', type: 'uint256' }
            ],
            TokenPermissions: [
                { name: 'token', type: 'address' },
                { name: 'amount', type: 'uint160' },
                { name: 'expiration', type: 'uint48' },
                { name: 'nonce', type: 'uint48' }
            ]
        },
        value: {
            details: permits,
            spender: spender,
            sigDeadline: deadline
        }
    };
}

/**
 * Generates typed data for a single permit signature
 */
export function generatePermitSingleTypedData(
    permit: PermitDetails,
    spender: string,
    chainId: number,
    sigDeadline?: string
): PermitSingleTypedData {
    const deadline = sigDeadline || (Math.floor(Date.now() / 1000) + PERMIT_SIG_DEADLINE_DURATION_SECONDS).toString();

    return {
        domain: {
            name: PERMIT2_DOMAIN_NAME,
            chainId: chainId,
            verifyingContract: PERMIT2_ADDRESS
        },
        types: {
            PermitSingle: [
                { name: 'details', type: 'TokenPermissions' },
                { name: 'spender', type: 'address' },
                { name: 'sigDeadline', type: 'uint256' }
            ],
            TokenPermissions: [
                { name: 'token', type: 'address' },
                { name: 'amount', type: 'uint160' },
                { name: 'expiration', type: 'uint48' },
                { name: 'nonce', type: 'uint48' }
            ]
        },
        value: {
            details: permit,
            spender: spender,
            sigDeadline: deadline
        }
    };
}

/**
 * Creates permit details for a token with default values
 */
export function createPermitDetails(
    tokenAddress: string,
    amount: string,
    nonce: number,
    expiration?: number
): PermitDetails {
    const defaultExpiration = Math.floor(Date.now() / 1000) + PERMIT_EXPIRATION_DURATION_SECONDS;

    return {
        token: getAddress(tokenAddress),
        amount: amount || MAX_UINT_160.toString(),
        expiration: expiration || defaultExpiration,
        nonce: nonce
    };
}

/**
 * Creates permit details for multiple tokens (for batch operations)
 */
export function createBatchPermitDetails(
    tokens: Array<{
        address: string;
        amount?: string;
        nonce: number;
        expiration?: number;
    }>
): PermitDetails[] {
    return tokens.map(token => createPermitDetails(
        token.address,
        token.amount || MAX_UINT_160.toString(),
        token.nonce,
        token.expiration
    ));
}

/**
 * Validates permit signature data
 */
export function validatePermitSignature(signature: string): boolean {
    if (!signature) return false;

    // Check if signature is hex and has correct length (65 bytes = 130 hex chars + 0x)
    const hexRegex = /^0x[a-fA-F0-9]{130}$/;
    return hexRegex.test(signature);
}

/**
 * Checks if a permit is expired
 */
export function isPermitExpired(expiration: number): boolean {
    return expiration < Math.floor(Date.now() / 1000);
}

/**
 * Checks if signature deadline has passed
 */
export function isSignatureDeadlinePassed(sigDeadline: string): boolean {
    return parseInt(sigDeadline) < Math.floor(Date.now() / 1000);
}

/**
 * Utility to format permit amount for display
 */
export function formatPermitAmount(amount: string, token: Token): string {
    try {
        const amountBigInt = BigInt(amount);
        if (amountBigInt >= MAX_UINT_160) {
            return 'Max';
        }

        // Convert from wei to token units
        const divisor = BigInt(10) ** BigInt(token.decimals);
        const tokenAmount = amountBigInt / divisor;

        return tokenAmount.toString();
    } catch {
        return amount;
    }
}

/**
 * Calculates optimal nonce for permit
 * In a real implementation, this would query the current nonce from Permit2
 */
export async function getOptimalNonce(
    userAddress: string,
    tokenAddress: string,
    chainId: number
): Promise<number> {
    // Placeholder implementation
    // In practice, you would query the Permit2 contract for the current nonce
    // using the `nonces` function with the user and token addresses
    return Math.floor(Date.now() / 1000) % 2**48; // Use timestamp as nonce for demo
}

/**
 * Helper to determine if batch permits should be used
 */
export function shouldUseBatchPermit(tokens: string[]): boolean {
    return tokens.length > 1;
}

/**
 * Calculates gas savings from using permit vs approve
 */
export function estimatePermitGasSavings(tokenCount: number): number {
    // Rough estimate: each approve() call costs ~46k gas
    // Permit signature is free, but permit2 transaction has overhead
    const approveGasPerToken = 46000;
    const permitBatchOverhead = 80000;
    const permitGasPerToken = 30000;

    const approveGasCost = tokenCount * approveGasPerToken;
    const permitGasCost = permitBatchOverhead + (tokenCount * permitGasPerToken);

    return Math.max(0, approveGasCost - permitGasCost);
}

/**
 * Creates a permit configuration for liquidity operations
 */
export interface LiquidityPermitConfig {
    tokens: Array<{
        address: string;
        symbol: string;
        amount: string;
        decimals: number;
    }>;
    spender: string;
    userAddress: string;
    chainId: number;
    deadline?: number;
}

export function createLiquidityPermitConfig(config: LiquidityPermitConfig): {
    typedData: PermitBatchTypedData | PermitSingleTypedData;
    isBatch: boolean;
} {
    const isBatch = shouldUseBatchPermit(config.tokens.map(t => t.address));

    if (isBatch) {
        const permits = config.tokens.map((token, index) => createPermitDetails(
            token.address,
            token.amount,
            Math.floor(Date.now() / 1000) + index, // Simple nonce generation
            config.deadline
        ));

        return {
            typedData: generatePermitBatchTypedData(
                permits,
                config.spender,
                config.chainId
            ),
            isBatch: true
        };
    } else {
        const permit = createPermitDetails(
            config.tokens[0].address,
            config.tokens[0].amount,
            Math.floor(Date.now() / 1000),
            config.deadline
        );

        return {
            typedData: generatePermitSingleTypedData(
                permit,
                config.spender,
                config.chainId
            ),
            isBatch: false
        };
    }
}

/**
 * Parses permit signature to extract r, s, v components
 */
export function parsePermitSignature(signature: string): {
    r: string;
    s: string;
    v: number;
} {
    if (!validatePermitSignature(signature)) {
        throw new Error('Invalid permit signature format');
    }

    const sig = signature.slice(2); // Remove 0x prefix
    const r = '0x' + sig.slice(0, 64);
    const s = '0x' + sig.slice(64, 128);
    const v = parseInt(sig.slice(128, 130), 16);

    return { r, s, v };
}

/**
 * Encodes permit data for contract calls
 */
export function encodePermitData(
    permitData: PermitBatch | PermitSingle,
    signature: string,
    isBatch: boolean
): string {
    // This would encode the permit data according to the Permit2 contract interface
    // For now, return a placeholder
    return "0x" + Buffer.from(JSON.stringify({
        permitData,
        signature,
        isBatch
    })).toString('hex');
}