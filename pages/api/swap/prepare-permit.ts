import type { NextApiRequest, NextApiResponse } from 'next';
import { getAddress, parseUnits, type Address, type Hex, createPublicClient, http } from 'viem';
import { publicClient } from '../../../lib/viemClient';
import {
    PERMIT2_ADDRESS,
    PERMIT2_ABI_ALLOWANCE_STRINGS,
    Permit2Abi_allowance,
    PERMIT_TYPES,
    PERMIT2_DOMAIN_NAME,
    PERMIT_EXPIRATION_DURATION_SECONDS,
    PERMIT_SIG_DEADLINE_DURATION_SECONDS,
    getPermit2Domain,
    getTargetChain,
    // CHAIN_ID as DEFAULT_CHAIN_ID, // We will use chainId from request or a validated default
} from '../../../lib/swap-constants';
import {
    TokenSymbol,
    getToken,
    NATIVE_TOKEN_ADDRESS
} from '../../../lib/pools-config';
import { iallowance_transfer_abi } from '../../../lib/abis/IAllowanceTransfer_abi';
import { getUniversalRouterAddress } from '../../../lib/pools-config';

// Define MaxUint160 constant
const MaxUint160 = BigInt('0xffffffffffffffffffffffffffffffffffffffff');

// Helper function for Permit2 address (single network in this app)
const getPermit2Address = (chainId: number): Address => {
    return PERMIT2_ADDRESS; // Use the constant from swap-constants
};

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
        fromTokenSymbol: TokenSymbol;
        fromTokenAddress: string;
        toTokenSymbol: TokenSymbol;
        chainId: number;
    };
}

export default async function handler(req: PreparePermitRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ ok: false, message: `Method ${req.method} Not Allowed` });
    }

    try {
        console.log("DEBUG: prepare-permit received request body:", req.body);
        
        const {
            userAddress,
            fromTokenSymbol,
            fromTokenAddress,
            toTokenSymbol,
            chainId
        } = req.body;

        console.log("DEBUG: extracted values:", {
            userAddress,
            fromTokenSymbol,
            fromTokenAddress,
            toTokenSymbol,
            chainId
        });

        // Early return for native ETH - no permit needed
        if (fromTokenSymbol === 'ETH') {
            return res.status(200).json({
                ok: true,
                message: 'Native ETH swap - no permit required',
                needsPermit: false,
                existingPermit: null
            });
        }

        // Validate required fields for ERC-20 tokens
        if (!userAddress || !fromTokenSymbol || !fromTokenAddress || !toTokenSymbol || !chainId) {
            console.log("DEBUG: validation failed - missing fields check:", {
                hasUserAddress: !!userAddress,
                hasFromTokenSymbol: !!fromTokenSymbol,
                hasFromTokenAddress: !!fromTokenAddress,
                hasToTokenSymbol: !!toTokenSymbol,
                hasChainId: !!chainId
            });
            return res.status(400).json({ 
                ok: false, 
                message: 'Missing required fields: userAddress, fromTokenSymbol, fromTokenAddress, toTokenSymbol, chainId' 
            });
        }

        // Continue with existing ERC-20 permit logic...
        const PERMIT2_ADDRESS = getPermit2Address(chainId);
        const UNIVERSAL_ROUTER_ADDRESS = getUniversalRouterAddress();

        if (!PERMIT2_ADDRESS || !UNIVERSAL_ROUTER_ADDRESS) {
            return res.status(400).json({ 
                ok: false, 
                message: `Chain ID ${chainId} is not supported` 
            });
        }

        // Use the existing publicClient instead of creating a new one
        // Get current nonce for the user
        const currentNonce = await publicClient.readContract({
            address: PERMIT2_ADDRESS,
            abi: iallowance_transfer_abi,
            functionName: 'allowance',
            args: [userAddress as Address, fromTokenAddress as Address, UNIVERSAL_ROUTER_ADDRESS],
        }) as [bigint, number, number]; // [amount, expiration, nonce]

        const [currentAmount, currentExpiration, nonce] = currentNonce;
        const currentTimestamp = Math.floor(Date.now() / 1000);

        // Check if existing permit is still valid
        const hasValidExistingPermit = currentAmount > 0n && currentExpiration > currentTimestamp;

        if (hasValidExistingPermit) {
            return res.status(200).json({
                ok: true,
                message: 'Valid existing permit found',
                needsPermit: false,
                existingPermit: {
                    amount: currentAmount.toString(),
                    expiration: currentExpiration,
                    nonce: nonce
                }
            });
        }

        // Need new permit - generate permit data
        const expiration = currentTimestamp + (7 * 24 * 60 * 60); // 7 days from now
        const sigDeadline = BigInt(currentTimestamp + (60 * 60)); // 1 hour from now

        const permit: PermitSingleMessage = {
            details: {
                token: fromTokenAddress as Address,
                amount: MaxUint160, // Maximum allowance
                expiration: expiration,
                nonce: nonce
            },
            spender: UNIVERSAL_ROUTER_ADDRESS,
            sigDeadline: sigDeadline
        };

        const domain: PermitDomain = getPermit2Domain(chainId, PERMIT2_ADDRESS);

        const types = {
            PermitSingle: [
                { name: 'details', type: 'PermitDetails' },
                { name: 'spender', type: 'address' },
                { name: 'sigDeadline', type: 'uint256' }
            ],
            PermitDetails: [
                { name: 'token', type: 'address' },
                { name: 'amount', type: 'uint160' },
                { name: 'expiration', type: 'uint48' },
                { name: 'nonce', type: 'uint48' }
            ]
        };

        // Convert BigInt values to strings for JSON serialization
        const permitForJson = {
            details: {
                token: permit.details.token,
                amount: permit.details.amount.toString(), // Convert BigInt to string
                expiration: permit.details.expiration,
                nonce: permit.details.nonce
            },
            spender: permit.spender,
            sigDeadline: permit.sigDeadline.toString() // Convert BigInt to string
        };

        res.status(200).json({
            ok: true,
            message: 'Permit signature required',
            needsPermit: true,
            permitData: {
                domain,
                types,
                message: permitForJson, // Use the JSON-safe version
                primaryType: 'PermitSingle' as const
            }
        });

    } catch (error) {
        console.error('Error in prepare-permit:', error);
        res.status(500).json({ 
            ok: false, 
            message: 'Failed to prepare permit', 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
} 