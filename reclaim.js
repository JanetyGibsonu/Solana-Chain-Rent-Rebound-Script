/**
 * Solana 空账户租金回收工具
 * 功能：
 *  1. 从 Excel 表格读取私钥列表
 *  2. 查询每个钱包的空 Token 账户（可回收租金）
 *  3. 通过资金钱包转少量 SOL 作为 gas
 *  4. 关闭空 Token 账户，回收租金到原钱包
 *  5. 将回收到的 SOL 转回资金钱包
 */

const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} = require("@solana/web3.js");
const {
  TOKEN_PROGRAM_ID,
  createCloseAccountInstruction,
} = require("@solana/spl-token");
const bs58 = require("bs58");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// ─── 配置区 ───────────────────────────────────────────────────────────────────
const CONFIG = {
  // RPC 节点（可换成付费节点以提高稳定性）
  RPC_URL: "https://mainnet.helius-rpc.com/?api-key=填入https://dashboard.helius.dev/的kye",

  // Excel 文件路径（脚本同目录下的 wallets.xlsx）
  EXCEL_FILE: path.join(__dirname, "wallets.xlsx"),

  // Excel 中私钥所在的列名（默认 "私钥"，可改为 "PrivateKey" 等）
  PRIVATE_KEY_COLUMN: "私钥",

  // 每次操作之间的延迟（毫秒），避免 RPC 限速
  DELAY_MS: 1,

  // 预留在原钱包的最小 SOL（lamports），防止账户被清空
  KEEP_LAMPORTS: 5000,

  // 资金钱包私钥（Base58 格式），用于发送 gas 费
  // 留空则脚本只做【查询】，不执行回收
  FUND_WALLET_PRIVATE_KEY: "填入你的资金钱包私钥",
};
// ─────────────────────────────────────────────────────────────────────────────

const connection = new Connection(CONFIG.RPC_URL, "confirmed");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 从 Base58 或 Uint8Array JSON 字符串加载 Keypair
function loadKeypair(rawKey) {
  rawKey = rawKey.trim();
  try {
    // 尝试 Base58
    const decoded = bs58.default ? bs58.default.decode(rawKey) : bs58.decode(rawKey);
    return Keypair.fromSecretKey(decoded);
  } catch (_) {}
  try {
    // 尝试 JSON 数组 [1,2,3,...]
    const arr = JSON.parse(rawKey);
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  } catch (_) {}
  throw new Error(`无法解析私钥: ${rawKey.slice(0, 10)}...`);
}

// 读取 Excel 中的私钥列表
function readWalletsFromExcel(filePath, column) {
  if (!fs.existsSync(filePath)) {
    console.error(`\n❌ 找不到文件: ${filePath}`);
    console.error(`请在脚本同目录下创建 wallets.xlsx，第一行包含列名 "${column}"，下方每行填写一个私钥。\n`);
    process.exit(1);
  }
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws);
  const keys = rows.map((r, i) => {
    const val = r[column];
    if (!val) throw new Error(`第 ${i + 2} 行缺少列 "${column}"`);
    return String(val).trim();
  });
  return keys;
}

// 查询钱包下所有空 Token 账户（余额为 0）
async function findEmptyTokenAccounts(walletPubkey) {
  const accounts = await connection.getParsedTokenAccountsByOwner(walletPubkey, {
    programId: TOKEN_PROGRAM_ID,
  });

  const empty = accounts.value.filter((a) => {
    const amount = a.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 1;
    return amount === 0;
  });

  return empty.map((a) => ({
    pubkey: a.pubkey,
    lamports: a.account.lamports,
    mint: a.account.data.parsed?.info?.mint ?? "unknown",
  }));
}

// 关闭一批空 Token 账户，将租金归还到 destination
async function closeAccounts(walletKeypair, emptyAccounts, destinationPubkey) {
  if (emptyAccounts.length === 0) return 0;

  const BATCH = 15; // 每笔交易最多关闭 15 个账户
  let totalReclaimed = 0;

  for (let i = 0; i < emptyAccounts.length; i += BATCH) {
    const batch = emptyAccounts.slice(i, i + BATCH);
    const tx = new Transaction();

    for (const acc of batch) {
      tx.add(
        createCloseAccountInstruction(
          acc.pubkey,
          destinationPubkey,
          walletKeypair.publicKey,
          [],
          TOKEN_PROGRAM_ID
        )
      );
    }

    try {
      await sendAndConfirmTransaction(connection, tx, [walletKeypair], {
        commitment: "confirmed",
      });
      const reclaimed = batch.reduce((s, a) => s + a.lamports, 0);
      totalReclaimed += reclaimed;
      console.log(
        `    ✅ 关闭 ${batch.length} 个账户，回收 ${(reclaimed / LAMPORTS_PER_SOL).toFixed(6)} SOL`
      );
    } catch (e) {
      console.error(`    ❌ 批次失败: ${e.message}`);
    }

    await sleep(CONFIG.DELAY_MS);
  }

  return totalReclaimed;
}

// 从 from 向 to 转账 SOL
async function transferSOL(fromKeypair, toPubkey, lamports) {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: fromKeypair.publicKey,
      toPubkey,
      lamports,
    })
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [fromKeypair], {
    commitment: "confirmed",
  });
  return sig;
}

