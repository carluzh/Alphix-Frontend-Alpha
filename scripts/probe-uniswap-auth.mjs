#!/usr/bin/env node
// Diagnose auth + endpoint availability for Uniswap APIs.
// Tries Trading API /quote (known to work) and Liquidity API /lp/pool_info
// across several auth header variants and base URLs.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function loadEnv() {
  const path = join(process.cwd(), '.env.local');
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
loadEnv();

const KEY = process.env.UNISWAP_API_KEY;
console.log(`Key prefix: ${KEY.slice(0, 10)}…  len=${KEY.length}`);

const headerVariants = [
  { name: 'x-api-key', headers: { 'x-api-key': KEY } },
  { name: 'X-API-KEY', headers: { 'X-API-KEY': KEY } },
  { name: 'Authorization: Bearer', headers: { Authorization: `Bearer ${KEY}` } },
  { name: 'Authorization: Api-Key', headers: { Authorization: `Api-Key ${KEY}` } },
  { name: 'x-api-key + Origin', headers: { 'x-api-key': KEY, Origin: 'https://app.uniswap.org' } },
];

const probes = [
  {
    name: 'Trading API /quote',
    url: 'https://trade-api.gateway.uniswap.org/v1/quote',
    body: {
      tokenInChainId: 8453,
      tokenOutChainId: 8453,
      tokenIn: '0x0000000000000000000000000000000000000000',
      tokenOut: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      amount: '1000000000000000',
      type: 'EXACT_INPUT',
      swapper: '0x1111111111111111111111111111111111111111',
      protocols: ['V3', 'V2'],
    },
  },
  {
    name: 'LP /lp/pool_info (by poolId)',
    url: 'https://trade-api.gateway.uniswap.org/v1/lp/pool_info',
    body: { chainId: 8453, poolId: '0xebb666a5c6449b83536950b975d74deb32aca1537a501b58161a896816b04da6' },
  },
  {
    name: 'LP /lp/pool_info @ api.uniswap.org',
    url: 'https://api.uniswap.org/lp/pool_info',
    body: { chainId: 8453, poolId: '0xebb666a5c6449b83536950b975d74deb32aca1537a501b58161a896816b04da6' },
  },
  {
    name: 'LP @ liquidity.api.uniswap.org',
    url: 'https://liquidity.api.uniswap.org/lp/pool_info',
    body: { chainId: 8453, poolId: '0xebb666a5c6449b83536950b975d74deb32aca1537a501b58161a896816b04da6' },
  },
];

async function main() {
  for (const p of probes) {
    console.log(`\n=== ${p.name} ===`);
    console.log(`    ${p.url}`);
    for (const h of headerVariants) {
      try {
        const res = await fetch(p.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...h.headers },
          body: JSON.stringify(p.body),
        });
        const t = await res.text();
        const snippet = t.length > 140 ? t.slice(0, 140).replace(/\n/g, ' ') + '…' : t.replace(/\n/g, ' ');
        console.log(`  [${h.name.padEnd(24)}] ${res.status}  ${snippet}`);
      } catch (e) {
        console.log(`  [${h.name.padEnd(24)}] ERR ${e.message}`);
      }
    }
  }
}
main();
