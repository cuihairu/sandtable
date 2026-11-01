#!/usr/bin/env python3
"""配置开关效果动态图流水线(todo DOC-GIF / kode C-24 同款模式)。

为每个「开启后有效果」的配置开关生成:
  - <id>-off.png / <id>-on.png  静态对比图(CLI 真实输出渲染)
  - <id>.gif                     off→on 动态对比(切换过程动画)
产物落在 docs/assets/config-effects/,并写 manifest.json。

真实来源:每个开关的 off/on 两张 YAML 都喂给真实 `sandtable simulate`
(同种子、同 replicates),渲染的是 CLI 真实 stdout,故任何配置/仿真
变更都会改变渲染内容——重新运行本脚本即可再生成,兼作配置效果回归证据。

用法:
  python3 scripts/config_effects.py [--bin target/debug/sandtable]
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "docs" / "assets" / "config-effects"

MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
CJK = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
MONO_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

BG = (30, 30, 34)
FG = (235, 235, 240)
DIMMED = (160, 160, 170)
ACCENT = (90, 190, 140)
ACCENT_ON = (255, 190, 90)
HEADER_BG = (45, 45, 52)
TITLE_BG = (55, 55, 66)
GRID = (70, 70, 78)


def font(path, size):
    return ImageFont.truetype(path, size)


def is_wide(ch):
    return ord(ch) > 0x2E80


def text_width(line, mono, cjk, mw, cw):
    w = 0
    for ch in line:
        w += cw if is_wide(ch) else mw
    return w


# ---- 开关清单:枚举本仓全部「开启后有效果」的离散配置开关 ----
# 每个开关 = (id, 标题en, 标题zh, 说明en, 说明zh, 配置构造, 需要高亮的指标子串)
def base_scenario():
    return """schema_version: '1'
scenario:
  population: 2000
  duration: 30d
  seed: 42
  population_mix: { casual: 0.6, core: 0.3, whale: 0.1 }
model:
  warrior: { attack: 100, defense: 80, hp: 1000 }
"""


SWITCHES = [
    {
        "id": "combat-damage-model",
        "en": "Combat damage model",
        "zh": "战斗伤害口径",
        "desc_en": "Toggles the damage formula between difference (attack−defense, clamped at 1) and ratio (ratio_k·attack/(attack+defense)). Off=difference (default), On=ratio. Weak-vs-strong fights stop being a flat floor.",
        "desc_zh": "切换伤害公式:差值口径(attack−defense,下限 1)与比值口径(ratio_k·attack/(attack+defense))。Off=difference(缺省),On=ratio;弱打强不再被钳底。",
        "off": base_scenario(),
        "on": base_scenario() + """  combat: { damage_model: ratio, ratio_k: 1.0 }
""",
        "highlight": ["win_rate", "gold_earned", "retention_d7"],
    },
    {
        "id": "training-loop",
        "en": "Training loop (p_training + training)",
        "zh": "练级环(p_training + training)",
        "desc_en": "Enables a no-combat growth channel: players spend some sessions training for xp/gold. Off=no training (default), On=behavior p_training>0 plus a training output table.",
        "desc_zh": "开启无战斗风险的成长通道:玩家部分会话用于练级换经验/金币。Off=无练级环(缺省),On=各分群 p_training>0 且配置 training 产出面。",
        "off": base_scenario(),
        "on": base_scenario() + """  behavior:
    casual: { p_dungeon: 0.5, p_upgrade: 0.2, p_training: 0.3 }
    core: { p_dungeon: 0.5, p_upgrade: 0.3, p_training: 0.2 }
    whale: { p_dungeon: 0.5, p_upgrade: 0.3, p_training: 0.1 }
  training: { xp: 50, gold: 20 }
""",
        "highlight": ["gold_per_player", "power_p50", "retention_d7"],
    },
    {
        "id": "loot",
        "en": "Loot settlement (model.loot)",
        "zh": "掉落结算(model.loot)",
        "desc_en": "Adds a post-victory weighted-table draw that scales reward amounts. Off=no loot (default), On=loot table bound on victory.",
        "desc_zh": "战斗胜利后从绑定加权表抽一次,按 rate_mult 缩放数额入账。Off=未配置掉落(缺省),On=配置 loot 表并在胜利结算。",
        "off": base_scenario(),
        "on": base_scenario() + """  loot:
    rate_mult: 1.0
    on_victory: chest
    tables:
      chest:
        weights: { gold_small: 70, gold_mid: 25, gem: 5 }
    rewards:
      gold_small: { gold: 10, xp: 0 }
      gold_mid: { gold: 50, xp: 0 }
      gem: { gold: 0, xp: 20 }
""",
        "highlight": ["loot_gold_per_player", "gold_per_player", "power_p50"],
    },
    {
        "id": "gacha",
        "en": "Gacha (model.gacha)",
        "zh": "抽卡保底(model.gacha)",
        "desc_en": "Adds a pity-layered gacha draw; every player pulls until a 5★. Off=no gacha (default), On=gacha config with hard pity.",
        "desc_zh": "接入抽卡保底:每玩家开号抽到 5★ 为止。Off=未配置抽卡(缺省),On=配置 gacha 保底(2% 基础率 + 50 抽硬保底)。",
        "off": base_scenario(),
        "on": base_scenario() + """  gacha:
    base_rate: 0.02
    pity_hard: 50
    pity_soft_start: 0
    pity_soft_step: 0.0