// ── 主流程 ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("      Solana 空 Token 账户租金回收工具");
  console.log("═══════════════════════════════════════════════════\n");

  // 读取私钥列表
  const rawKeys = readWalletsFromExcel(CONFIG.EXCEL_FILE, CONFIG.PRIVATE_KEY_COLUMN);
  console.log(`📋 从 Excel 读取到 ${rawKeys.length} 个钱包\n`);

  // 解析所有 Keypair
  const wallets = [];
  for (const raw of rawKeys) {
    try {
      wallets.push(loadKeypair(raw));
    } catch (e) {
      console.warn(`⚠️  跳过无效私钥: ${e.message}`);
    }
  }

  // ── 第一步：扫描所有钱包 ──────────────────────────────────────────────────
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  第一步：扫描空 Token 账户");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const scanResults = [];
  let totalReclaimable = 0;

  for (const kp of wallets) {
    const addr = kp.publicKey.toBase58();
    process.stdout.write(`  🔍 ${addr.slice(0, 8)}...${addr.slice(-6)}  `);

    try {
      const empty = await findEmptyTokenAccounts(kp.publicKey);
      const reclaimable = empty.reduce((s, a) => s + a.lamports, 0);
      totalReclaimable += reclaimable;

      if (empty.length > 0) {
        console.log(
          `找到 ${empty.length} 个空账户，可回收 ${(reclaimable / LAMPORTS_PER_SOL).toFixed(6)} SOL`
        );
      } else {
        console.log("无可回收账户");
      }

      scanResults.push({ keypair: kp, emptyAccounts: empty, reclaimable });
    } catch (e) {
      console.log(`查询失败: ${e.message}`);
      scanResults.push({ keypair: kp, emptyAccounts: [], reclaimable: 0 });
    }

    await sleep(CONFIG.DELAY_MS);
  }

  const walletsWithReclaim = scanResults.filter((r) => r.emptyAccounts.length > 0);

  console.log(`\n📊 扫描完成：`);
  console.log(`   有可回收账户的钱包: ${walletsWithReclaim.length} 个`);
  console.log(`   总可回收金额: ${(totalReclaimable / LAMPORTS_PER_SOL).toFixed(6)} SOL\n`);

  if (walletsWithReclaim.length === 0) {
    console.log("✅ 没有需要回收的账户，程序结束。");
    return;
  }

  // ── 第二步：确认是否执行回收 ──────────────────────────────────────────────
  if (!CONFIG.FUND_WALLET_PRIVATE_KEY) {
    console.log("ℹ️  未配置资金钱包私钥（FUND_WALLET_PRIVATE_KEY），仅完成扫描。");
    console.log("   如需执行回收，请在脚本顶部 CONFIG 中填入资金钱包私钥后重新运行。");
    return;
  }

  const fundKeypair = loadKeypair(CONFIG.FUND_WALLET_PRIVATE_KEY);
  const fundAddr = fundKeypair.publicKey.toBase58();
  const fundBalance = await connection.getBalance(fundKeypair.publicKey);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  第二步：执行回收");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log(`  资金钱包: ${fundAddr}`);
  console.log(`  资金余额: ${(fundBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL\n`);

  // 交互确认
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const confirm = await new Promise((r) =>
    rl.question(
      `  确认对 ${walletsWithReclaim.length} 个钱包执行回收操作？(yes/no): `,
      (ans) => { rl.close(); r(ans.trim().toLowerCase()); }
    )
  );

  if (confirm !== "yes" && confirm !== "y") {
    console.log("\n已取消。");
    return;
  }

  console.log();
  let grandTotal = 0;

  for (const { keypair, emptyAccounts, reclaimable } of walletsWithReclaim) {
    const addr = keypair.publicKey.toBase58();
    console.log(`\n  💼 处理: ${addr.slice(0, 8)}...${addr.slice(-6)}`);
    console.log(`     可回收: ${(reclaimable / LAMPORTS_PER_SOL).toFixed(6)} SOL (${emptyAccounts.length} 个账户)`);

    try {
      // 1. 检查钱包 SOL 余额，如果不够 gas，从资金钱包转入少量
      const walletBalance = await connection.getBalance(keypair.publicKey);
      const GAS_RESERVE = 1000000; // 0.00001 SOL for gas
      if (walletBalance < GAS_RESERVE) {
        const needed = GAS_RESERVE - walletBalance + 10000;
        console.log(`     ⛽ 转入 gas: ${(needed / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
        await transferSOL(fundKeypair, keypair.publicKey, needed);
        await sleep(1000);
      }

      // 2. 关闭空账户，租金归还到本钱包
      const reclaimed = await closeAccounts(keypair, emptyAccounts, keypair.publicKey);

      if (reclaimed > 0) {
        // 3. 将回收到的 SOL 转回资金钱包（保留少量防止账户消失）
        await sleep(1000);
        const newBalance = await connection.getBalance(keypair.publicKey);
        const toSend = newBalance - CONFIG.KEEP_LAMPORTS;

        if (toSend > 5000) {
          console.log(`     📤 转回资金钱包: ${(toSend / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
          const sig = await transferSOL(keypair, fundKeypair.publicKey, toSend);
          console.log(`     🔗 签名: ${sig}`);
          grandTotal += toSend;
        }
      }
    } catch (e) {
      console.error(`     ❌ 处理失败: ${e.message}`);
    }

    await sleep(CONFIG.DELAY_MS);
  }

  const finalFundBalance = await connection.getBalance(fundKeypair.publicKey);
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  ✅ 全部完成");
  console.log(`  本次共转回资金钱包: ${(grandTotal / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
  console.log(`  资金钱包当前余额:   ${(finalFundBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
  console.log("═══════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
