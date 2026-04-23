'use client';

import { useAccount } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { createNetworkClient } from '@/lib/viemClient';
import type { Address } from 'viem';

// USDS/USDC pool has been sunset on alphix.fi. Current LPs are redirected to
// migrate.alphix.fi to withdraw. Hook IS the share ERC20, so balanceOf reveals
// any remaining LP — shown until balance reaches zero.
const LEGACY_POOL = {
  hookAddress: '0x0e4b892Df7C5Bcf5010FAF4AA106074e555660C0' as Address,
  migrateUrl: 'https://migrate.alphix.fi/liquidity/usds-usdc?chain=base',
  discordUrl: 'https://discord.gg/NTXRarFbTr',
};

const BALANCE_OF_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export function LegacyPoolNotice() {
  const { address, isConnected } = useAccount();

  const { data: shareBalance } = useQuery({
    queryKey: ['legacyPoolBalance', LEGACY_POOL.hookAddress, address],
    enabled: isConnected && !!address,
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<bigint> => {
      if (!address) return 0n;
      const client = createNetworkClient('base');
      const balance = await client.readContract({
        address: LEGACY_POOL.hookAddress,
        abi: BALANCE_OF_ABI,
        functionName: 'balanceOf',
        args: [address],
      });
      return balance as bigint;
    },
  });

  const hasLegacyLiquidity = typeof shareBalance === 'bigint' && shareBalance > 0n;

  if (!isConnected || !hasLegacyLiquidity) return null;

  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-1.5rem)] max-w-md px-3 sm:bottom-6 sm:px-0">
      <div className="rounded-lg border border-sidebar-border/60 bg-sidebar p-3 shadow-2xl">
        <p className="text-xs sm:text-sm text-muted-foreground leading-snug">
          We delisted the USDS/USDC pool. You were one of the few LPs with an active balance. To withdraw these funds please head over to{' '}
          <a
            href={LEGACY_POOL.migrateUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline decoration-foreground/40 underline-offset-2 hover:decoration-foreground transition-colors"
          >
            migrate.alphix.fi
          </a>
          . For more information join our{' '}
          <a
            href={LEGACY_POOL.discordUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline decoration-foreground/40 underline-offset-2 hover:decoration-foreground transition-colors"
          >
            Discord
          </a>
          .
        </p>
      </div>
    </div>
  );
}

export default LegacyPoolNotice;
