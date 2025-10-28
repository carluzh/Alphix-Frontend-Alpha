import type { NextApiRequest, NextApiResponse } from 'next';
import { type Address } from 'viem';
import { publicClient } from '../../../lib/viemClient';
import {
    PERMIT2_ADDRESS,
    PERMIT_EXPIRATION_DURATION_SECONDS,
    PERMIT_SIG_DEADLINE_DURATION_SECONDS,
    getPermit2Domain,
} from '../../../lib/swap-constants';
import { TokenSymbol } from '../../../lib/pools-config';
import { iallowance_transfer_abi } from '../../../lib/abis/IAllowanceTransfer_abi';
import { getUniversalRouterAddress } from '../../../lib/pools-config';

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
    };
}

export default async function handler(req: PreparePermitRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ ok: false, message: `Method ${req.method} Not Allowed` });
    }

    try {
        const { userAddress, fromTokenSymbol, fromTokenAddress, chainId, amountIn } = req.body;

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

        const UNIVERSAL_ROUTER_ADDRESS = getUniversalRouterAddress();
        if (!UNIVERSAL_ROUTER_ADDRESS) {
            return res.status(400).json({ ok: false, message: `Chain ID ${chainId} not supported` });
        }

        const [currentAmount, currentExpiration, nonce] = await publicClient.readContract({
            address: PERMIT2_ADDRESS,
            abi: iallowance_transfer_abi,
            functionName: 'allowance',
            args: [userAddress as Address, fromTokenAddress as Address, UNIVERSAL_ROUTER_ADDRESS],
        }) as [bigint, number, number];

        const now = Math.floor(Date.now() / 1000);
        const requiredAmount = BigInt(amountIn);

        if (currentAmount > requiredAmount && currentExpiration > now) {
            return res.status(200).json({
                ok: true,
                message: 'Valid permit exists',
                needsPermit: false,
                existingPermit: {
                    amount: currentAmount.toString(),
                    expiration: currentExpiration,
                    nonce: nonce
                }
            });
        }

        const expiration = now + PERMIT_EXPIRATION_DURATION_SECONDS;
        const sigDeadline = BigInt(now + PERMIT_SIG_DEADLINE_DURATION_SECONDS);
        const permitAmount = requiredAmount + 1n;

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