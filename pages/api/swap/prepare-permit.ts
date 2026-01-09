import type { NextApiRequest, NextApiResponse } from 'next';
import { type Address } from 'viem';
import { createNetworkClient } from '../../../lib/viemClient';
import {
    PERMIT2_ADDRESS,
    PERMIT_EXPIRATION_DURATION_SECONDS,
    PERMIT_SIG_DEADLINE_DURATION_SECONDS,
    AVERAGE_L2_BLOCK_TIME_MS,
    MaxAllowanceTransferAmount,
    getPermit2Domain,
} from '../../../lib/swap-constants';
import { TokenSymbol, getNetworkModeFromRequest } from '../../../lib/pools-config';
import { iallowance_transfer_abi } from '../../../lib/abis/IAllowanceTransfer_abi';
import { getUniversalRouterAddress } from '../../../lib/pools-config';
import { Erc20AbiDefinition } from '../../../lib/swap-constants';

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
        amountIn: string;
        approvalMode?: 'exact' | 'infinite';
    };
}

export default async function handler(req: PreparePermitRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ ok: false, message: `Method ${req.method} Not Allowed` });
    }

    try {
        const { userAddress, fromTokenSymbol, fromTokenAddress, chainId, amountIn, approvalMode = 'infinite' } = req.body;

        // Get network mode from cookies for proper chain-specific addresses
        const networkMode = getNetworkModeFromRequest(req.headers.cookie);
        console.log('[prepare-permit] Network mode from cookies:', networkMode);

        if (fromTokenSymbol === 'ETH') {
            return res.status(200).json({
                ok: true,
                message: 'Native ETH swap - no permit required',
                needsPermit: false
            });
        }

        if (!userAddress || !fromTokenAddress || !chainId || !amountIn) {
            return res.status(400).json({
                ok: false,
                message: 'Missing required fields'
            });
        }

        // Get network-specific Universal Router address
        const UNIVERSAL_ROUTER_ADDRESS = getUniversalRouterAddress(networkMode);
        if (!UNIVERSAL_ROUTER_ADDRESS) {
            return res.status(400).json({ ok: false, message: `Chain ID ${chainId} not supported` });
        }
        console.log('[prepare-permit] Using Universal Router:', UNIVERSAL_ROUTER_ADDRESS);

        // Create network-specific public client
        const publicClient = createNetworkClient(networkMode);

        // Batch both allowance checks into single multicall
        // This is more efficient than two separate RPC calls
        const [erc20AllowanceResult, permit2AllowanceResult] = await publicClient.multicall({
            contracts: [
                {
                    address: fromTokenAddress as Address,
                    abi: Erc20AbiDefinition,
                    functionName: 'allowance',
                    args: [userAddress as Address, PERMIT2_ADDRESS],
                },
                {
                    address: PERMIT2_ADDRESS,
                    abi: iallowance_transfer_abi,
                    functionName: 'allowance',
                    args: [userAddress as Address, fromTokenAddress as Address, UNIVERSAL_ROUTER_ADDRESS],
                },
            ],
            allowFailure: false,
        });

        const tokenAllowance = erc20AllowanceResult as bigint;
        const requiredAmount = BigInt(amountIn);
        const isApproved = tokenAllowance >= requiredAmount;

        const [currentAmount, currentExpiration, nonce] = permit2AllowanceResult as [bigint, number, number];

        // Add block time buffer to ensure signature is valid when transaction is submitted
        // Using L2 block time since we're on Base
        const now = Math.floor((Date.now() + AVERAGE_L2_BLOCK_TIME_MS) / 1000);

        // Use >= for both checks (Uniswap standard)
        // Permit can be reused if amount is sufficient AND not expired
        if (currentAmount >= requiredAmount && currentExpiration >= now) {
            return res.status(200).json({
                ok: true,
                message: 'Valid permit exists',
                needsPermit: false,
                isApproved,
                existingPermit: {
                    amount: currentAmount.toString(),
                    expiration: currentExpiration,
                    nonce: nonce
                }
            });
        }

        const expiration = now + PERMIT_EXPIRATION_DURATION_SECONDS;
        const sigDeadline = BigInt(now + PERMIT_SIG_DEADLINE_DURATION_SECONDS);
        const permitAmount = approvalMode === 'exact'
            ? requiredAmount + 1n
            : MaxAllowanceTransferAmount;

        const permit: PermitSingleMessage = {
            details: {
                token: fromTokenAddress as Address,
                amount: permitAmount,
                expiration,
                nonce
            },
            spender: UNIVERSAL_ROUTER_ADDRESS,
            sigDeadline
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

        res.status(200).json({
            ok: true,
            message: 'Permit signature required',
            needsPermit: true,
            isApproved,
            permitData: {
                domain,
                types,
                message: {
                    details: {
                        token: permit.details.token,
                        amount: permit.details.amount.toString(),
                        expiration: permit.details.expiration,
                        nonce: permit.details.nonce
                    },
                    spender: permit.spender,
                    sigDeadline: permit.sigDeadline.toString()
                },
                primaryType: 'PermitSingle' as const
            }
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: 'Failed to prepare permit',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
} 