/**
 * Pool ID Verification Script
 *
 * This script verifies that the pool IDs (subgraphId) in pools.json
 * match the calculated pool IDs using keccak256 hash of pool parameters.
 *
 * Usage:
 *   npx tsx config/verify-pool-ids.ts
 */

import { ethers } from 'ethers';
import poolsConfig from './pools.json';

interface VerificationResult {
  poolId: string;
  poolName: string;
  configuredPoolId: string;
  calculatedPoolId: string;
  matches: boolean;
}

function calculatePoolId(
  currency0: string,
  currency1: string,
  fee: number,
  tickSpacing: number,
  hooks: string
): string {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint24', 'int24', 'address'],
      [currency0, currency1, fee, tickSpacing, hooks]
    )
  );
}

function verifyPoolIds(): VerificationResult[] {
  const results: VerificationResult[] = [];

  console.log('🔍 Verifying Pool IDs...\n');

  for (const pool of poolsConfig.pools) {
    const calculatedId = calculatePoolId(
      pool.currency0.address,
      pool.currency1.address,
      pool.fee,
      pool.tickSpacing,
      pool.hooks
    );

    const matches = calculatedId.toLowerCase() === pool.subgraphId.toLowerCase();

    const result: VerificationResult = {
      poolId: pool.id,
      poolName: pool.name,
      configuredPoolId: pool.subgraphId,
      calculatedPoolId: calculatedId,
      matches
    };

    if (matches) {
      console.log(`✅ ${pool.name} (${pool.id})`);
    } else {
      console.log(`❌ ${pool.name} (${pool.id})`);
      console.log(`   Currency0: ${pool.currency0.symbol} (${pool.currency0.address})`);
      console.log(`   Currency1: ${pool.currency1.symbol} (${pool.currency1.address})`);
      console.log(`   Fee: ${pool.fee} (0x${pool.fee.toString(16)})`);
      console.log(`   TickSpacing: ${pool.tickSpacing}`);
      console.log(`   Hooks: ${pool.hooks}`);
      console.log(`   Configured:  ${pool.subgraphId}`);
      console.log(`   Calculated:  ${calculatedId}`);
    }

    results.push(result);
  }

  return results;
}

function analyzePatterns() {
  console.log('\n═'.repeat(60));
  console.log('Pattern Analysis by Hook Address');
  console.log('═'.repeat(60));

  const hookGroups = poolsConfig.pools.reduce((acc, pool) => {
    const hook = pool.hooks.toLowerCase();
    if (!acc[hook]) acc[hook] = [];
    acc[hook].push(pool);
    return acc;
  }, {} as Record<string, typeof poolsConfig.pools>);

  for (const [hookAddress, pools] of Object.entries(hookGroups)) {
    console.log(`\nHook: ${hookAddress}`);
    pools.forEach(pool => {
      const calc = calculatePoolId(
        pool.currency0.address,
        pool.currency1.address,
        pool.fee,
        pool.tickSpacing,
        pool.hooks
      );
      const matches = calc.toLowerCase() === pool.subgraphId.toLowerCase();
      console.log(`  ${pool.name}: ${matches ? '✅ matches' : '❌ no match'}`);
    });
  }
}

async function main() {
  console.log('═'.repeat(60));
  console.log('Pool ID Verification');
  console.log('═'.repeat(60));
  console.log();

  const results = verifyPoolIds();

  console.log();
  console.log('═'.repeat(60));
  console.log('Summary');
  console.log('═'.repeat(60));

  const totalPools = results.length;
  const matchingPools = results.filter(r => r.matches).length;
  const mismatchedPools = totalPools - matchingPools;

  console.log(`Total pools: ${totalPools}`);
  console.log(`Matching: ${matchingPools}`);
  console.log(`Mismatched: ${mismatchedPools}`);

  if (mismatchedPools > 0) {
    analyzePatterns();
  }

  if (matchingPools === totalPools) {
    console.log('\n🎉 All pool IDs verified successfully!');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some pool IDs do not match. Please update pools.json.');
    process.exit(1);
  }
}

main().catch(console.error);
