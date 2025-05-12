import type { NextApiRequest, NextApiResponse } from 'next';
import { getAddress, parseUnits, type Address, type Hex } from 'viem';
import { publicClient } from '../../../lib/viemClient';
import {
    PERMIT2_ADDRESS,
    PERMIT2_ABI_ALLOWANCE_STRINGS,
    Permit2Abi_allowance,
    UNIVERSAL_ROUTER_ADDRESS,
    PERMIT_TYPES,
    PERMIT2_DOMAIN_NAME,
    PERMIT_EXPIRATION_DURATION_SECONDS,
    PERMIT_SIG_DEADLINE_DURATION_SECONDS,
    // CHAIN_ID as DEFAULT_CHAIN_ID, // We will use chainId from request or a validated default
} from '../../../lib/swap-constants';

// Ensure this matches the structure viem expects for signTypedData
type PermitSingleMessage = {
    details: {
        token: Address;
        amount: bigint; // viem expects bigint for uint160
        expiration: number; // uint48
        nonce: number; // uint48
    };
    spender: Address;
    sigDeadline: bigint; // viem expects bigint for uint256
};

type PermitDomain = {
    name: string;
    version?: string; // Optional version
    chainId: number;
    verifyingContract: Address;
};

interface PreparePermitRequest extends NextApiRequest {
    body: {
        userAddress: string;
        tokenAddress: string;
        // amountToPermit: string; // Amount for EIP712 should be bigint compatible (string for API, then parsed)
        chainId: number; // Chain ID for the permit domain
        checkExisting?: boolean; // New flag to check for existing permits
    };
}

export default async function handler(req: PreparePermitRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }

    try {
        const {
            userAddress,
            tokenAddress,
            // amountToPermit, // This amount isn't strictly needed for nonce fetching for PermitSingle with spender allowance.
                            // The actual amount will be in the signed message, which the user confirms.
                            // For PermitSingle, the `amount` in `details` is what gets permitted.
            chainId,
            checkExisting = false // Default to false for backward compatibility
        } = req.body;

        if (!userAddress || !tokenAddress || !chainId) {
            return res.status(400).json({ message: 'Missing required fields: userAddress, tokenAddress, chainId' });
        }

        const owner = getAddress(userAddress);
        const token = getAddress(tokenAddress);
        const spender = UNIVERSAL_ROUTER_ADDRESS; // Spender is the Universal Router

        // 1. Fetch the current allowance from Permit2 contract
        const allowanceResult = await publicClient.readContract({
            address: PERMIT2_ADDRESS,
            abi: Permit2Abi_allowance,
            functionName: 'allowance',
            args: [owner, token, spender],
        }) as readonly [bigint, number, number]; // [amount, expiration, nonce]
        
        console.log("Debug: Raw allowanceResult from Permit2:", allowanceResult);

        const currentAmount = allowanceResult[0];
        const currentExpiration = allowanceResult[1];
        const nonce = allowanceResult[2]; // Nonce is the third element

        // 2. Calculate timestamps
        const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
        const ONE_DAY_SECONDS = 24 * 60 * 60; // 1 day in seconds
        const permitExpiration = currentTimestamp + BigInt(ONE_DAY_SECONDS); // Set expiration to 1 day from now
        const sigDeadline = currentTimestamp + BigInt(PERMIT_SIG_DEADLINE_DURATION_SECONDS);

        // Check if we have a valid existing permit
        const hasValidPermit = currentExpiration > Math.floor(Date.now() / 1000);
        
        // 3. Construct the EIP-712 domain
        // The actual amount to permit will be specified by the client when they form the message to sign.
        // This API route provides the nonce and other necessary components.
        const domain: PermitDomain = {
            name: PERMIT2_DOMAIN_NAME,
            chainId: Number(chainId), // Ensure chainId is a number
            verifyingContract: PERMIT2_ADDRESS,
        };

        // The message structure is defined by PERMIT_TYPES. The frontend will construct the actual message 
        // using an amount it determines (e.g., the swap input amount).
        // This API provides the nonce, spender, deadlines, and domain.

        res.status(200).json({
            // ----- Data for EIP-712 Signature -----
            domain,
            types: PERMIT_TYPES, // Provide the type definitions
            primaryType: 'PermitSingle',
            // ----- Values to be included in the message by the client -----
            nonce: nonce, // The fetched nonce (number)
            spender: spender, // The Universal Router address (Address)
            // ----- Timestamps for the permit & signature -----
            permitExpiration: Number(permitExpiration), // Expiration for the permit itself (uint48 -> number)
            sigDeadline: sigDeadline.toString(),      // Deadline for the signature (uint256 -> string for bigint)
            // ----- For client-side validation/information -----
            expectedChainId: Number(chainId),
            permit2Address: PERMIT2_ADDRESS,
            // ----- Existing permit information -----
            hasValidPermit: hasValidPermit,
            currentPermitInfo: {
                amount: currentAmount.toString(),
                expiration: currentExpiration,
                nonce: nonce
            }
        });

    } catch (error: any) {
        console.error("Error in /api/swap/prepare-permit:", error);
        res.status(500).json({ 
            message: 'Internal Server Error', 
            error: error.message || (error.shortMessage || 'Unknown error') 
        });
    }
} 