""",
        "highlight": ["gacha_pulls_to_hit"],
    },
]


def run_sim(bin_path, yaml_path, out_dir):
    cmd = [str(bin_path), "simulate", str(yaml_path), "--replicates", "3", "--out", str(out_dir)]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(
            f"simulate 失败({res.returncode}): {res.stderr}\n命令: {' '.join(cmd)}"
        )
    return res.stdout


def render_terminal(lines, width_px, size, title, mode, highlight_substrings, mono, cjk, mono_b):
    """渲染一张终端截图。mode: 'off'|'on'。返回 (PIL.Image, line_height)。"""
    mw = mono.getbbox("M")[2]
    cw = cjk.getbbox("中")[2]
    line_h = size + 8
    pad = 10
    title_h = 34
    # 预排版
    wrapped = []
    for line in lines:
        if text_width(line, mono, cjk, mw, cw) > width_px - 2 * pad:
            # 简单按字符折行
            cur = ""
            for ch in line:
                if text_width(cur + ch, mono, cjk, mw, cw) > width_px - 2 * pad:
                    wrapped.append(cur)
                    cur = ch
                else:
                    cur += ch
            if cur:
                wrapped.append(cur)
        else:
            wrapped.append(line)
    n = max(1, len(wrapped))
    height = title_h + pad * 2 + n * line_h
    img = Image.new("RGB", (width_px, height), BG)
    d = ImageDraw.Draw(img)
    # 标题栏
    d.rectangle([0, 0, width_px, title_h], fill=TITLE_BG)
    d.text((pad, title_h // 2 - size // 2 - 2), title, font=mono_b, fill=FG)
    state = "OFF" if mode == "off" else "ON"
    state_col = DIMMED if mode == "off" else ACCENT_ON
    stw = text_width(state, mono, cjk, mw, cw)
    d.rectangle([width_px - pad - stw - 16, 7, width_px - pad, title_h - 7], outline=state_col)
    d.text((width_px - pad - stw - 8, title_h // 2 - size // 2 - 2), state, font=mono_b, fill=state_col)
    # 命令行行
    y = title_h + pad
    for line in wrapped:
        highlighted = mode == "on" and any(s in line for s in highlight_substrings)
        color = ACCENT if highlighted else FG
        # 命令提示符首行用绿色
        if line.startswith("$ ") or line.startswith("replicate 0"):
            color = FG
        x = pad
        for ch in line:
            f = cjk if is_wide(ch) else mono
            d.text((x, y), ch, font=f, fill=color)
            x += cw if is_wide(ch) else mw
        y += line_h
    return img, line_h


def make_gif(frames, out_path, durations):
    # 统一尺寸
    w = max(f.width for f in frames)
    h = max(f.height for f in frames)
    normalized = []
    for f in frames:
        if f.size != (w, h):
            nf = Image.new("RGB", (w, h), BG)
            nf.paste(f, (0, 0))
            f = nf
        normalized.append(f)
    normalized[0].save(
        out_path,
        save_all=True,
        append_images=normalized[1:],
        duration=durations,
        loop=0,
        optimize=False,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bin", default=str(ROOT / "target" / "debug" / "sandtable"))
    args = ap.parse_args()
    bin_path = Path(args.bin)
    if not bin_path.exists():
        print(f"构建 CLI: cargo build -p sandtable-cli ...", file=sys.stderr)
        subprocess.run(["cargo", "build", "-p", "sandtable-cli"], cwd=ROOT, check=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    size = 15
    width = 920
    mono = font(MONO, size)
    mono_b = font(MONO_BOLD, size)
    cjk = font(CJK, size)

    manifest = {"generated_by": "scripts/config_effects.py", "switches": []}

    for sw in SWITCHES:
        sid = sw["id"]
        print(f"[config-effects] {sid} ...", file=sys.stderr)
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            off_yaml = td / f"{sid}-off.yaml"
            on_yaml = td / f"{sid}-on.yaml"
            off_yaml.write_text(sw["off"])
            on_yaml.write_text(sw["on"])
            off_out = run_sim(bin_path, off_yaml, td / f"{sid}-off-out")
            on_out = run_sim(bin_path, on_yaml, td / f"{sid}-on-out")
            off_lines = off_out.splitlines()
            on_lines = on_out.splitlines()

        title = f"$ sandtable simulate <{sid}> --replicates 3"
        off_img, _ = render_terminal(
            off_lines, width, size, title, "off", sw["highlight"], mono, cjk, mono_b
        )
        on_img, line_h = render_terminal(
            on_lines, width, size, title, "on", sw["highlight"], mono, cjk, mono_b
        )
        off_img.save(OUT_DIR / f"{sid}-off.png")
        on_img.save(OUT_DIR / f"{sid}-on.png")

        # 动画:off 定格 → 标题切 on 并逐行打出 on 输出 → on 定格
        frames = [off_img] * 2
        durations = [1800, 1800]
        for i in range(1, len(on_lines) + 1):
            partial = render_terminal(
                on_lines[:i], width, size, title, "on", sw["highlight"], mono, cjk, mono_b
            )[0]
            frames.append(partial)
            durations.append(70)
        frames += [on_img] * 2
        durations += [300, 2200]
        make_gif(frames, OUT_DIR / f"{sid}.gif", durations)

        manifest["switches"].append(
            {
                "id": sid,
                "title_en": sw["en"],
                "title_zh": sw["zh"],
                "desc_en": sw["desc_en"],
                "desc_zh": sw["desc_zh"],
                "off_png": f"docs/assets/config-effects/{sid}-off.png",
                "on_png": f"docs/assets/config-effects/{sid}-on.png",
                "gif": f"docs/assets/config-effects/{sid}.gif",
            }
        )
        print(f"  -> {sid}.gif ({len(frames)} frames)", file=sys.stderr)

    (OUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    )
    print(f"[config-effects] done -> {OUT_DIR}", file=sys.stderr)


if __name__ == "__main__":
    main()
