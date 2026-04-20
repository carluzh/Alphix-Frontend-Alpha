#!/usr/bin/env node
// Decode the base64-encoded error details from the LP API.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function loadEnv() {
  const p = join(process.cwd(), '.env.local');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); const v = s.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnv();
const KEY = process.env.UNISWAP_API_KEY;
const BASE = 'https://liquidity.api.uniswap.org';

async function call(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': KEY },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  try {
    const j = JSON.parse(t);
    if (j.details?.[0]?.value) {
      j.decodedDetails = Buffer.from(j.details[0].value, 'base64').toString('utf8');
    }
    return { status: r.status, body: j };
  } catch {
    return { status: r.status, body: t };
  }
}

async function main() {
  // CREATE: try variations to discover schema
  console.log('--- CREATE schema probe ---');
  const attempts = [
    {
      label: 'tickPrice.minPrice/maxPrice',
      body: {
        walletAddress: '0x1111111111111111111111111111111111111111',
        existingPool: { token0Address: '0x0000000000000000000000000000000000000000', token1Address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
        chainId: 8453, protocol: 'V4',
        independentToken: { tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '1000000' },
        tickPrice: { minPrice: '0.0001', maxPrice: '100000' },
      },
    },
    {
      label: 'tickPrice object',
      body: {
        walletAddress: '0x1111111111111111111111111111111111111111',
        existingPool: { token0Address: '0x0000000000000000000000000000000000000000', token1Address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
        chainId: 8453, protocol: 'V4',
        independentToken: { tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '1000000' },
        tickPrice: { tickLower: -60000, tickUpper: 60000 },
      },
    },
    {
      label: 'tickPrice.minTick/maxTick',
      body: {
        walletAddress: '0x1111111111111111111111111111111111111111',
        existingPool: { token0Address: '0x0000000000000000000000000000000000000000', token1Address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
        chainId: 8453, protocol: 'V4',
        independentToken: { tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '1000000' },
        tickPrice: { minTick: -60000, maxTick: 60000 },
      },
    },
    {
      label: 'tickRange separate',
      body: {
        walletAddress: '0x1111111111111111111111111111111111111111',
        existingPool: { token0Address: '0x0000000000000000000000000000000000000000', token1Address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
        chainId: 8453, protocol: 'V4',
        independentToken: { tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '1000000' },
        tickLower: -60000, tickUpper: 60000,
      },
    },
  ];
  for (const a of attempts) {
    const r = await call('/lp/create', a.body);
    const msg = r.body?.message ?? r.body;
    const dec = r.body?.decodedDetails ?? '';
    console.log(`  ${a.label.padEnd(32)} ${r.status}  ${typeof msg === 'string' ? msg.slice(0, 200) : JSON.stringify(msg).slice(0, 200)}`);
    if (dec) console.log(`    decoded: ${dec.slice(0, 300)}`);
  }

  console.log('\n--- APPROVE path probe ---');
  const approveBody = {
    walletAddress: '0x1111111111111111111111111111111111111111',
    protocol: 'V4', chainId: 8453,
    lpTokens: [{ tokenAddress: '0x0000000000000000000000000000000000000000', amount: '1000000000000000' }],
    action: 'CREATE',
  };
  for (const p of ['/lp/approve', '/approve', '/lp/check_approval', '/check_approval']) {
    const r = await call(p, approveBody);
    const msg = r.body?.message ?? (typeof r.body === 'string' ? r.body.slice(0, 120) : JSON.stringify(r.body).slice(0, 120));
    const dec = r.body?.decodedDetails ?? '';
    console.log(`  ${p.padEnd(24)} ${r.status}  ${msg}`);
    if (dec) console.log(`    decoded: ${dec.slice(0, 300)}`);
  }

  console.log('\n--- CLAIM path probe ---');
  const claimBody = { protocol: 'V4', walletAddress: '0x1111111111111111111111111111111111111111', chainId: 8453, tokenId: '1' };
  for (const p of ['/lp/claim', '/lp/collect', '/lp/collect_fees', '/claim', '/collect']) {
    const r = await call(p, claimBody);
    const msg = r.body?.message ?? (typeof r.body === 'string' ? r.body.slice(0, 120) : JSON.stringify(r.body).slice(0, 120));
    const dec = r.body?.decodedDetails ?? '';
    console.log(`  ${p.padEnd(24)} ${r.status}  ${msg}`);
    if (dec) console.log(`    decoded: ${dec.slice(0, 300)}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
