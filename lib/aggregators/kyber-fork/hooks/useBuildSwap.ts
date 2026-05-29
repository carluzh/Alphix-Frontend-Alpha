// Extracted from @kyberswap/widgets/src/components/Confirmation/index.tsx (v2.1.0, MIT).
// The /route/build → estimateGas → onSubmitTx pipeline as a reusable hook.
import { useCallback, useState } from 'react';
import { calculateGasMargin, estimateGas } from '../utils/crypto';
import { AGGREGATOR_PATH, NATIVE_TOKEN_ADDRESS } from '../constants';
import { useActiveWeb3 } from './useWeb3Provider';
import type { Trade } from './useSwap';
import { friendlyError } from '../utils/errorMessage';

export type BuildResult = {
  routerAddress: string;
  data: string;
  amountIn: string;
  amountOut: string;
  gas: string;
  gasUsd: string;
  outputChange?: { amount: string; percent: number; level: number };
};

type SubmitParams = {
  trade: Trade;
  slippage: number;        // in bps; 50 = 0.5%
  deadlineMinutes: number; // minutes
  tokenInAddress: string;
  client: string;
  feeSetting?: {
    chargeFeeBy: 'currency_in' | 'currency_out';
    feeAmount: number;
    feeReceiver: string;
    isInBps: boolean;
  };
};

export const useBuildSwap = () => {
  const { chainId, connectedAccount, rpcUrl, onSubmitTx } = useActiveWeb3();
  const [building, setBuilding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastBuildError, setLastBuildError] = useState<string | null>(null);
  const [lastBuildResult, setLastBuildResult] = useState<BuildResult | null>(null);

  const buildAndSubmit = useCallback(
    async ({ trade, slippage, deadlineMinutes, tokenInAddress, client, feeSetting }: SubmitParams): Promise<string> => {
      if (!connectedAccount.address) throw new Error('Wallet not connected');
      setLastBuildError(null);

      // 1. /route/build
      setBuilding(true);
      const deadlineSec = Math.floor(Date.now() / 1000) + deadlineMinutes * 60;
      let buildRes: any;
      try {
        const res = await fetch(
          `https://aggregator-api.kyberswap.com/${AGGREGATOR_PATH[chainId]}/api/v1/route/build`,
          {
            method: 'POST',
            headers: { 'x-client-id': client, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              routeSummary: trade.routeSummary,
              deadline: deadlineSec,
              slippageTolerance: slippage,
              sender: connectedAccount.address,
              recipient: connectedAccount.address,
              source: client,
              ...(feeSetting
                ? {
                    feeReceiver: feeSetting.feeReceiver,
                    feeAmount: feeSetting.feeAmount,
                    chargeFeeBy: feeSetting.chargeFeeBy,
                    isInBps: feeSetting.isInBps,
                  }
                : {}),
            }),
          },
        );
        buildRes = await res.json();
      } finally {
        setBuilding(false);
      }

      if (!buildRes?.data?.data) {
        const message = buildRes?.message || 'Failed to build swap route';
        setLastBuildError(message);
        throw new Error(message);
      }

      const result: BuildResult = {
        routerAddress: trade.routerAddress,
        data: buildRes.data.data,
        amountIn: buildRes.data.amountIn,
        amountOut: buildRes.data.amountOut,
        gas: buildRes.data.gas,
        gasUsd: buildRes.data.gasUsd,
        outputChange: buildRes.data.outputChange,
      };
      setLastBuildResult(result);

      // 2. estimateGas
      const value =
        '0x' +
        BigInt(tokenInAddress.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase() ? trade.routeSummary.amountIn : 0).toString(16);
      const estimateGasOption = {
        from: connectedAccount.address,
        to: trade.routerAddress,
        value,
        data: buildRes.data.data as string,
      };

      let gasEstimated = 0n;
      try {
        gasEstimated = await estimateGas(rpcUrl, estimateGasOption);
      } catch (e: any) {
        const message = friendlyError(e?.message || String(e));
        setLastBuildError(message);
        throw new Error(message);
      }

      // 3. sign + broadcast
      setSubmitting(true);
      try {
        const hash = await onSubmitTx({
          ...estimateGasOption,
          gasLimit: calculateGasMargin(gasEstimated),
        });
        return hash;
      } catch (e: any) {
        const message = friendlyError(e?.message || String(e));
        setLastBuildError(message);
        throw new Error(message);
      } finally {
        setSubmitting(false);
      }
    },
    [chainId, connectedAccount.address, rpcUrl, onSubmitTx],
  );

  return { buildAndSubmit, building, submitting, lastBuildError, lastBuildResult };
};
