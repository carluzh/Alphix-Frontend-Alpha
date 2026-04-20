#!/usr/bin/env node
// Find the real /claim endpoint path.
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

async function post(path, body = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': KEY },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; }
  catch { return { status: r.status, body: t }; }
}
async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { 'x-api-key': KEY } });
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; }
  catch { return { status: r.status, body: t.slice(0, 200) }; }
}

async function main() {
  console.log('--- GET discovery ---');
  for (const p of ['/', '/lp', '/lp/', '/openapi.json', '/swagger.json', '/lp/openapi.json', '/docs', '/lp/docs']) {
    const r = await get(p);
    const snippet = typeof r.body === 'string' ? r.body : JSON.stringify(r.body).slice(0, 120);
    console.log(`  GET ${p.padEnd(22)} ${r.status}  ${snippet.slice(0, 120).replace(/\n/g, ' ')}`);
  }

  console.log('\n--- POST claim paths ---');
  const body = { protocol: 'V4', walletAddress: '0x1111111111111111111111111111111111111111', chainId: 8453, tokenId: '1' };
  for (const p of ['/lp/claim_fees', '/lp/claimFees', '/lp/claim-fees', '/lp/claim_rewards', '/lp/claimRewards',
                   '/lp/fees', '/lp/position/claim', '/lp/positions/claim', '/lp/position_fees',
                   '/lp/claim_position', '/lp/claim/v4', '/lp/v4/claim', '/lp/earn', '/lp/harvest']) {
    const r = await post(p, body);
    const snippet = r.body?.message ?? (typeof r.body === 'string' ? r.body.slice(0, 120) : JSON.stringify(r.body).slice(0, 120));
    console.log(`  ${p.padEnd(24)} ${r.status}  ${snippet}`);
  }

  console.log('\n--- POST check_approval variants for claim ---');
  // Maybe claim is a verb on check_approval? Unlikely but test.
  const ca = await post('/lp/check_approval', { walletAddress: '0x1111111111111111111111111111111111111111', chainId: 8453, protocol: 'V4', action: 'CLAIM', tokenId: '1' });
  console.log(`  action=CLAIM  ${ca.status}  ${JSON.stringify(ca.body).slice(0, 200)}`);
}
main();
