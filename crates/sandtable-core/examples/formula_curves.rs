//! 曲线库生成器(文档 25 章数据源)。
//!
//! 用真实公式求值器(`formula::compile` + `Formula::eval`)对代表性表达式
//! 采样,输出 SVG 到 `docs/assets/formulas/`(在 VitePress srcRoot 内,构建
//! 期按资产解析;public/ 的绝对路径 rollup 不收)。文档不手画图:本例子是
//! 曲线与代码之间的事实源——表达式编译失败即 panic,保证文档展示的语法
//! 与求值器能力永不漂移。
//!
//! 运行(仓库根):`cargo run -p sandtable-core --example formula_curves`
//! 产物确定性,可 diff。库本体零文件 I/O(文档 04 章平台边界不变):
//! 写盘只发生在本例子二进制,不进 lib / wasm 构建。

use std::fs;
use std::path::PathBuf;

use sandtable_core::formula;

/// 一条曲线:表达式源码(文档原样展示)+ 线色 + 是否虚线(参考线)。
struct Series {
    expr: &'static str,
    color: &'static str,
    dashed: bool,
}

const BLUE: &str = "#4c78a8";
const ORANGE: &str = "#f58518";
const GREEN: &str = "#54a24b";
const PURPLE: &str = "#b279a2";

/// 一张图:文件名、标题(英文,图内不依赖 CJK 字形)、定义域、y 上限、曲线组。
struct Figure {
    file: &'static str,
    title: &'static str,
    x_max: f64,
    y_max: f64,
    series: &'static [Series],
}

const FIGURES: &[Figure] = &[
    // 增长形态四线对比:线性 / 两次幂 / 指数(常数底幂近似)。
    // 指数在 x≈58 处越过 x^2,随后一路碾压——长线运营的失控点。
    Figure {
        file: "growth.svg",
        title: "Growth shapes: linear / power / exponential",
        x_max: 50.0,
        y_max: 2500.0,
        series: &[
            Series {
                expr: "x",
                color: BLUE,
                dashed: false,
            },
            Series {
                expr: "x^1.5",
                color: ORANGE,
                dashed: false,
            },
            Series {
                expr: "x^2",
                color: GREEN,
                dashed: false,
            },
            Series {
                expr: "1.15^x",
                color: PURPLE,
                dashed: false,
            },
        ],
    },
    // 收益递减三型:开方(无界减速)/ 有理式(渐近饱和)/ 几何(半衰饱和)。
    Figure {
        file: "diminishing.svg",
        title: "Diminishing returns: sqrt / rational / geometric",
        x_max: 100.0,
        y_max: 100.0,
        series: &[
            Series {
                expr: "10 * x^0.5",
                color: BLUE,
                dashed: false,
            },
            Series {
                expr: "100 * x / (x + 25)",
                color: ORANGE,
                dashed: false,
            },
            Series {
                expr: "100 * (1 - 0.5^x)",
                color: GREEN,
                dashed: false,
            },
        ],
    },
    // 封顶两型:clamp 硬上限(超线全蒸发)vs 分段折减软上限(超线减半计)。
    // 虚线为未封顶参考线。
    Figure {
        file: "softcap.svg",
        title: "Hard cap (clamp) vs soft cap (piecewise knee)",
        x_max: 100.0,
        y_max: 110.0,
        series: &[
            Series {
                expr: "clamp(x, 0, 100)",
                color: BLUE,
                dashed: false,
            },
            Series {
                expr: "x < 50 ? x : 50 + (x - 50) * 0.5",
                color: ORANGE,
                dashed: false,
            },
            Series {
                expr: "x",
                color: PURPLE,
                dashed: true,
            },
        ],
    },
    // 阶梯量化:10 级一档,虚线为线性参考。
    Figure {
        file: "ladder.svg",
        title: "Tier ladder: floor(x / 10) * 10 vs linear",
        x_max: 100.0,
        y_max: 100.0,
        series: &[
            Series {
                expr: "floor(x / 10) * 10",
                color: BLUE,
                dashed: false,
            },
            Series {
                expr: "x",
                color: PURPLE,
                dashed: true,
            },
        ],
    },
    // 分段门槛:30 前收益 0,30-60 线性,60 后封顶 120;虚线为线性参考。
    Figure {
        file: "bracket.svg",
        title: "Threshold bracket via nested ternary",
        x_max: 100.0,
        y_max: 130.0,
        series: &[
            Series {
                expr: "x < 30 ? 0 : (x < 60 ? (x - 30) * 2 : 120)",
                color: BLUE,
                dashed: false,
            },
            Series {
                expr: "x",
                color: PURPLE,
                dashed: true,
            },
        ],
    },
];

// 画布与边距(px)。
const W: f64 = 640.0;
const H: f64 = 360.0;
const MARGIN_L: f64 = 46.0;
const MARGIN_R: f64 = 14.0;
const MARGIN_T: f64 = 34.0;
const MARGIN_B: f64 = 34.0;
/// 每条曲线采样点数(区间数)。
const SAMPLES: usize = 200;

fn sx(x: f64, x_max: f64) -> f64 {
    MARGIN_L + (W - MARGIN_L - MARGIN_R) * x / x_max
}

fn sy(y: f64, y_max: f64) -> f64 {
    H - MARGIN_B - (H - MARGIN_T - MARGIN_B) * y / y_max
}

