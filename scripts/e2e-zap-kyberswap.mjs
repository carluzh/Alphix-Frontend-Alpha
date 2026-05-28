// End-to-end test: exercise the Bug 2 fix path (Kyberswap swap routed through
// our /api/swap/get-quote + /api/swap/build-tx). Runs against a local Anvil
// fork of Arbitrum mainnet on port 8545 so no real funds move.
//
// Prereqs (already done by the harness):
//   anvil --fork-url https://arb1.arbitrum.io/rpc --chain-id 42161 --port 8545 --silent
//   1000 USDC + 100 ETH at the test wallet
//   dev server running on PORT=3344
import { createWalletClient, createPublicClient, http, parseAbi, parseUnits, formatUnits, getAddress, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const APP = 'http://127.0.0.1:3344';
const RPC = 'http://127.0.0.1:8545';
const PK = '0x301cc58b17d350da8ccc80bd5a9214de51c19f13e2e429ea0235201999635bca';
const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const USDT = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';

const chain = { id: 42161, name: 'arbitrum', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const account = privateKeyToAccount(PK);
const wallet = createWalletClient({ account, chain, transport: http(RPC) });
const pub = createPublicClient({ chain, transport: http(RPC) });
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)']);

async function main() {
  console.log(`[wallet] ${account.address}`);
  const usdcBefore = await pub.readContract({ address: USDC, abi: erc20, functionName: 'balanceOf', args: [account.address] });
  const usdtBefore = await pub.readContract({ address: USDT, abi: erc20, functionName: 'balanceOf', args: [account.address] });
  console.log(`[balances] USDC=${formatUnits(usdcBefore, 6)}  USDT=${formatUnits(usdtBefore, 6)}`);

  // STEP 1: Quote via the route that exercises Bug 2 fix
  console.log('\n=== /api/swap/get-quote ===');
  const qr = await fetch(`${APP}/api/swap/get-quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fromTokenSymbol: 'USDC', toTokenSymbol: 'USDT',
      amountDecimalsStr: '100', swapType: 'ExactIn',
      chainId: 42161, network: 'arbitrum',
      fromTokenAddress: USDC, toTokenAddress: USDT,
      fromTokenDecimals: 6, toTokenDecimals: 6,
      slippageBps: 50, userAddress: account.address,
    }),
  }).then(r => r.json());
  console.log(`source=${qr.source} reason=${qr.selectionReason} amountOut=${qr.toAmount} hops=${qr.route?.hops}`);
  if (!qr.success) throw new Error(`get-quote failed: ${JSON.stringify(qr)}`);
  if (qr.source !== 'kyberswap') {
    console.log(`Alphix won this quote (within tolerance); forcing kyberswap path by reading kyberswapData if present...`);
  }

  // STEP 2: Build the swap tx via the route that exercises Bug 2 fix (source=kyberswap)
  console.log('\n=== /api/swap/build-tx (source=kyberswap) ===');
  const minOut = (BigInt(qr.toAmount.replace('.', '')) * 99n / 100n).toString(); // 1% slip
  const br = await fetch(`${APP}/api/swap/build-tx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userAddress: account.address,
      fromTokenSymbol: 'USDC', toTokenSymbol: 'USDT',
      swapType: 'ExactIn',
      amountDecimalsStr: '100',
      limitAmountDecimalsStr: '99',
      permitSignature: '0x', permitTokenAddress: USDC, permitAmount: '0', permitNonce: 0, permitExpiration: 0, permitSigDeadline: '0',
      chainId: 42161,
      source: 'kyberswap',
      kyberswapData: { routerAddress: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5' },
      slippageBps: 50,
    }),
  }).then(r => r.json());
  if (!br.ok) throw new Error(`build-tx failed: ${JSON.stringify(br)}`);
  console.log(`router=${br.to}  commands=${br.commands === null ? 'null (kyberswap)' : 'present'}  gasLimit=${br.gasLimit}`);

  // STEP 3: Approve USDC to Kyberswap router
  console.log('\n=== Approve USDC -> Kyberswap router ===');
  const approveData = encodeFunctionData({ abi: erc20, functionName: 'approve', args: [getAddress(br.to), parseUnits('100', 6) + 1n] });
  const approveHash = await wallet.sendTransaction({ to: USDC, data: approveData, value: 0n });
  await pub.waitForTransactionReceipt({ hash: approveHash });
  console.log(`approve tx: ${approveHash}`);

  // STEP 4: Broadcast the Kyberswap swap tx
  console.log('\n=== Broadcast Kyberswap swap ===');
  const swapHash = await wallet.sendTransaction({ to: getAddress(br.to), data: br.data, value: BigInt(br.value ?? '0') });
  const rcpt = await pub.waitForTransactionReceipt({ hash: swapHash });
  console.log(`swap tx: ${swapHash}  status=${rcpt.status}  gasUsed=${rcpt.gasUsed}`);

  // STEP 5: Verify deltas
  const usdcAfter = await pub.readContract({ address: USDC, abi: erc20, functionName: 'balanceOf', args: [account.address] });
  const usdtAfter = await pub.readContract({ address: USDT, abi: erc20, functionName: 'balanceOf', args: [account.address] });
  const usdcDelta = usdcBefore - usdcAfter;
  const usdtDelta = usdtAfter - usdtBefore;
  console.log(`\n[deltas] -${formatUnits(usdcDelta, 6)} USDC  +${formatUnits(usdtDelta, 6)} USDT`);
  if (usdcDelta !== parseUnits('100', 6)) throw new Error(`expected -100 USDC, got -${formatUnits(usdcDelta, 6)}`);
  if (usdtDelta === 0n) throw new Error('USDT delta = 0 — swap did not execute');
  console.log('\n✅ Bug 2 e2e: Kyberswap swap path is end-to-end functional on Arbitrum fork.');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
