#!/usr/bin/env bash
# 桌面端无头启动冒烟(docs 18 Phase 7 人工验收清单的第 0 步,可复跑):
# 带 custom-protocol 构建 → Xvfb + openbox 拉起 → 截屏判定 UI 是否渲染。
# 三个实测过的坑(2026-10-12,配方均在本机验证):
# 1. 不带 custom-protocol 的 cargo build 是开发形态:窗口加载 build.devUrl
#    (localhost:5173),独立运行只显示 "Could not connect to localhost";
# 2. WebKitGTK 在 Xvfb 下须关两个渲染器才落 X 像素:WEBKIT_DISABLE_DMABUF_RENDERER=1
#    (DMABUF 不落 X 像素,截屏全白/全黑)+ WEBKIT_DISABLE_COMPOSITING_MODE=1
#    (合成层在软件 GL 下出黑窗);
# 3. 初帧可能不画,resize 触发 GTK 重排后稳定出画(脚本内重试环已处理)。
# 依赖:Xvfb、openbox、imagemagick(import/convert)、xdotool。
# 用法:仓库根 bash scripts/desktop_smoke.sh;截图落 /tmp,末行打印路径供目检。
set -euo pipefail
cd "$(dirname "$0")/.."

for tool in Xvfb openbox import convert xdotool; do
  command -v "$tool" >/dev/null || { echo "缺依赖: $tool"; exit 2; }
done

cargo build --release -p sandtable-desktop --features custom-protocol
BIN=target/release/sandtable-desktop

Xvfb :97 -screen 0 1280x800x24 >/dev/null 2>&1 & XVFB=$!
cleanup() { kill "${APP:-0}" "${WM:-0}" "$XVFB" 2>/dev/null || true; }
trap cleanup EXIT
sleep 2
DISPLAY=:97 openbox >/dev/null 2>&1 & WM=$!
sleep 2
DISPLAY=:97 WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 \
  "$BIN" >/tmp/sandtable_desktop_smoke.log 2>&1 & APP=$!
sleep 15

if ! kill -0 "$APP" 2>/dev/null; then
  echo "启动即退,日志:"; cat /tmp/sandtable_desktop_smoke.log; exit 1
fi
WID=$(DISPLAY=:97 xdotool search --class sandtable 2>/dev/null | head -1)
if [ -z "$WID" ]; then
  echo "进程存活但无应用窗口"; DISPLAY=:97 xdotool search --name "" 2>/dev/null | head; exit 1
fi

# 截屏判定:初帧可能不画,resize 触发重画后重试(实测 1-2 轮内出画)
BEST=0
for i in 1 2 3 4 5 6; do
  DISPLAY=:97 xdotool windowsize "$WID" $((1260 + i)) 780 2>/dev/null || true
  sleep 3
  DISPLAY=:97 import -window root /tmp/sandtable_desktop_smoke.png
  BEST=$(convert /tmp/sandtable_desktop_smoke.png -format "%k" info:)
  [ "$BEST" -gt 100 ] && break
done

echo "进程存活 + 窗口(class=sandtable, id=$WID)+ 截屏 $BEST 色"
if [ "$BEST" -lt 100 ]; then
  echo "疑似空白窗(webview 未绘制);截图 /tmp/sandtable_desktop_smoke.png"; exit 3
fi
echo "冒烟通过;请目检 /tmp/sandtable_desktop_smoke.png 确认是 UI 而非错误页"
