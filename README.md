<div align="center">

# 🛠️ Solana 钱包工具集

<p>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-16%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js"></a>
  <a href="https://solana.com/"><img src="https://img.shields.io/badge/Solana-Mainnet-14F195?style=for-the-badge&logo=solana&logoColor=black" alt="Solana"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-22C55E?style=for-the-badge" alt="License"></a>
</p>

**两个独立脚本，分别用于 SOL 余额归集 与 空 Token 账户租金回收。**

</div>

---

## 📦 项目结构

```
.
├── collect.js          # SOL 余额归集（子钱包 → 主钱包）
├── reclaim.js          # 空 Token 账户租金回收
├── create_template.js  # 生成 wallets.xlsx 模板
├── wallets.xlsx        # 钱包私钥列表（本地保留，不上传）
└── package.json
```

---

## 🚀 快速开始

### 安装依赖

```bash
npm install
```

### 生成钱包模板

```bash
node create_template.js
```

打开生成的 `wallets.xlsx`，清空示例行，填入真实私钥后保存。

**支持两种私钥格式：**
- Base58 字符串（常见格式）：`5KHuBP...`
- JSON 数组格式：`[12, 34, 56, ...]`

---

## 📜 脚本说明

### 1. `collect.js` — SOL 余额归集

将多个子钱包的 SOL 批量转回指定主钱包（资金钱包）。

**配置（编辑文件顶部 CONFIG）：**

```js
const CONFIG = {
  RPC_URL: "https://mainnet.helius-rpc.com/?api-key=YOUR_KEY",
  EXCEL_FILE: path.join(__dirname, "wallets.xlsx"),
  PRIVATE_KEY_COLUMN: "私钥",
  FUND_WALLET_ADDRESS: "你的主钱包公钥",  // 只需公钥，不需私钥
  KEEP_LAMPORTS: 900000,  // 每个钱包保留 ~0.0009 SOL，满足租金豁免
  DELAY_MS: 1000,
};
```

**运行：**

```bash
node collect.js
```

**执行流程：**

```
扫描余额  →  显示可转出金额  →  选择模式（全部转出 / 指定金额）  →  确认  →  批量转账
```

**转账模式：**
- `[1]` 全部转出：每个钱包转出最大可用余额
- `[2]` 指定金额：自定义每个钱包转出的 SOL 数量

---

### 2. `reclaim.js` — 空 Token 账户租金回收

扫描钱包下余额为 0 的 Token 账户，关闭后回收租金，统一转回资金钱包。

**配置（编辑文件顶部 CONFIG）：**

```js
const CONFIG = {
  RPC_URL: "https://mainnet.helius-rpc.com/?api-key=YOUR_KEY",
  EXCEL_FILE: path.join(__dirname, "wallets.xlsx"),
  PRIVATE_KEY_COLUMN: "私钥",
  FUND_WALLET_PRIVATE_KEY: "资金钱包私钥",  // 用于垫付 gas
  KEEP_LAMPORTS: 5000,
  DELAY_MS: 1500,
};
```

> 留空 `FUND_WALLET_PRIVATE_KEY` 则只做**扫描查询**，不执行回收。

**运行：**

```bash
node reclaim.js
```

**执行流程：**

```
扫描空账户  →  显示可回收金额  →  确认  →  垫付 gas  →  关闭空账户  →  转回资金钱包
```

---

## ⚙️ 获取 RPC 节点

推荐使用 [Helius](https://dashboard.helius.dev/) 免费套餐，稳定性优于公共节点。

1. 注册登录（支持 GitHub / Google）
2. 创建新的 RPC 节点
3. 复制 API Key，替换 CONFIG 中的 `YOUR_KEY`

---

## 📺 运行示例

**`collect.js` 控制台输出：**

```
═══════════════════════════════════════════════════
       SOL 余额归集工具（转回资金钱包）
═══════════════════════════════════════════════════

  资金钱包（收款）: 3GRGLi...PhdQ
  📋 从 Excel 读取到 50 个钱包

  💰 7xKj...3mNp  余额: 0.012345 SOL  可转: 0.011445 SOL
  ⬜ 9yLm...2qRs  余额: 0.000500 SOL  (低于最低保留，跳过)
  ...

  📊 共 38 个钱包有余额
     总可转出金额: 1.234000 SOL

  请选择转账模式：
  [1] 全部转出
  [2] 指定每个钱包转出的 SOL 数量

  输入选项 (1 或 2): 1
  确认开始转账（共 38 个钱包）？(yes/no): yes

  ✅ 7xKj...3mNp  转出 0.011445 SOL  5xLp2Qz1...
  ...

═══════════════════════════════════════════════════
  ✅ 转账完成  成功: 37  失败: 1
  共转出: 1.198000 SOL
═══════════════════════════════════════════════════
```

---

## ⚠️ 注意事项

- **私钥安全**：`wallets.xlsx` 已加入 `.gitignore`，**切勿上传到任何平台**
- **建议测试**：主网操作前可先在 devnet 验证逻辑
- **RPC 限速**：调整 `DELAY_MS` 可降低被限速概率，付费节点更稳定
- **保留余额**：`KEEP_LAMPORTS` 防止账户被系统回收，不建议设为 0

---

## 📄 License

MIT
