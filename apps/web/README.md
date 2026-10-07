# sandtable web

配置驱动的游戏系统数字沙盘 · Web 端(文档 18 章 Phase 6):浏览器本地跑小中型仿真,零安装、数据不出浏览器。

## 前置

前端通过 `file:` 依赖消费 wasm 绑定产物,先构建 pkg(仓库根执行):

```sh
wasm-pack build crates/sandtable-wasm --target web --release   # 或 --dev 提速
```

## 本地开发

```sh
cd apps/web
npm install
npm run dev
```

## 构建

```sh
npm run build   # tsc -b 类型检查 + vite 打包
```

CI 的 `web` job 即此两步(wasm pkg 构建 → 前端构建),详见 [.github/workflows/ci.yml](../../.github/workflows/ci.yml)。

## 边界

- Web 只承诺小中型仿真(WASM 单线程、内存 4GB 上限),replicates 上限 64;
- 万级玩家大型 sweep 走 CLI / 桌面(见 docs [CLI](../../docs/guide/10-cli.md));
- 浏览器与 CLI 的结果等价由 Rust 侧 `web_parity` 测试锁死(同配置同 seed,results 逐值一致)。
