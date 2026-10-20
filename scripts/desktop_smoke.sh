#!/usr/bin/env bash
# 桌面端无头启动冒烟(docs 18 Phase 7 人工验收清单的第 0 步,可复跑;已接入
# CI desktop-smoke job,2026-10-13):
# 带 custom-protocol 构建 → Xvfb + openbox 拉起 → 截屏判定 UI 是否渲染。
# 四个实测过的坑:
# 1. 不带 custom-protocol 的 cargo build 是开发形态:窗口加载 build.devUrl
#    (localhost:5173),独立运行只显示 "Could not connect to localhost";
# 2. WebKitGTK 在 Xvfb 下须关两个渲染器才落 X 像素:WEBKIT_DISABLE_DMABUF_RENDERER=1
#    (DMABUF 不落 X 像素,截屏全白/全黑)+ WEBKIT_DISABLE_COMPOSITING_MODE=1
#    (合成层在软件 GL 下出黑窗);
# 3. class=sandtable 会命中两个窗口:1280x840 主窗 + 一个 10x10 从不映射的
#    辅助窗,而且主窗在 debug 构建下要启动后约 25 秒才创建(本机实测)。
#    开环取 head -1 常拿到辅助窗,resize 打不到主窗 → 永不重画 → 截屏全空
#    (2026-10-20 CI run 39412546114 即此:主窗创建前就采完了,1 色被判空白窗);
# 4. 所以每轮重选主窗(按面积最大者),并按映射态 + 截屏通道数分级报:
#    1-bit 灰度 = 截到的是空桌面(主窗没映射);8-bit 却 <100 色 = 上了屏但没画。
# 退出码:0 通过 · 1 进程退出或未建窗 · 2 环境不符(缺依赖/显示深度)·
# 4 窗口从未映射(截到空桌面)· 5 已映射却没画出像素(空白窗)。
# 依赖:Xvfb、openbox、imagemagick(import/convert)、xdotool、x11-utils(xwininfo)。
# 用法:仓库根 bash scripts/desktop_smoke.sh;截图落 /tmp,末行打印路径供目检。
# CI 提速用 ST_SMOKE_PROFILE=debug 走调试构建(同样内嵌资产);默认 release 同旧配方。
# 显示号默认在 :97~:103 里挑一个空闲的;ST_SMOKE_DISPLAY 显式指定时只用它;
# ST_SMOKE_BIN 显式指定要启动的可执行体(默认 target/$ST_SMOKE_PROFILE/sandtable-desktop);
# ST_SMOKE_MIN_COLORS 调截屏色数门槛(默认 100),调高可在本机演练空白窗分支。
set -euo pipefail
cd "$(dirname "$0")/.."

PROFILE="${ST_SMOKE_PROFILE:-release}"
case "$PROFILE" in
  release|debug) ;;
  *) echo "ST_SMOKE_PROFILE 仅支持 release|debug,收到: $PROFILE"; exit 2 ;;
esac

for tool in cargo Xvfb openbox import convert xdotool xwininfo; do
  command -v "$tool" >/dev/null || { echo "缺依赖: $tool"; exit 2; }
done

# 显示号:别人(或上轮残留的 Xvfb)占着 :97 时,我们的 Xvfb 起不来、后续全挂在
# 那个服务器上——显示几何与深度都可能不是我们要的,截屏判定随之失真。
pick_display() {
  local n
  for n in 97 98 99 100 101 102 103; do
    if ! xdpyinfo -display ":$n" >/dev/null 2>&1; then
      echo "$n"
      return 0
    fi
  done
  return 1
}
if [ -n "${ST_SMOKE_DISPLAY:-}" ]; then
  case "$ST_SMOKE_DISPLAY" in
    ''|*[!0-9]*) echo "ST_SMOKE_DISPLAY 须为数字(收到: $ST_SMOKE_DISPLAY)"; exit 2 ;;
  esac
  DISPLAY_NUM="$ST_SMOKE_DISPLAY"
else
  DISPLAY_NUM=$(pick_display) || { echo ":97~:103 全被占用,换一个显示号再跑(ST_SMOKE_DISPLAY)"; exit 2; }
fi
DISP=":$DISPLAY_NUM"

# 截屏色数门槛(空桌面/白屏远低于此,正常 UI 上千色)。放这里提前校验,免得
# 拼错要先白等一个窗口等待周期才发现。
MIN_COLORS="${ST_SMOKE_MIN_COLORS:-100}"
case "$MIN_COLORS" in
  ''|*[!0-9]*) echo "ST_SMOKE_MIN_COLORS 须为数字(收到: $MIN_COLORS)"; exit 2 ;;
esac

# cargo build 无 --debug 旗标(默认即 debug),仅 release 显式加
if [ "$PROFILE" = "release" ]; then
  cargo build --release -p sandtable-desktop --features custom-protocol
else
  cargo build -p sandtable-desktop --features custom-protocol
fi
# ST_SMOKE_BIN 可指向别处的可执行体,便于故障注入而不改 target/ 下的构建产物
BIN="${ST_SMOKE_BIN:-target/$PROFILE/sandtable-desktop}"
if [ ! -x "$BIN" ]; then
  echo "缺构建产物: $BIN(cargo build 未产出或 ST_SMOKE_BIN 指错)"; exit 2
fi

