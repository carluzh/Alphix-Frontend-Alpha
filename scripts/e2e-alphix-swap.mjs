// End-to-end test: exercise the Alphix Universal Router swap path
// against an Arbitrum fork. The dev server's NEXT_PUBLIC_ARBITRUM_RPC_URL
// is overridden to localhost:8545 so all server-side simulations run on
// the fork too (no mainnet-vs-fork skew).
import { createWalletClient, createPublicClient, http, parseAbi, parseUnits, formatUnits, getAddress, encodeFunctionData, maxUint256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const APP = 'http://127.0.0.1:3344';
const RPC = 'http://127.0.0.1:8545';
const PK = '0x301cc58b17d350da8ccc80bd5a9214de51c19f13e2e429ea0235201999635bca';
const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const USDT = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

const chain = { id: 42161, name: 'arbitrum', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const account = privateKeyToAccount(PK);
const wallet = createWalletClient({ account, chain, transport: http(RPC) });
const pub = createPublicClient({ chain, transport: http(RPC) });
const erc20 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
]);

async function main() {
  console.log(`[wallet] ${account.address}`);
  const usdcBefore = await pub.readContract({ address: USDC, abi: erc20, functionName: 'balanceOf', args: [account.address] });
  const usdtBefore = await pub.readContract({ address: USDT, abi: erc20, functionName: 'balanceOf', args: [account.address] });
  console.log(`[balances] USDC=${formatUnits(usdcBefore, 6)}  USDT=${formatUnits(usdtBefore, 6)}`);

  // STEP 0: Ensure USDC is approved to Permit2 (one-time on chain)
  const a = await pub.readContract({ address: USDC, abi: erc20, functionName: 'allowance', args: [account.address, PERMIT2] });
  if (a < parseUnits('100', 6)) {
    console.log('approving USDC -> Permit2 (max)');
    const h = await wallet.sendTransaction({
      to: USDC,
      data: encodeFunctionData({ abi: erc20, functionName: 'approve', args: [PERMIT2, maxUint256] }),
      value: 0n,
    });
    await pub.waitForTransactionReceipt({ hash: h });
    console.log(`  approve tx: ${h}`);
  } else {
    console.log('already approved to Permit2');
  }

  // STEP 1: Get a quote
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
  console.log(`source=${qr.source} reason=${qr.selectionReason} out=${qr.toAmount}`);
  if (!qr.success) throw new Error(`quote failed: ${JSON.stringify(qr)}`);

  // STEP 2: prepare-permit (Permit2 signature for Universal Router)
  console.log('\n=== /api/swap/prepare-permit ===');
  const pr = await fetch(`${APP}/api/swap/prepare-permit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userAddress: account.address,
      fromTokenSymbol: 'USDC',
      fromTokenAddress: USDC,
      toTokenSymbol: 'USDT',
      chainId: 42161,
      amountIn: parseUnits('100', 6).toString(),
      approvalMode: 'infinite',
    }),
  }).then(r => r.json());
  if (!pr.ok) throw new Error(`prepare-permit failed: ${JSON.stringify(pr)}`);
  console.log(`needsPermit=${pr.needsPermit}`);

  // STEP 3: Sign permit (if needed)
  let permitSig = '0x';
  let permitData = { permitTokenAddress: USDC, permitAmount: '0', permitNonce: 0, permitExpiration: 0, permitSigDeadline: '0' };
  if (pr.needsPermit) {
    console.log('signing Permit2 typed data...');
    const m = pr.permitData.message;
    const typedMessage = {
      details: {
        token: getAddress(m.details.token),
        amount: BigInt(m.details.amount),
        expiration: m.details.expiration,
        nonce: m.details.nonce,
      },
      spender: getAddress(m.spender),
      sigDeadline: BigInt(m.sigDeadline),
    };
    permitSig = await wallet.signTypedData({
      account: account,
      domain: pr.permitData.domain,
      types: pr.permitData.types,
      primaryType: 'PermitSingle',
      message: typedMessage,
    });
    permitData = {
      permitTokenAddress: m.details.token,
      permitAmount: m.details.amount,
      permitNonce: m.details.nonce,
      permitExpiration: m.details.expiration,
      permitSigDeadline: m.sigDeadline,
    };
    console.log(`  signature: ${permitSig.slice(0, 18)}...`);
  }

  // STEP 4: build-tx (Alphix Universal Router path)
  console.log('\n=== /api/swap/build-tx (source=alphix) ===');
  const br = await fetch(`${APP}/api/swap/build-tx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userAddress: account.address,
      fromTokenSymbol: 'USDC', toTokenSymbol: 'USDT',
      swapType: 'ExactIn',
      amountDecimalsStr: '100',
      limitAmountDecimalsStr: '99',
      permitSignature: permitSig,
      permitTokenAddress: permitData.permitTokenAddress,
      permitAmount: permitData.permitAmount,
      permitNonce: permitData.permitNonce,
      permitExpiration: permitData.permitExpiration,
      permitSigDeadline: permitData.permitSigDeadline,
      chainId: 42161,
    }),
  }).then(r => r.json());
  if (!br.ok) throw new Error(`build-tx failed: ${JSON.stringify(br)}`);
  console.log(`router=${br.to}  commands=${br.commands ? 'present' : 'null'}  deadline=${br.deadline}`);

  // STEP 5: Encode + broadcast Universal Router execute()
  const execAbi = parseAbi([
    'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable',
  ]);
  const execData = encodeFunctionData({
    abi: execAbi,
    functionName: 'execute',
    args: [br.commands, br.inputs, BigInt(br.deadline)],
  });
  console.log('\n=== Broadcast Universal Router execute() ===');
  const swapHash = await wallet.sendTransaction({
    to: getAddress(br.to),
    data: execData,
    value: BigInt(br.value ?? '0'),
  });
  const rcpt = await pub.waitForTransactionReceipt({ hash: swapHash });
  console.log(`swap tx: ${swapHash}  status=${rcpt.status}  gas=${rcpt.gasUsed}`);

  // STEP 6: Verify deltas
  const usdcAfter = await pub.readContract({ address: USDC, abi: erc20, functionName: 'balanceOf', args: [account.address] });
  const usdtAfter = await pub.readContract({ address: USDT, abi: erc20, functionName: 'balanceOf', args: [account.address] });
  const usdcDelta = usdcBefore - usdcAfter;
  const usdtDelta = usdtAfter - usdtBefore;
  console.log(`\n[deltas] -${formatUnits(usdcDelta, 6)} USDC  +${formatUnits(usdtDelta, 6)} USDT`);
  if (usdcDelta !== parseUnits('100', 6)) throw new Error(`expected -100 USDC, got -${formatUnits(usdcDelta, 6)}`);
  if (usdtDelta === 0n) throw new Error('USDT delta = 0 — swap did not execute');
  console.log('\n✅ End-to-end Alphix Universal Router swap confirmed on Arbitrum fork.');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
