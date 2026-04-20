#!/usr/bin/env node
// Iteratively discover the /lp/create schema by observing validation errors.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function loadEnv() {
  const p = join(process.cwd(), '.env.local');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    process.env[s.slice(0, eq).trim()] = s.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
}
loadEnv();
const KEY = process.env.UNISWAP_API_KEY;
const BASE = 'https://liquidity.api.uniswap.org';

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': KEY },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  try {
    const j = JSON.parse(t);
    if (j.details?.[0]?.value) {
      j._decoded = Buffer.from(j.details[0].value, 'base64').toString('utf8');
    }
    return { status: r.status, body: j };
  } catch { return { status: r.status, body: t }; }
}

const POOL = {
  token0: '0x0000000000000000000000000000000000000000',
  token1: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  fee: 8388608,
  tickSpacing: 60,
  hooks: '0x7cBbfF9C4fcd74B221C535F4fB4B1Db04F1B9044',
  poolId: '0xebb666a5c6449b83536950b975d74deb32aca1537a501b58161a896816b04da6',
};

async function tryIt(label, body) {
  const r = await post('/lp/create', body);
  const msg = r.body?.message ?? r.body;
  console.log(`\n[${label}]  ${r.status}`);
  console.log(`  ${typeof msg === 'string' ? msg.slice(0, 300) : JSON.stringify(msg).slice(0, 300)}`);
  if (r.body?._decoded) console.log(`  decoded: ${r.body._decoded.slice(0, 400)}`);
}

async function main() {
  const baseHeader = {
    walletAddress: '0x1111111111111111111111111111111111111111',
    chainId: 8453,
    protocol: 'V4',
    independentToken: { tokenAddress: POOL.token1, amount: '1000000' },
    simulateTransaction: false,
  };

  // V4 with pool key inline
  await tryIt('pool: PoolKey inline', {
    ...baseHeader,
    pool: {
      token0Address: POOL.token0, token1Address: POOL.token1,
      fee: POOL.fee, tickSpacing: POOL.tickSpacing, hooks: POOL.hooks,
    },
    tickLower: -60000, tickUpper: 60000,
  });

  // V4 with pool + priceBounds
  await tryIt('pool + priceBounds', {
    ...baseHeader,
    pool: {
      token0Address: POOL.token0, token1Address: POOL.token1,
      fee: POOL.fee, tickSpacing: POOL.tickSpacing, hooks: POOL.hooks,
    },
    priceBounds: { minPrice: '1000', maxPrice: '5000' },
  });

  // V4 with newPool
  await tryIt('newPool', {
    ...baseHeader,
    newPool: {
      token0Address: POOL.token0, token1Address: POOL.token1,
      fee: POOL.fee, tickSpacing: POOL.tickSpacing, hooks: POOL.hooks,
    },
    tickLower: -60000, tickUpper: 60000,
    initialPrice: '3000',
  });

  // V4 with existingPool.poolId
  await tryIt('existingPool.poolId', {
    ...baseHeader,
    existingPool: { poolId: POOL.poolId },
    tickLower: -60000, tickUpper: 60000,
  });

  // V4 with existingPool + fee/tickSpacing/hooks
  await tryIt('existingPool full', {
    ...baseHeader,
    existingPool: {
      token0Address: POOL.token0, token1Address: POOL.token1,
      fee: POOL.fee, tickSpacing: POOL.tickSpacing, hooks: POOL.hooks,
    },
    tickLower: -60000, tickUpper: 60000,
  });

  // V4 with poolKey
  await tryIt('poolKey', {
    ...baseHeader,
    poolKey: {
      currency0: POOL.token0, currency1: POOL.token1,
      fee: POOL.fee, tickSpacing: POOL.tickSpacing, hooks: POOL.hooks,
    },
    tickLower: -60000, tickUpper: 60000,
  });

  // with OpenAPI-style definition
  await tryIt('positionDefinition', {
    ...baseHeader,
    position: {
      pool: {
        token0Address: POOL.token0, token1Address: POOL.token1,
        fee: POOL.fee, tickSpacing: POOL.tickSpacing, hooks: POOL.hooks,
      },
      tickLower: -60000, tickUpper: 60000,
    },
  });

  // DOC SHAPE: existingPool + priceBounds
  await tryIt('docs: existingPool+priceBounds', {
    walletAddress: '0x1111111111111111111111111111111111111111',
    existingPool: {
      token0Address: POOL.token0,
      token1Address: POOL.token1,
      poolReference: POOL.poolId,
    },
    chainId: 8453,
    protocol: 'V4',
    independentToken: { tokenAddress: POOL.token1, amount: '1000000' },
    priceBounds: { minPrice: '1000', maxPrice: '5000' },
    simulateTransaction: false,
  });

  // DOC SHAPE: existingPool + tickBounds
  await tryIt('docs: existingPool+tickBounds', {
    walletAddress: '0x1111111111111111111111111111111111111111',
    existingPool: {
      token0Address: POOL.token0,
      token1Address: POOL.token1,
      poolReference: POOL.poolId,
    },
    chainId: 8453,
    protocol: 'V4',
    independentToken: { tokenAddress: POOL.token1, amount: '1000000' },
    tickBounds: { tickLower: -60000, tickUpper: 60000 },
    simulateTransaction: false,
  });

  // Empty body — what fields are required?
  await tryIt('empty', {});
}

main().catch(e => { console.error(e); process.exit(1); });
