// I-023 · prebuild 门禁:`file:` 依赖(sandtable-wasm → ../../crates/sandtable-wasm/pkg)
// 的拷贝/链接语义无机器检查——重建 pkg 后不重跑 install,构建会静默跑旧内核
// (2026-11-02 真实事故:旧内核判 model.gacha.featured_rate 为未知参数,提交按钮
// 永久禁用)。此脚本比对「Vite 实际解析到的 wasm」与「pkg/ 刚构建的 wasm」的
// sha256,不一致直接 fail,逼开发者刷新安装(pnpm install / npm install)。
//
// 兼容两种安装布局:
// - pnpm: node_modules/sandtable-wasm → .pnpm store 拷贝(重建 pkg 不更新);
// - npm : 同上或 symlink 到 pkg(后者恒一致,检查无害)。
// 无论哪种,realpath 后与 pkg/ 逐字节比对即为正确判据。
import { createHash } from 'node:crypto'
import { readFileSync, existsSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = join(here, '..')

/** 安装侧与 pkg/ 侧的 wasm 路径(都 resolve 到真实文件)。 */
function wasmPaths() {
  const installed = join(appRoot, 'node_modules/sandtable-wasm/sandtable_wasm_bg.wasm')
  const fresh = join(appRoot, '../../crates/sandtable-wasm/pkg/sandtable_wasm_bg.wasm')
  return { installed, fresh }
}

function sha256(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex')
}

const { installed, fresh } = wasmPaths()
if (!existsSync(fresh)) {
  console.error(`[check-wasm-hash] 缺 pkg/ 构建产物:${fresh}\n先跑 wasm-pack build crates/sandtable-wasm --target web --release`)
  process.exit(1)
}
if (!existsSync(installed)) {
  console.error(`[check-wasm-hash] 缺安装侧 wasm:${installed}\n先跑 npm install(pnpm install)`)
  process.exit(1)
}
const hi = sha256(realpathSync(installed))
const hf = sha256(fresh)
if (hi !== hf) {
  console.error(
    `[check-wasm-hash] 安装侧与 pkg/ 的 wasm 不一致:\n  installed(${hi}) ${realpathSync(installed)}\n  pkg/     (${hf}) ${fresh}\n` +
      '重建 pkg 后未刷新安装(2026-11-02 事故类):跑 npm install(pnpm install) 后再构建。',
  )
  process.exit(1)
}
console.log(`[check-wasm-hash] ok:${hi.slice(0, 12)}… 安装侧与 pkg/ 一致`)
