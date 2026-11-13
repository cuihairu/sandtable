//! 报告图表面:手写内联 SVG(柱图 + 折线图,离线无 JS)。

use super::html::{esc, f};

/// 分群条形图(竖条):类目轴 + 零基线,值标注条顶。与折线图共用画幅常量。
pub(crate) fn svg_bars(
    title: &str,
    cats: &[&str],
    vals: &[f64],
    color: &str,
    fmt: &dyn Fn(f64) -> String,
) -> String {
    const W: f64 = 460.0;
    const H: f64 = 190.0;
    const PL: f64 = 56.0;
    const PR: f64 = 14.0;
    const PT: f64 = 34.0;
    const PB: f64 = 34.0;
    let n = cats.len().min(vals.len());
    if n == 0 {
        return format!("<div class=\"mut\">{}:无数据</div>", esc(title));
    }
    let max = vals[..n].iter().copied().fold(0.0_f64, f64::max).max(1e-12);
    let y1 = max * 1.12;
    let sy = |y: f64| PT + (1.0 - y / y1) * (H - PT - PB);
    let slot = (W - PL - PR) / n as f64;
    let mut g = String::new();
    for i in 0..n {
        let v = vals[i].max(0.0);
        let bx = PL + slot * i as f64 + slot * 0.18;
        let bw = slot * 0.64;
        let by = sy(v);
        g.push_str(&format!(
            "<rect x=\"{bx:.1}\" y=\"{by:.1}\" width=\"{bw:.1}\" height=\"{:.1}\" fill=\"{color}\" opacity=\"0.85\"/>",
            H - PB - by
        ));
        let cx = bx + bw / 2.0;
        g.push_str(&format!(
            "<text x=\"{cx:.1}\" y=\"{ty:.1}\" font-size=\"9.5\" fill=\"#1f2328\" text-anchor=\"middle\">{}</text>",
            fmt(vals[i]),
            ty = (by - 5.0).max(PT + 8.0)
        ));
        g.push_str(&format!(
            "<text x=\"{cx:.1}\" y=\"{ty:.1}\" font-size=\"10\" fill=\"#656d76\" text-anchor=\"middle\">{}</text>",
            esc(cats[i]),
            ty = H - PB + 14.0
        ));
    }
    g.push_str(&format!(
        "<line x1=\"{pl}\" y1=\"{yb}\" x2=\"{pr}\" y2=\"{yb}\" stroke=\"#d8dee4\" stroke-width=\"1\"/>",
        pl = PL,
        pr = W - PR,
        yb = H - PB
    ));
    g.push_str(&format!(
        "<text x=\"{lx:.1}\" y=\"{ty:.1}\" font-size=\"10\" fill=\"#656d76\" text-anchor=\"end\">{}</text>",
        fmt(0.0),
        lx = PL - 6.0,
        ty = H - PB
    ));
    g.push_str(&format!(
        "<text x=\"{x:.1}\" y=\"17\" font-size=\"11\" fill=\"#1f2328\" font-weight=\"600\" text-anchor=\"middle\">{}</text>",
        esc(title),
        x = (PL + W - PR) / 2.0
    ));
    format!("<svg viewBox=\"0 0 {W} {H}\" role=\"img\">{g}</svg>")
}

pub(crate) struct Series<'a> {
    /// 图例文字;None = 不进图例(单序列图的标题已表意)
    pub(crate) label: Option<&'a str>,
    pub(crate) ys: &'a [f64],
    pub(crate) color: &'a str,
}

pub(crate) struct Chart<'a> {
    pub(crate) title: &'a str,
    pub(crate) x_label: &'a str,
    pub(crate) xs: &'a [f64],
    /// 多序列共用 x 轴与 y 量纲;CI 须挂在首序列上
    pub(crate) series: Vec<Series<'a>>,
    /// 每点 CI 须 (lo, hi);None = 无须
    pub(crate) ci: Option<&'a [(f64, f64)]>,
    /// 基线(虚线)与可行区间带,随 x 轴量纲
    pub(crate) mark: Option<(f64, Option<(f64, f64)>)>,
}

