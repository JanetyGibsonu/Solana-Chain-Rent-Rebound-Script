/**
 * SOL 余额归集工具
 * 功能：从 Excel 私钥列表中，将指定钱包的 SOL 转回资金钱包
 * 支持：全部转出 或 输入指定数量
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
const bs58 = require("bs58");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// ─── 配置区 ───────────────────────────────────────────────────────────────────
const CONFIG = {
  RPC_URL: "https://mainnet.helius-rpc.com/?api-key=a9808e6b-8058-4e6a-a0da-50c4978ef4fb", // 换成你的RPC
  EXCEL_FILE: path.join(__dirname, "wallets.xlsx"),
  PRIVATE_KEY_COLUMN: "私钥",
  DELAY_MS: 1000,

  // 资金钱包地址（收款方，只需地址不需私钥）
  FUND_WALLET_ADDRESS: "3GRGLitcxoskCzWAKbw4283wwJZ67gW77Y1aBtGhPhdQ",

  // 每个钱包保留的最低 lamports（账户不能完全归零）
  KEEP_LAMPORTS: 900000, // 0.0009 SOL，满足租金豁免
};
// ─────────────────────────────────────────────────────────────────────────────

const connection = new Connection(CONFIG.RPC_URL, "confirmed");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadKeypair(rawKey) {
  rawKey = rawKey.trim();
  try {
    const decoded = bs58.default ? bs58.default.decode(rawKey) : bs58.decode(rawKey);
    return Keypair.fromSecretKey(decoded);
  } catch (_) {}
  try {
    const arr = JSON.parse(rawKey);
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  } catch (_) {}
  throw new Error(`无法解析私钥: ${rawKey.slice(0, 10)}...`);
}

function readWalletsFromExcel(filePath, column) {
  if (!fs.existsSync(filePath)) {
    console.error(`\n❌ 找不到文件: ${filePath}\n`);
    process.exit(1);
  }
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws);
  return rows.map((r, i) => {
    const val = r[column];
    if (!val) throw new Error(`第 ${i + 2} 行缺少列 "${column}"`);
    return String(val).trim();
  });
}

function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("         SOL 余额归集工具（转回资金钱包）");
  console.log("═══════════════════════════════════════════════════\n");

  const fundPubkey = new PublicKey(CONFIG.FUND_WALLET_ADDRESS);
  console.log(`  资金钱包（收款）: ${CONFIG.FUND_WALLET_ADDRESS}\n`);

  // 读取私钥
  const rawKeys = readWalletsFromExcel(CONFIG.EXCEL_FILE, CONFIG.PRIVATE_KEY_COLUMN);
  console.log(`📋 从 Excel 读取到 ${rawKeys.length} 个钱包\n`);

  const wallets = [];
  for (const raw of rawKeys) {
    try {
      wallets.push(loadKeypair(raw));
    } catch (e) {
      console.warn(`⚠️  跳过无效私钥: ${e.message}`);
    }
  }

  // ── 扫描余额 ──────────────────────────────────────────────────────────────
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  扫描钱包余额...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const results = [];

  for (const kp of wallets) {
    const addr = kp.publicKey.toBase58();
    try {
      const balance = await connection.getBalance(kp.publicKey);
      const transferable = balance - CONFIG.KEEP_LAMPORTS;

      if (balance > CONFIG.KEEP_LAMPORTS) {
        console.log(
          `  💰 ${addr.slice(0, 8)}...${addr.slice(-6)}  余额: ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL  可转: ${(transferable / LAMPORTS_PER_SOL).toFixed(6)} SOL`
        );
        results.push({ keypair: kp, balance, transferable });
      } else if (balance > 0) {
        console.log(
          `  ⬜ ${addr.slice(0, 8)}...${addr.slice(-6)}  余额: ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL  (低于最低保留，跳过)`
        );
      }
    } catch (e) {
      console.log(`  ❌ ${addr.slice(0, 8)}...${addr.slice(-6)}  查询失败: ${e.message}`);
    }
    await sleep(CONFIG.DELAY_MS);
  }

  if (results.length === 0) {
    console.log("\n✅ 没有可转出余额的钱包，程序结束。");
    return;
  }

  const totalTransferable = results.reduce((s, r) => s + r.transferable, 0);
  console.log(`\n📊 共 ${results.length} 个钱包有余额`);
  console.log(`   总可转出金额: ${(totalTransferable / LAMPORTS_PER_SOL).toFixed(6)} SOL\n`);

  // ── 交互选择模式 ───────────────────────────────────────────────────────────
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  请选择转账模式：");
  console.log("  [1] 全部转出（每个钱包最大可转金额）");
  console.log("  [2] 指定每个钱包转出的 SOL 数量");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const mode = await prompt(rl, "  输入选项 (1 或 2): ");

  let customAmount = 0;
  if (mode.trim() === "2") {
    const input = await prompt(rl, "  每个钱包转出多少 SOL（例如 0.002）: ");
    customAmount = Math.floor(parseFloat(input) * LAMPORTS_PER_SOL);
    if (isNaN(customAmount) || customAmount <= 0) {
      console.log("  ❌ 无效金额，程序退出。");
      rl.close();
      return;
    }
    console.log(`  → 每个钱包将转出 ${(customAmount / LAMPORTS_PER_SOL).toFixed(6)} SOL\n`);
  }

  const confirm = await prompt(
    rl,
    `  确认开始转账（共 ${results.length} 个钱包）？(yes/no): `
  );
  rl.close();

  if (confirm.trim().toLowerCase() !== "yes" && confirm.trim().toLowerCase() !== "y") {
    console.log("\n已取消。");
    return;
  }

  // ── 执行转账 ──────────────────────────────────────────────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  开始转账...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  let successCount = 0;
  let failCount = 0;
  let grandTotal = 0;

  for (const { keypair, balance, transferable } of results) {
    const addr = keypair.publicKey.toBase58();

    // 决定本次转出金额
    let sendLamports;
    if (mode.trim() === "2") {
      if (customAmount > transferable) {
        console.log(
          `  ⚠️  ${addr.slice(0, 8)}...${addr.slice(-6)}  余额不足（可转 ${(transferable / LAMPORTS_PER_SOL).toFixed(6)} SOL），跳过`
        );
        continue;
      }
      sendLamports = customAmount;
    } else {
      sendLamports = transferable;
    }

    process.stdout.write(
      `  📤 ${addr.slice(0, 8)}...${addr.slice(-6)}  转出 ${(sendLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL  `
    );

    try {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: fundPubkey,
          lamports: sendLamports,
        })
      );

      const sig = await sendAndConfirmTransaction(connection, tx, [keypair], {
        commitment: "confirmed",
      });

      console.log(`✅ ${sig.slice(0, 16)}...`);
      grandTotal += sendLamports;
      successCount++;
    } catch (e) {
      console.log(`❌ 失败: ${e.message}`);
      failCount++;
    }

    await sleep(CONFIG.DELAY_MS);
  }

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  ✅ 转账完成");
  console.log(`  成功: ${successCount} 个  失败: ${failCount} 个`);
  console.log(`  共转出: ${(grandTotal / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
  console.log("═══════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
