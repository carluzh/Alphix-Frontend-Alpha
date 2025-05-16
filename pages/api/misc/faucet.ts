import type { NextApiRequest, NextApiResponse } from 'next';
import { getAddress, encodeFunctionData, type Address, type Hex } from 'viem';
import { publicClient } from '../../../lib/viemClient'; // Adjusted path

// Contract details
const FAUCET_CONTRACT_ADDRESS: Address = '0x0e99563bC3412bF64B0d0913E0777e8d97ee8756';
const FAUCET_FUNCTION_SIGNATURE: Hex = '0xde5f72fd'; // faucet()

interface FaucetRequest extends NextApiRequest {
    body: {
        userAddress: string;
        chainId: number;
    };
}

export default async function handler(req: FaucetRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }

    try {
        const { userAddress, chainId } = req.body;

        if (!userAddress || !chainId) {
            return res.status(400).json({ message: 'Missing userAddress or chainId' });
        }

        const validatedUserAddress = getAddress(userAddress);

        // Encode the function call
        // Since faucet() takes no arguments, the data is just the function signature.
        const callData = FAUCET_FUNCTION_SIGNATURE;

        // We are not simulating here as it's a state-changing call that likely doesn't return useful data for simulation
        // and might fail if the user has already claimed recently, which is fine.
        // The frontend will handle the transaction submission.

        res.status(200).json({
            message: 'Faucet transaction ready',
            to: FAUCET_CONTRACT_ADDRESS,
            data: callData,
            value: '0', // Assuming faucet calls don't require sending ETH
            chainId: chainId,
        });

    } catch (error: any) {
        console.error("Error in /api/misc/faucet:", error);
        res.status(500).json({
            message: 'Failed to prepare faucet transaction',
            errorDetails: error.message || 'Unknown error',
        });
    }
} 