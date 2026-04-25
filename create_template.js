/**
 * 生成示例 wallets.xlsx 模板
 * 运行: node create_template.js
 */
const XLSX = require("xlsx");
const path = require("path");

const data = [
  { 私钥: "" },
  { 私钥: "5KHuBPENeQ3Y3RpfmPbT9i7VbZ1EXAMPLE..." },
];

const ws = XLSX.utils.json_to_sheet(data);
ws["!cols"] = [{ wch: 90 }];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "钱包列表");

const outPath = path.join(__dirname, "wallets.xlsx");
XLSX.writeFile(wb, outPath);
console.log(`✅ 模板已创建: ${outPath}`);
console.log("请用 Excel 打开，清空示例行，填入真实私钥后保存。");
