# 图标源资产

`icon.png` 是桌面端图标源(1024×1024)。占位设计:135° 渐变 `#4F46E5 → #7C3AED`
+ 居中 "st" 字样(2026-10-13,ImageMagick 生成)——正式品牌图标出现后直接替换本文件。

重生成全套平台图标(`icons/` 下 png / icns / ico):

```bash
npm i -g @tauri-apps/cli   # 或 cargo install tauri-cli
cd apps/desktop/src-tauri
tauri icon assets/icon.png
```

`tauri icon` 会额外产出 android/、ios/、Square*Logo、StoreLogo——当前无移动端与
msix 目标,生成后删掉即可,Windows msi/nsis 只用 `icon.ico`,macOS dmg/app 只用 `icon.icns`。