/// SVG 文本节点转义(表达式含 < > & 时必须转义)。
fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn fmt_tick(v: f64) -> String {
    if (v - v.round()).abs() < 1e-9 {
        format!("{}", v.round() as i64)
    } else {
        format!("{v:.1}")
    }
}

fn render(fig: &Figure) -> String {
    let mut s = String::new();
    s.push_str(&format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{W}\" height=\"{H}\" \
         viewBox=\"0 0 {W} {H}\" font-family=\"sans-serif\">\n"
    ));
    s.push_str(&format!(
        "<rect width=\"{W}\" height=\"{H}\" fill=\"#ffffff\"/>\n"
    ));

    // 网格与刻度:两轴各 5 格。
    for i in 0..=5 {
        let gx = fig.x_max * i as f64 / 5.0;
        let px = sx(gx, fig.x_max);
        s.push_str(&format!(
            "<line x1=\"{px:.1}\" y1=\"{MARGIN_T}\" x2=\"{px:.1}\" y2=\"{H_MINUS_B}\" stroke=\"#e6e6e6\"/>\n",
            H_MINUS_B = H - MARGIN_B
        ));
        s.push_str(&format!(
            "<text x=\"{px:.1}\" y=\"{}\" font-size=\"10\" fill=\"#666\" text-anchor=\"middle\">{}</text>\n",
            H - MARGIN_B + 14.0,
            fmt_tick(gx)
        ));
        let gy = fig.y_max * i as f64 / 5.0;
        let py = sy(gy, fig.y_max);
        s.push_str(&format!(
            "<line x1=\"{MARGIN_L}\" y1=\"{py:.1}\" x2=\"{}\" y2=\"{py:.1}\" stroke=\"#e6e6e6\"/>\n",
            W - MARGIN_R
        ));
        s.push_str(&format!(
            "<text x=\"{}\" y=\"{py:.1}\" font-size=\"10\" fill=\"#666\" text-anchor=\"end\" \
             dominant-baseline=\"middle\">{}</text>\n",
            MARGIN_L - 6.0,
            fmt_tick(gy)
        ));
    }

    // 轴线。
    s.push_str(&format!(
        "<line x1=\"{MARGIN_L}\" y1=\"{MARGIN_T}\" x2=\"{MARGIN_L}\" y2=\"{}\" stroke=\"#999\"/>\n",
        H - MARGIN_B
    ));
    s.push_str(&format!(
        "<line x1=\"{MARGIN_L}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"#999\"/>\n",
        H - MARGIN_B,
        W - MARGIN_R,
        H - MARGIN_B
    ));

    // 标题。
    s.push_str(&format!(
        "<text x=\"{MARGIN_L}\" y=\"20\" font-size=\"13\" fill=\"#333\">{}</text>\n",
        esc(fig.title)
    ));

    // 曲线:逐点走真实求值器;超出画布的值靠 clip 裁剪,不静默改值。
    s.push_str(&format!(
        "<clipPath id=\"plot\"><rect x=\"{MARGIN_L}\" y=\"{MARGIN_T}\" width=\"{}\" height=\"{}\"/></clipPath>\n",
        W - MARGIN_L - MARGIN_R,
        H - MARGIN_T - MARGIN_B
    ));
    s.push_str("<g clip-path=\"url(#plot)\">\n");
    for ser in fig.series {
        let f = formula::compile(ser.expr, &["x"])
            .unwrap_or_else(|e| panic!("documented expression `{}` failed: {e}", ser.expr));
        let mut pts = String::new();
        for i in 0..=SAMPLES {
            let x = fig.x_max * i as f64 / SAMPLES as f64;
            let y = f.eval(&[x]);
            if i > 0 {
                pts.push(' ');
            }
            pts.push_str(&format!("{:.1},{:.1}", sx(x, fig.x_max), sy(y, fig.y_max)));
        }
        let dash = if ser.dashed {
            " stroke-dasharray=\"5 4\""
        } else {
            ""
        };
        s.push_str(&format!(
            "<polyline points=\"{pts}\" fill=\"none\" stroke=\"{}\" stroke-width=\"2\" \
             stroke-linejoin=\"round\"{dash}/>\n",
            ser.color
        ));
    }
    s.push_str("</g>\n");

    // 图例:右上角,线样 + 表达式原文(等宽)。
    for (row, ser) in fig.series.iter().enumerate() {
        let y = MARGIN_T + 14.0 + 16.0 * row as f64;
        s.push_str(&format!(
            "<line x1=\"{}\" y1=\"{y}\" x2=\"{}\" y2=\"{y}\" stroke=\"{}\" stroke-width=\"2\"{}/>\n",
            W - MARGIN_R - 158.0,
            W - MARGIN_R - 138.0,
            ser.color,
            if ser.dashed { " stroke-dasharray=\"5 4\"" } else { "" }
        ));
        s.push_str(&format!(
            "<text x=\"{}\" y=\"{y}\" font-size=\"11\" font-family=\"monospace\" fill=\"#333\" \
             text-anchor=\"end\" dominant-baseline=\"middle\">{}</text>\n",
            W - MARGIN_R - 144.0,
            esc(ser.expr)
        ));
    }

    s.push_str("</svg>\n");
    s
}

fn main() {
    let out_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../docs/assets/formulas");
    fs::create_dir_all(&out_dir).expect("create docs/assets/formulas");
    for fig in FIGURES {
        let path = out_dir.join(fig.file);
        fs::write(&path, render(fig)).expect("write svg");
        println!("written {}", path.display());
    }
}