Xvfb "$DISP" -screen 0 1280x800x24 >/dev/null 2>&1 & XVFB=$!
# 早退时 APP/WM 还没赋值:写 kill "${APP:-0}" 会变成 kill 0——SIGTERM 打到整个
# 进程组,脚本自己也被收掉(退出码被改成 143,盖住真实的 exit 2)。
cleanup() {
  local pid
  for pid in ${APP:-} ${WM:-} "${XVFB:-}"; do
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT
# X 就绪且深度确实是 24:显示号被占用时会挂到别人的服务器上,先拦下来。
DEPTH=""
for _ in $(seq 1 50); do
  DEPTH=$(DISPLAY="$DISP" xwininfo -root 2>/dev/null | awk -F: '/Depth:/ {gsub(/ /,"",$2); print $2}')
  [ "$DEPTH" = "24" ] && break
  kill -0 "$XVFB" 2>/dev/null || break
  sleep 0.2
done
if [ "$DEPTH" != "24" ]; then
  echo "X 显示 $DISP 深度为 ${DEPTH:-不可读}(须 24;显示号可能被占用或 Xvfb 未就绪)"; exit 2
fi
DISPLAY="$DISP" openbox >/dev/null 2>&1 & WM=$!
sleep 2
DISPLAY="$DISP" WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 \
  "$BIN" >/tmp/sandtable_desktop_smoke.log 2>&1 & APP=$!

# 窗口工具:xwininfo -id 只认 0x 十六进制,xdotool 给的是十进制,必须转。
# 主窗 = class=sandtable 里「已映射且面积最大」者;10x10 辅助窗从不映射,天然被排除。
map_state() {
  DISPLAY="$DISP" xwininfo -id "$(printf '0x%x' "$1")" 2>/dev/null | \
    awk -F: '/Map State:/ {gsub(/ /,"",$2); print $2}'
}
window_area() {
  DISPLAY="$DISP" xwininfo -id "$(printf '0x%x' "$1")" 2>/dev/null | awk -F: '
    /Width:/ && !w {gsub(/ /,"",$2); w=$2} /Height:/ && !h {gsub(/ /,"",$2); h=$2}
    END {print (w+0) * (h+0)}'
}
choose_main_window() {
  local w a best="" best_area=0
  for w in $(DISPLAY="$DISP" xdotool search --class sandtable 2>/dev/null); do
    [ "$(map_state "$w")" = "IsViewable" ] || continue
    a=$(window_area "$w")
    [ "$a" -gt "$best_area" ] && { best="$w"; best_area="$a"; }
  done
  printf '%s %s' "$best" "$best_area"
}
window_states() {
  local w
  for w in $(DISPLAY="$DISP" xdotool search --class sandtable 2>/dev/null); do
    printf '%s(%s,%s像素) ' "$w" "$(map_state "$w")" "$(window_area "$w")"
  done
}

# 等主窗创建:创建耗时本身就是启动链指标,顺带每 2 秒盯一次进程,启动即退尽早暴露。
WID=""
AREA=0
CREATED_AT=""
for n in $(seq 1 25); do
  if ! kill -0 "$APP" 2>/dev/null; then
    echo "启动即退,日志:"; cat /tmp/sandtable_desktop_smoke.log; exit 1
  fi
  chosen=$(choose_main_window)
  if [ -n "${chosen% *}" ]; then
    WID=${chosen% *}
    AREA=${chosen##* }
    CREATED_AT="$((n * 2))s"
    break
  fi
  sleep 2
done
if [ -z "$WID" ]; then
  echo "进程存活但 50s 内未创建已映射的应用窗口(class=sandtable: $(window_states))"
  echo "日志:"; cat /tmp/sandtable_desktop_smoke.log; exit 1
fi
echo "主窗 id=$WID, ${AREA} 像素, 创建耗时 ${CREATED_AT}"

# 落帧重试:WebKitGTK 在无 GPU 的 Xvfb 下没有重画事件就不落第一帧,
# resize/置顶是最稳的触发方式。
BEST=0
CHANNELS="none"
LAST_MAP=""
for i in 1 2 3 4 5 6 7 8; do
  DISPLAY="$DISP" xdotool windowsize "$WID" $((1260 + i)) 780 2>/dev/null || true
  DISPLAY="$DISP" xdotool windowraise "$WID" 2>/dev/null || true
  sleep 4
  DISPLAY="$DISP" import -window root /tmp/sandtable_desktop_smoke.png
  BEST=$(DISPLAY="$DISP" convert /tmp/sandtable_desktop_smoke.png -depth 8 -format "%k" info:)
  CHANNELS=$(DISPLAY="$DISP" convert /tmp/sandtable_desktop_smoke.png -format "%[channels]" info: | awk '{print $1}')
  LAST_MAP=$(map_state "$WID")
  [ "$BEST" -gt "$MIN_COLORS" ] && break
done
echo "主窗(id=$WID, Map State=$LAST_MAP)+ 截屏 $BEST 色(通道=$CHANNELS)"
if [ "$LAST_MAP" != "IsViewable" ]; then
  echo "窗口创建后掉出了映射态(Map State=$LAST_MAP)——截屏落在空桌面上,不是 webview 空白窗;日志:"
  cat /tmp/sandtable_desktop_smoke.log; exit 4
fi
if [ "$CHANNELS" != "srgb" ]; then
  echo "窗口已上屏但截屏是 ${CHANNELS} 通道(应为 srgb)——未取到 RGB 像素,疑似白/黑屏;截图 /tmp/sandtable_desktop_smoke.png"
  exit 5
fi
if [ "$BEST" -lt "$MIN_COLORS" ]; then
  echo "窗口已上屏且取到 srgb 像素但仅 $BEST 色(门槛 $MIN_COLORS,疑似 webview 未绘制);截图 /tmp/sandtable_desktop_smoke.png"
  exit 5
fi
echo "冒烟通过;请目检 /tmp/sandtable_desktop_smoke.png 确认是 UI 而非错误页"
