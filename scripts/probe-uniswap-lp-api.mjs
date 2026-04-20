#!/usr/bin/env node
// Probe Uniswap Liquidity API for our Base pools with the DOCUMENTED schema.
// Goal: verify that /lp/* endpoints accept our custom-hooked V4 pools and
// return usable TransactionRequest objects.
//
// Base URL: https://api.uniswap.org    (per docs integration guide)
// Auth:     x-api-key: <key>

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function loadEnvLocal() {
  const path = join(ROOT, '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq < 0) continue;
    const k = s.slice(0, eq).trim();
    const v = s.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnvLocal();

const API_KEY = process.env.UNISWAP_API_KEY;
if (!API_KEY) { console.error('UNISWAP_API_KEY missing'); process.exit(1); }

// Discovered: the actual LP service runs at liquidity.api.uniswap.org, NOT api.uniswap.org.
// Discovered endpoints (POST):
//   /lp/check_approval   (not /lp/approve)
//   /lp/create
//   /lp/increase
//   /lp/decrease
//   /lp/claim_fees       (not /lp/claim or /lp/collect)
const BASE = process.env.LP_BASE_URL || 'https://liquidity.api.uniswap.org';
const EXTRA_HEADERS = {};
const WALLET = '0x1111111111111111111111111111111111111111';

const basePools = JSON.parse(readFileSync(join(ROOT, 'config/base_pools.json'), 'utf8'));
const CHAIN_ID = basePools.meta.chainId; // 8453
const targets = basePools.pools.filter((p) => !p.rehypoRange);

async function call(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, Accept: 'application/json', ...EXTRA_HEADERS },
    body: JSON.stringify(body),
  });
  const t = await res.text();
  let json; try { json = JSON.parse(t); } catch { json = t; }
  return { status: res.status, ok: res.ok, body: json };
}

function snippet(v, n = 300) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (!s) return '';
  return s.length > n ? s.slice(0, n).replace(/\n/g, ' ') + '…' : s.replace(/\n/g, ' ');
}

async function probeApprove(pool) {
  return call('/lp/check_approval', {
    walletAddress: WALLET,
    protocol: 'V4',
    chainId: CHAIN_ID,
    lpTokens: [
      { tokenAddress: pool.currency0.address, amount: '1000000000000000' },
      { tokenAddress: pool.currency1.address, amount: '1000000' },
    ],
    action: 'CREATE',
  });
}

async function probeCreate(pool) {
  // Use tick multiples of the pool's spacing. For wide range: ±120 * tickSpacing.
  const tickLower = -120 * pool.tickSpacing;
  const tickUpper = 120 * pool.tickSpacing;
  return call('/lp/create', {
    walletAddress: WALLET,
    existingPool: {
      token0Address: pool.currency0.address,
      token1Address: pool.currency1.address,
      poolReference: pool.poolId,
    },
    chainId: CHAIN_ID,
    protocol: 'V4',
    independentToken: {
      tokenAddress: pool.currency1.address,
      amount: '1000000',
    },
    tickBounds: { tickLower, tickUpper },
    simulateTransaction: false,
  });
}

async function probeIncrease(pool) {
  return call('/lp/increase', {
    walletAddress: WALLET,
    chainId: CHAIN_ID,
    protocol: 'V4',
    token0Address: pool.currency0.address,
    token1Address: pool.currency1.address,
    nftTokenId: '1',
    independentToken: {
      tokenAddress: pool.currency1.address,
      amount: '1000000',
    },
    simulateTransaction: false,
  });
}

async function probeDecrease(pool) {
  return call('/lp/decrease', {
    walletAddress: WALLET,
    chainId: CHAIN_ID,
    protocol: 'V4',
    token0Address: pool.currency0.address,
    token1Address: pool.currency1.address,
    nftTokenId: '1',
    liquidityPercentageToDecrease: 25,
    simulateTransaction: false,
  });
}

async function probeClaim(pool) {
  return call('/lp/claim_fees', {
    protocol: 'V4',
    walletAddress: WALLET,
    chainId: CHAIN_ID,
    tokenId: '1',
    simulateTransaction: false,
  });
}

async function main() {
  console.log(`BASE=${BASE}  key=${API_KEY.slice(0, 8)}…\n`);
  const summary = [];

  for (const pool of targets) {
    console.log(`=== ${pool.name}  hooks=${pool.hooks} ===`);
    const row = { pool: pool.name, hooks: pool.hooks };
    for (const [label, fn] of [
      ['approve', probeApprove],
      ['create', probeCreate],
      ['increase', probeIncrease],
      ['decrease', probeDecrease],
      ['claim', probeClaim],
    ]) {
      try {
        const r = await fn(pool);
        row[label] = r.ok ? 'OK' : r.status;
        const mark = r.ok ? 'PASS' : 'FAIL';
        console.log(`  ${label.padEnd(9)} ${mark} ${r.status}  ${snippet(r.body)}`);
      } catch (e) {
        row[label] = 'ERR';
        console.log(`  ${label.padEnd(9)} ERROR ${e.message}`);
      }
    }
    summary.push(row);
    console.log('');
  }

  console.log('=== SUMMARY ===');
  for (const r of summary) {
    console.log(`${r.pool.padEnd(14)} approve=${r.approve} create=${r.create} increase=${r.increase} decrease=${r.decrease} claim=${r.claim}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
