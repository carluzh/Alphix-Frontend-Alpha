import { NextApiRequest, NextApiResponse } from 'next';
import { getAddress, parseAbi, Hex, Address } from 'viem';
import { publicClient } from '../../../lib/viemClient';

export const FAUCET_CONTRACT_ADDRESS: Address = '0x5634bA278a0655F88432C6dFAC22338361bBaC00'; // NEW ADDRESS
export const FAUCET_FUNCTION_SIGNATURE: Hex = '0xde5f72fd'; // faucet()

// ABI for the faucet function (minimal for simulation)
export const faucetContractAbi = parseAbi([
  "function faucet() external",
  "function lastCalled(address) external view returns (uint256)", // Added for read contract
]);

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

        // --- SIMULATION LOGIC START ---
        try {
            await publicClient.simulateContract({
                address: FAUCET_CONTRACT_ADDRESS,
                abi: faucetContractAbi, // Use the defined ABI
                functionName: 'faucet',
                account: validatedUserAddress, // Simulate from the user's address
                // No args for faucet()
            });
            console.log("Faucet simulation successful for user:", validatedUserAddress);
        } catch (simulateError: any) {
            console.error("Faucet simulation failed:", simulateError);
            let errorMessage = "Transaction simulation failed.";
            if (simulateError.cause && typeof simulateError.cause === 'object' && 'reason' in simulateError.cause && simulateError.cause.reason) {
                // Prioritize the direct revert reason from the cause object
                errorMessage = simulateError.cause.reason;
            } else if (simulateError.shortMessage) {
                // Fallback to shortMessage if reason is not directly available in cause
                errorMessage = simulateError.shortMessage;
            } else if (simulateError.message) {
                errorMessage = simulateError.message;
            }

            // Specific adjustment for the daily limit message
            if (errorMessage.includes("Can only use the faucet once per day")) {
                errorMessage = "Can only claim once per day"; // User's desired exact text
            }

            return res.status(400).json({ // Use 400 for client-side issues like simulation failure
                message: 'Faucet claim not possible', // This message will be overridden by errorDetails on frontend
                errorDetails: errorMessage, // Pass the refined message as errorDetails
            });
        }
        // --- SIMULATION LOGIC END ---

        // Encode the function call (remains the same as faucet() takes no args)
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