pub(crate) fn svg_chart(c: &Chart) -> String {
    const W: f64 = 460.0;
    const H: f64 = 190.0;
    const PL: f64 = 56.0;
    const PR: f64 = 14.0;
    const PT: f64 = 34.0;
    const PB: f64 = 34.0;
    if c.xs.is_empty() || c.series.is_empty() || c.series.iter().all(|s| s.ys.is_empty()) {
        return format!("<div class=\"mut\">{}:无数据</div>", esc(c.title));
    }
    let n = c.xs.len();
    let mut x0 = f64::INFINITY;
    let mut x1 = f64::NEG_INFINITY;
    let mut y0 = f64::INFINITY;
    let mut y1 = f64::NEG_INFINITY;
    for &x in c.xs {
        x0 = x0.min(x);
        x1 = x1.max(x);
    }
    for s in &c.series {
        for &y in s.ys.iter().take(n) {
            y0 = y0.min(y);
            y1 = y1.max(y);
        }
    }
    if let Some(ci) = c.ci {
        for &(lo, hi) in &ci[..n.min(ci.len())] {
            y0 = y0.min(lo);
            y1 = y1.max(hi);
        }
    }
    if let Some((b, band)) = c.mark {
        // 基线与区间带是 x 轴(参数)量纲,纳入范围免裁剪
        x0 = x0.min(b);
        x1 = x1.max(b);
        if let Some((a, d)) = band {
            x0 = x0.min(a);
            x1 = x1.max(d);
        }
    }
    if x0 == x1 {
        x0 -= 0.5;
        x1 += 0.5;
    }
    if (y1 - y0).abs() < f64::EPSILON {
        y0 -= 0.5;
        y1 += 0.5;
    } else {
        let pad = (y1 - y0) * 0.06;
        y0 -= pad;
        y1 += pad;
    }
    let sx = |x: f64| PL + (x - x0) / (x1 - x0) * (W - PL - PR);
    let sy = |y: f64| PT + (1.0 - (y - y0) / (y1 - y0)) * (H - PT - PB);
    let mut g = String::new();
    if let Some((_, Some((a, d)))) = c.mark {
        let (rx0, rx1) = (sx(a).max(PL), sx(d).min(W - PR));
        if rx1 > rx0 {
            g.push_str(&format!(
                "<rect x=\"{rx0:.1}\" y=\"{PT}\" width=\"{w:.1}\" height=\"{h:.1}\" fill=\"#0969da\" opacity=\"0.10\"/>",
                w = rx1 - rx0,
                h = H - PT - PB
            ));
        }
    }
    if let Some((b, _)) = c.mark {
        let x = sx(b);
        g.push_str(&format!(
            "<line x1=\"{x:.1}\" y1=\"{PT}\" x2=\"{x:.1}\" y2=\"{yb:.1}\" stroke=\"#cf222e\" stroke-width=\"1\" stroke-dasharray=\"4 3\"/>",
            yb = H - PB
        ));
        g.push_str(&format!(
            "<text x=\"{x:.1}\" y=\"{ty:.1}\" font-size=\"9\" fill=\"#cf222e\" text-anchor=\"middle\">基线</text>",
            ty = PT + 11.0
        ));
    }
    if let Some(ci) = c.ci {
        for (i, &(lo, hi)) in ci.iter().enumerate().take(n) {
            let x = sx(c.xs[i]);
            let (lo, hi) = (lo.max(y0), hi.min(y1));
            let (ya, yb) = (sy(hi), sy(lo));
            g.push_str(&format!(
                "<line x1=\"{x:.1}\" y1=\"{ya:.1}\" x2=\"{x:.1}\" y2=\"{yb:.1}\" stroke=\"#9a6700\" stroke-width=\"1.4\" opacity=\"0.9\"/>"
            ));
            g.push_str(&format!(
                "<line x1=\"{lx:.1}\" y1=\"{ya:.1}\" x2=\"{rx:.1}\" y2=\"{ya:.1}\" stroke=\"#9a6700\" stroke-width=\"1.4\" opacity=\"0.9\"/>",
                lx = x - 3.0,
                rx = x + 3.0
            ));
            g.push_str(&format!(
                "<line x1=\"{lx:.1}\" y1=\"{yb:.1}\" x2=\"{rx:.1}\" y2=\"{yb:.1}\" stroke=\"#9a6700\" stroke-width=\"1.4\" opacity=\"0.9\"/>",
                lx = x - 3.0,
                rx = x + 3.0
            ));
        }
    }
    for (si, s) in c.series.iter().enumerate() {
        let m = n.min(s.ys.len());
        if m == 0 {
            continue;
        }
        let poly: String = (0..m)
            .map(|i| format!("{:.1},{:.1}", sx(c.xs[i]), sy(s.ys[i])))
            .collect::<Vec<_>>()
            .join(" ");
        g.push_str(&format!(
            "<polyline points=\"{poly}\" fill=\"none\" stroke=\"{}\" stroke-width=\"{}\" stroke-linejoin=\"round\"/>",
            s.color,
            if si == 0 { "1.8" } else { "1.6" }
        ));
        for i in 0..m {
            let (x, y) = (sx(c.xs[i]), sy(s.ys[i]));
            g.push_str(&format!(
                "<circle cx=\"{x:.1}\" cy=\"{y:.1}\" r=\"2.6\" fill=\"{}\"/>",
                s.color
            ));
        }
    }
    // 多序列图例:左上竖排,色块 + 文字
    let labeled: Vec<&Series> = c.series.iter().filter(|s| s.label.is_some()).collect();
    if labeled.len() > 1 {
        for (i, s) in labeled.iter().enumerate() {
            let ly = PT + 10.0 + i as f64 * 14.0;
            g.push_str(&format!(
                "<rect x=\"{lx:.1}\" y=\"{ly:.1}\" width=\"9\" height=\"9\" fill=\"{}\"/>",
                s.color,
                lx = PL + 8.0
            ));
            g.push_str(&format!(
                "<text x=\"{lx:.1}\" y=\"{ty:.1}\" font-size=\"10\" fill=\"#1f2328\">{}</text>",
                esc(s.label.unwrap_or("")),
                lx = PL + 21.0,
                ty = ly + 8.5
            ));
        }
    }
    // 框线与刻度文字
    g.push_str(&format!(
        "<line x1=\"{pl}\" y1=\"{yb}\" x2=\"{pr}\" y2=\"{yb}\" stroke=\"#d8dee4\" stroke-width=\"1\"/>",
        pl = PL,
        pr = W - PR,
        yb = H - PB
    ));
    g.push_str(&format!(
        "<text x=\"{lx:.1}\" y=\"{ty:.1}\" font-size=\"10\" fill=\"#656d76\" text-anchor=\"end\">{}</text>",
        f(y1),
        lx = PL - 6.0,
        ty = PT + 8.0
    ));
    g.push_str(&format!(
        "<text x=\"{lx:.1}\" y=\"{ty:.1}\" font-size=\"10\" fill=\"#656d76\" text-anchor=\"end\">{}</text>",
        f(y0),
        lx = PL - 6.0,
        ty = H - PB
    ));
    g.push_str(&format!(
        "<text x=\"{x:.1}\" y=\"{ty:.1}\" font-size=\"10\" fill=\"#656d76\" text-anchor=\"middle\">{}</text>",
        f(c.xs[0]),
        x = sx(c.xs[0]),
        ty = H - PB + 14.0
    ));
    g.push_str(&format!(
        "<text x=\"{x:.1}\" y=\"{ty:.1}\" font-size=\"10\" fill=\"#656d76\" text-anchor=\"middle\">{}</text>",
        f(c.xs[n - 1]),
        x = sx(c.xs[n - 1]),
        ty = H - PB + 14.0
    ));
    g.push_str(&format!(
        "<text x=\"{x:.1}\" y=\"17\" font-size=\"11\" fill=\"#1f2328\" font-weight=\"600\" text-anchor=\"middle\">{}</text>",
        esc(c.title),
        x = (PL + W - PR) / 2.0
    ));
    g.push_str(&format!(
        "<text x=\"{x:.1}\" y=\"{ty:.1}\" font-size=\"10\" fill=\"#656d76\" text-anchor=\"middle\">{}</text>",
        esc(c.x_label),
        x = (PL + W - PR) / 2.0,
        ty = H - 6.0
    ));
    format!("<svg viewBox=\"0 0 {W} {H}\" role=\"img\">{g}</svg>")
}
