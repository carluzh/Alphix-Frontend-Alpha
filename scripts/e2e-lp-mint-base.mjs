// End-to-end test: mint a new ETH/USDC position on Base via Uniswap LP API.
// Exercises the Bug 1 fix path — backend forwards Uniswap's approve transactions
// verbatim instead of decoding + re-encoding them. Runs entirely against a Base
// fork on :8546, with the Next.js server pointed at the fork via
// NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8546.
import { createWalletClient, createPublicClient, http, parseAbi, parseUnits, parseEther, formatUnits, formatEther, getAddress, maxUint256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const APP = 'http://127.0.0.1:3344';
const RPC = 'http://127.0.0.1:8546';
const PK = '0x301cc58b17d350da8ccc80bd5a9214de51c19f13e2e429ea0235201999635bca';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
// V4 PositionManager NFT (Base mainnet)
const POS_MANAGER = '0x7C5f5A4bBd8fD63184577525326123B519429bDc';

const chain = { id: 8453, name: 'base', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const account = privateKeyToAccount(PK);
const wallet = createWalletClient({ account, chain, transport: http(RPC) });
const pub = createPublicClient({ chain, transport: http(RPC) });

const erc20 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
]);
const posMgr = parseAbi([
  'function balanceOf(address) view returns (uint256)',
]);

async function main() {
  console.log(`[wallet] ${account.address}`);
  const eth0 = await pub.getBalance({ address: account.address });
  const usdc0 = await pub.readContract({ address: USDC, abi: erc20, functionName: 'balanceOf', args: [account.address] });
  const nfts0 = await pub.readContract({ address: POS_MANAGER, abi: posMgr, functionName: 'balanceOf', args: [account.address] });
  console.log(`[balances] ETH=${formatEther(eth0)}  USDC=${formatUnits(usdc0, 6)}  V4-NFTs=${nfts0}`);

  // STEP 1: prepare-mint-tx — supply ETH as input, Uniswap computes USDC counterpart.
  // ETH/USDC on Base: tickSpacing=60, dynamic fee.
  // Use a wide range centered on the current price. Snap to tickSpacing=60.
  const TICK_LOWER = -887220; // floor(-887272 / 60) * 60
  const TICK_UPPER = 887220;
  const inputAmount = '0.001'; // 0.001 ETH
  const inputTokenSymbol = 'ETH';

  console.log('\n=== /api/liquidity/prepare-mint-tx (initial call, no permit) ===');
  let pr = await fetch(`${APP}/api/liquidity/prepare-mint-tx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userAddress: account.address,
      poolId: 'eth-usdc',
      token0Symbol: 'ETH',
      token1Symbol: 'USDC',
      inputAmount,
      inputTokenSymbol,
      userTickLower: TICK_LOWER,
      userTickUpper: TICK_UPPER,
      chainId: 8453,
      slippageBps: 50,
      deadlineMinutes: 30,
    }),
  }).then(r => r.json());
  console.log(`needsApproval=${pr.needsApproval}  approvalType=${pr.approvalType}  hasCreate=${!!pr.create}`);
  console.log(`approveToken0Tx? ${!!pr.approveToken0Tx}  approveToken1Tx? ${!!pr.approveToken1Tx}`);
  if (pr.message) throw new Error(`prepare-mint-tx error: ${pr.message}`);

  // STEP 2: execute on-chain approval(s) if Uniswap surfaced any
  for (const [label, txObj] of [['token0', pr.approveToken0Tx], ['token1', pr.approveToken1Tx]]) {
    if (!txObj) continue;
    console.log(`approving ${label}: to=${txObj.to} value=${txObj.value}  data=${txObj.data.slice(0, 18)}...`);
    const h = await wallet.sendTransaction({
      to: getAddress(txObj.to),
      data: txObj.data,
      value: BigInt(txObj.value ?? '0'),
    });
    const rcpt = await pub.waitForTransactionReceipt({ hash: h });
    console.log(`  -> tx ${h}  status=${rcpt.status}`);
  }

  // STEP 3: If a Permit2 batch signature is needed, sign + resubmit
  let createTx = pr.create;
  if (pr.needsApproval && pr.approvalType === 'PERMIT2_BATCH_SIGNATURE') {
    console.log('\n=== sign Permit2 batch ===');
    const sigDetails = pr.signatureDetails;
    const permitData = pr.permitBatchData;
    const signature = await wallet.signTypedData({
      account: account,
      domain: { ...sigDetails.domain, chainId: sigDetails.domain.chainId },
      types: sigDetails.types,
      primaryType: sigDetails.primaryType,
      message: permitData.values,
    });
    console.log(`  signature: ${signature.slice(0, 18)}...`);

    console.log('\n=== /api/liquidity/prepare-mint-tx (with signature) ===');
    pr = await fetch(`${APP}/api/liquidity/prepare-mint-tx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userAddress: account.address,
        poolId: 'eth-usdc',
        token0Symbol: 'ETH',
        token1Symbol: 'USDC',
        inputAmount,
        inputTokenSymbol,
        userTickLower: TICK_LOWER,
        userTickUpper: TICK_UPPER,
        chainId: 8453,
        slippageBps: 50,
        deadlineMinutes: 30,
        permitSignature: signature,
        permitBatchData: permitData,
      }),
    }).then(r => r.json());
    if (pr.message) throw new Error(`prepare-mint-tx (signed) error: ${pr.message}`);
    if (!pr.create) throw new Error(`expected create tx, got: ${JSON.stringify(pr).slice(0, 200)}`);
    createTx = pr.create;
  }

  // STEP 4: Broadcast the create tx
  console.log('\n=== Broadcast PositionManager mint ===');
  console.log(`  to=${createTx.to}  value=${createTx.value}  data=${createTx.data.slice(0, 18)}...`);
  const mintHash = await wallet.sendTransaction({
    to: getAddress(createTx.to),
    data: createTx.data,
    value: BigInt(createTx.value ?? '0'),
  });
  const rcpt = await pub.waitForTransactionReceipt({ hash: mintHash });
  console.log(`  -> mint tx ${mintHash}  status=${rcpt.status}  gas=${rcpt.gasUsed}`);
  if (rcpt.status !== 'success') throw new Error('mint tx reverted');

  // STEP 5: Verify position NFT
  const nfts1 = await pub.readContract({ address: POS_MANAGER, abi: posMgr, functionName: 'balanceOf', args: [account.address] });
  const eth1 = await pub.getBalance({ address: account.address });
  const usdc1 = await pub.readContract({ address: USDC, abi: erc20, functionName: 'balanceOf', args: [account.address] });
  const ethDelta = eth0 - eth1;
  const usdcDelta = usdc0 - usdc1;
  console.log(`\n[balances after] ETH=${formatEther(eth1)} (-${formatEther(ethDelta)})  USDC=${formatUnits(usdc1, 6)} (-${formatUnits(usdcDelta, 6)})  V4-NFTs=${nfts1}`);
  if (nfts1 <= nfts0) throw new Error(`expected new V4 position NFT; before=${nfts0} after=${nfts1}`);
  console.log('\n✅ Bug 1 e2e: LP API mint with verbatim-forwarded approvals + Permit2 sig executed on Base fork. New V4 position NFT minted.');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
