/**
 * Test runner for iterative zap optimizer with tick simulation
 */

import { Token } from '@uniswap/sdk-core';
import { Pool as V4Pool } from '@uniswap/v4-sdk';
import JSBI from 'jsbi';
import { parseUnits, getAddress, parseAbi, type Hex } from 'viem';
import { publicClient } from '../lib/viemClient';
import { STATE_VIEW_ABI } from '../lib/abis/state_view_abi';
import poolsConfig from '../config/pools.json';
import { optimizeZapIterative } from './iterative-zap-optimizer';

const args = process.argv.slice(2);
const poolIdArg = args.find((arg, i) => args[i - 1] === '--pool')?.toLowerCase();
const inputTokenArg = args.find((arg, i) => args[i - 1] === '--input');
const amountArg = args.find((arg, i) => args[i - 1] === '--amount');

// Subgraph URL for fetching tick data
const SUBGRAPH_URL = process.env.SUBGRAPH_ORIGINAL_URL || process.env.NEXT_PUBLIC_SUBGRAPH_URL_DAI;

if (!SUBGRAPH_URL) {
  throw new Error('SUBGRAPH_URL environment variable is required');
}

/**
 * Fetches tick liquidity data from subgraph
 */
async function fetchTickPositions(poolSubgraphId: string, first: number = 1000) {
  const query = `
    query GetHookPositions($pool: Bytes!, $first: Int!) {
      hookPositions(
        first: $first,
        orderBy: liquidity,
        orderDirection: desc,
        where: { pool: $pool, liquidity_gt: "0" }
      ) {
        id
        pool
        tickLower
        tickUpper
        liquidity
      }
    }
  `;

  const response = await fetch(SUBGRAPH_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      variables: { pool: poolSubgraphId.toLowerCase(), first },
    }),
  });

  if (!response.ok) {
    throw new Error(`Subgraph query failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  if (json?.errors) {
    throw new Error(`Subgraph error: ${JSON.stringify(json.errors)}`);
  }

  const positions = Array.isArray(json?.data?.hookPositions) ? json.data.hookPositions : [];
  console.log(`Fetched ${positions.length} tick positions from subgraph`);

  return positions as Array<{
    id: string;
    pool: string;
    tickLower: number;
    tickUpper: number;
    liquidity: string;
  }>;
}

async function runTest(poolId: string, inputTokenSymbol: string, inputAmountStr: string) {
  console.log('\n' + '='.repeat(80));
  console.log(`Testing Iterative Zap Optimizer: ${poolId}`);
  console.log(`Input: ${inputAmountStr} ${inputTokenSymbol}`);
  console.log('='.repeat(80) + '\n');

  // Load pool config
  const pool = poolsConfig.pools.find((p) => p.id === poolId);
  if (!pool) throw new Error(`Pool ${poolId} not found`);

  const token0Symbol = pool.currency0.symbol;
  const token1Symbol = pool.currency1.symbol;
  const token0 = poolsConfig.tokens[token0Symbol as keyof typeof poolsConfig.tokens];
  const token1 = poolsConfig.tokens[token1Symbol as keyof typeof poolsConfig.tokens];

  console.log(`Pool: ${pool.name} (${pool.type})`);
  console.log(`Token0: ${token0.symbol} (${token0.decimals} decimals)`);
  console.log(`Token1: ${token1.symbol} (${token1.decimals} decimals)`);

  // Determine input token
  const isInput0 = inputTokenSymbol.toLowerCase() === token0.symbol.toLowerCase();
  const isInput1 = inputTokenSymbol.toLowerCase() === token1.symbol.toLowerCase();
  if (!isInput0 && !isInput1) {
    throw new Error(`Input token ${inputTokenSymbol} not in pool ${poolId}`);
  }

  const chainId = poolsConfig.meta.chainId;
  const inputTokenConfig = isInput0 ? token0 : token1;
  const otherTokenConfig = isInput0 ? token1 : token0;

  const sdkToken0 = new Token(chainId, getAddress(token0.address), token0.decimals, token0.symbol);
  const sdkToken1 = new Token(chainId, getAddress(token1.address), token1.decimals, token1.symbol);
  const inputToken = isInput0 ? sdkToken0 : sdkToken1;
  const otherToken = isInput0 ? sdkToken1 : sdkToken0;

  const inputAmount = parseUnits(inputAmountStr, inputTokenConfig.decimals);
  console.log(`\nParsed input: ${inputAmount.toString()} wei`);

  // Fetch pool state
  console.log('\nFetching pool state from chain...');
  const stateViewAbi = parseAbi(STATE_VIEW_ABI);
  const stateViewAddress = poolsConfig.contracts.stateView as `0x${string}`;
  const poolIdHex = pool.subgraphId as Hex;

  const [slot0, liquidity] = await Promise.all([
    publicClient.readContract({
      address: stateViewAddress,
      abi: stateViewAbi,
      functionName: 'getSlot0',
      args: [poolIdHex],
    }) as Promise<readonly [bigint, number, number, number]>,
    publicClient.readContract({
      address: stateViewAddress,
      abi: stateViewAbi,
      functionName: 'getLiquidity',
      args: [poolIdHex],
    }) as Promise<bigint>,
  ]);

  const [sqrtPriceX96, tick, protocolFee, lpFee] = slot0;
  const sqrtPriceX96_JSBI = JSBI.BigInt(sqrtPriceX96.toString());
  const liquidity_JSBI = JSBI.BigInt(liquidity.toString());

  const lpFeePercent = (lpFee / 1_000_000) * 100;
  const lpFeeBps = (lpFee / 1_000_000) * 10_000;

  console.log(`Current tick: ${tick}`);
  console.log(`Current sqrtPriceX96: ${sqrtPriceX96.toString()}`);
  console.log(`Pool liquidity: ${liquidity.toString()}`);
  console.log(`LP Fee: ${lpFeePercent.toFixed(4)}% (${lpFeeBps.toFixed(2)} bps, ${lpFee} millionths)`);

  // Fetch tick positions
  console.log('\nFetching tick liquidity data from subgraph...');
  const tickPositions = await fetchTickPositions(pool.subgraphId, 1000);

  if (tickPositions.length === 0) {
    throw new Error('No tick positions found. Pool may have no liquidity.');
  }

  // Analyze tick distribution
  const tickRanges = tickPositions.map(p => Math.abs(p.tickUpper - p.tickLower));
  const avgRange = tickRanges.reduce((a, b) => a + b, 0) / tickRanges.length;
  const maxRange = Math.max(...tickRanges);
  const minTick = Math.min(...tickPositions.map(p => p.tickLower));
  const maxTick = Math.max(...tickPositions.map(p => p.tickUpper));

  console.log(`Tick distribution: ${tickPositions.length} positions`);
  console.log(`  Range: [${minTick}, ${maxTick}] (span: ${maxTick - minTick} ticks)`);
  console.log(`  Avg position range: ${avgRange.toFixed(0)} ticks`);
  console.log(`  Max position range: ${maxRange} ticks`);

  // Create V4Pool
  const v4Pool = new V4Pool(
    sdkToken0,
    sdkToken1,
    pool.fee,
    pool.tickSpacing,
    pool.hooks,
    sqrtPriceX96_JSBI,
    liquidity_JSBI,
    tick
  );

  // Define position range
  const tickRange = 1000;
  const tickSpacing = pool.tickSpacing;
  const tickLower = Math.floor((tick - tickRange) / tickSpacing) * tickSpacing;
  const tickUpper = Math.ceil((tick + tickRange) / tickSpacing) * tickSpacing;
  console.log(`\nPosition range: [${tickLower}, ${tickUpper}]`);

  // Run optimization
  console.log('\n' + '-'.repeat(80));
  console.log('Running Iterative Zap Optimization (with Tick Simulation)...');
  console.log('-'.repeat(80) + '\n');

  const startTime = Date.now();
  const result = await optimizeZapIterative(
    {
      v4Pool,
      inputToken,
      otherToken,
      inputAmount,
      tickLower,
      tickUpper,
      poolConfig: pool,
      tickPositions,
      lpFeeMillionths: lpFee,
    },
    10, // max iterations
    0.01 // convergence threshold (0.01% price change)
  );
  const duration = Date.now() - startTime;

  // Display results
  console.log('\n' + '='.repeat(80));
  console.log('RESULTS');
  console.log('='.repeat(80));

  console.log(`\n⏱️  Duration: ${duration}ms`);
  console.log(`🔄 Iterations: ${result.iterations}`);
  console.log(`📊 Leftover: ${result.totalLeftoverPercent.toFixed(4)}%`);
  console.log(`💎 Utilization: ${(100 - result.totalLeftoverPercent).toFixed(4)}%`);
  console.log(`📈 Predicted Price Impact: ${result.predictedPriceImpactPercent.toFixed(4)}%`);

  const swapAmountFormatted = Number(result.optimalSwapAmount) / Math.pow(10, inputTokenConfig.decimals);
  const swapOutputFormatted = Number(result.swapOutput) / Math.pow(10, otherTokenConfig.decimals);

  console.log(`\n--- Swap Details ---`);
  console.log(`Swap Amount: ${swapAmountFormatted.toFixed(6)} ${inputTokenConfig.symbol}`);
  console.log(`Swap Output: ${swapOutputFormatted.toFixed(6)} ${otherTokenConfig.symbol}`);
  console.log(`LP Fee: ${lpFeePercent.toFixed(4)}%`);

  console.log(`\n--- Liquidity Position ---`);
  console.log(`Liquidity: ${result.position.liquidity.toString()}`);
  const amount0Used = result.position.mintAmounts.amount0.toString();
  const amount1Used = result.position.mintAmounts.amount1.toString();
  console.log(`Amount0 Used: ${(Number(amount0Used) / Math.pow(10, token0.decimals)).toFixed(6)} ${token0.symbol}`);
  console.log(`Amount1 Used: ${(Number(amount1Used) / Math.pow(10, token1.decimals)).toFixed(6)} ${token1.symbol}`);

  const leftover0Formatted = Number(result.leftover0) / Math.pow(10, token0.decimals);
  const leftover1Formatted = Number(result.leftover1) / Math.pow(10, token1.decimals);
  console.log(`Leftover Token0: ${leftover0Formatted.toFixed(6)} ${token0.symbol}`);
  console.log(`Leftover Token1: ${leftover1Formatted.toFixed(6)} ${token1.symbol}`);

  console.log(`\n--- Convergence History ---`);
  for (const entry of result.convergenceHistory) {
    const swapPct = (Number(entry.swapAmount) / Number(inputAmount) * 100).toFixed(4);
    console.log(`Iter ${entry.iteration}: swap ${swapPct}%, leftover ${entry.leftoverPercent.toFixed(4)}%`);
  }

  console.log('\n' + '='.repeat(80) + '\n');
}

async function main() {
  try {
    if (poolIdArg && inputTokenArg && amountArg) {
      await runTest(poolIdArg, inputTokenArg, amountArg);
    } else {
      // Default test
      console.log('Running default test...\n');
      await runTest('ausdc-ausdt', 'aUSDC', '1000');
    }

    console.log('✅ Test completed!\n');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

main();
