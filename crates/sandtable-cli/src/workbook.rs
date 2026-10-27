//! XLSX 工作流数据包(todo「Excel / JMP / Origin 文件工作流」;文档 09 章数据契约)。
//!
//! 产物是唯一数据源:同一份字段、同一顺序、同一转义直接进多工作表工作簿,
//! 本模块不重算数值、不改列名、不补空列(字段映射复用 = 读同一份产物)。
//! 字段字典来自内核 [`kpi_dict`](sandtable_core::kpi_dict),与 CSV 列名、
//! sweep.json 约束名同口径,壳层不复制指标清单。
//!
//! 红线:
//! - 缺席的产物**不出表也不出空表**,只记进 manifest 的 absent 行(缺席 ≠ 空表);
//! - 一个 sheet 一张表、单行表头、无合并单元格、无尾随空行——Power Query 与
//!   数据透视表按列直读,不做多行表头推断;
//! - 数值单元格走真实数值(不是文本数字),透视 / 排序 / 求和不产生
//!   「文本型数字」告警;XLSX 单元格精度为 15 位有效数字,是格式上限;
//! - 与参数表导入导出(两条 CSV 通路,文档 09 章)互补:工作簿是**只读数据
//!   交付**,不是配置入口,不做多工作表 → 配置树映射(该结论不因本命令改变)。

use std::fs;
use std::io::Write as _;
use std::path::Path;

use anyhow::{bail, Context};

use sandtable_core::experiment::Comparison;
use sandtable_core::kpi_dict::{self, MetricKind};

/// 归档时间戳恒为 1980-01-01 00:00:00(与 .sandtable 项目包同一条纪律):
/// 同一输入两次打包字节一致,工作簿可做产物对账,不混入墙钟。
const FIXED_MTIME: (u16, u8, u8, u8, u8, u8) = (1980, 1, 1, 0, 0, 0);

/// 一张表:单行表头 + 数据行。列数以表头为准,行不越界也不补空列。
pub struct Sheet {
    name: String,
    header: Vec<String>,
    rows: Vec<Vec<Cell>>,
}

/// 单元格:数值走真数值;空字段是空单元格(区别于空串文本)。
#[derive(Debug, Clone, PartialEq)]
enum Cell {
    Text(String),
    Number(f64),
    Blank,
}

impl Cell {
    /// 产物字段 → 单元格:可解析为有限浮点的是数值,其余按文本,空串留空。
    fn from_field(field: &str) -> Self {
        if field.is_empty() {
            return Cell::Blank;
        }
        match field.parse::<f64>() {
            Ok(v) if v.is_finite() => Cell::Number(v),
            _ => Cell::Text(field.to_string()),
        }
    }

    /// 标识 / 版本类字段 → 文本单元格:不做数值推断(版本号 "1" 是标签,
    /// 不是数,推成数值会把 manifest 的版本列变成分列混型)。
    fn from_text(field: &str) -> Self {
        if field.is_empty() {
            Cell::Blank
        } else {
            Cell::Text(field.to_string())
        }
    }

    fn render(&self, cell_ref: &str, out: &mut String) {
        match self {
            Cell::Blank => {}
            Cell::Text(text) => {
                out.push_str("<c r=\"");
                out.push_str(cell_ref);
                out.push_str("\" t=\"inlineStr\"><is><t xml:space=\"preserve\">");
                out.push_str(&xml_escape(text));
                out.push_str("</t></is></c>");
            }
            Cell::Number(value) => {
                out.push_str("<c r=\"");
                out.push_str(cell_ref);
                out.push_str("\"><v>");
                out.push_str(&number_text(*value));
                out.push_str("</v></c>");
            }
        }
    }
}

/// 数值文本:Rust Display 是最短往返表示,parse 回同一 f64(与产物 CSV 的
/// `to_string` 同口径,读入输出不引入数值漂移)。
fn number_text(value: f64) -> String {
    value.to_string()
}

fn xml_escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            other => out.push(other),
        }
    }
    out
}

/// 0 基列号 → Excel 列标(A、Z、AA)。
fn col_letter(index: usize) -> String {
    let mut out = String::new();
    let mut n = index;
    loop {
        out.insert(0, (b'A' + (n % 26) as u8) as char);
        if n < 26 {
            break;
        }
        n = n / 26 - 1;
    }
    out
}

impl Sheet {
    fn new(name: &str, header: Vec<String>) -> Self {
        Sheet {
            name: name.to_string(),
            header,
            rows: Vec::new(),
        }
    }

    /// 文本行入表:逐字段转单元格(数值字段成真数值)。
    fn push_rows(&mut self, rows: Vec<Vec<String>>) {
        self.rows.extend(rows.into_iter().map(|r| {
            r.into_iter()
                .map(|field| Cell::from_field(&field))
                .collect()
        }));
    }

    /// 全文本行入表:不做数值推断(manifest 这类"清单表"的版本 / 计数列
    /// 是标签语义,混进数值单元格反而让列内类型不一致)。
    fn push_text_rows(&mut self, rows: Vec<Vec<String>>) {
        self.rows.extend(
            rows.into_iter()
                .map(|r| r.into_iter().map(|field| Cell::from_text(&field)).collect()),
        );
    }

    fn row_count(&self) -> usize {
        self.rows.len()
    }

    fn col_count(&self) -> usize {
        self.header.len()
    }

    fn name(&self) -> &str {
        &self.name
    }

    /// 工作表 XML:首个 sheetData 前无多余节点,单行表头在 r=1。
    fn xml(&self) -> String {
        let mut out = String::new();
        out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n");
        out.push_str(
            "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">",
        );
        out.push_str("<sheetData>");
        out.push_str("<row r=\"1\">");
        for (col, name) in self.header.iter().enumerate() {
            Cell::Text(name.clone()).render(&format!("{}1", col_letter(col)), &mut out);
        }
        out.push_str("</row>");
        for (row_index, row) in self.rows.iter().enumerate() {
            let row_num = row_index + 2;
            out.push_str("<row r=\"");
            out.push_str(&row_num.to_string());
            out.push_str("\">");
            for (col, cell) in row.iter().enumerate() {
                cell.render(&format!("{}{}", col_letter(col), row_num), &mut out);
            }
            out.push_str("</row>");
        }
        out.push_str("</sheetData></worksheet>");
        out
    }
}

/// 工作簿: sheets 按加入顺序排列,首个是 manifest。
pub struct Workbook {
    sheets: Vec<Sheet>,
}

impl Workbook {
    pub fn sheet_count(&self) -> usize {
        self.sheets.len()
    }

    /// 写 .xlsx(deflate 归档;时间戳恒定,同输入同字节)。
    pub fn write(&self, path: &Path) -> anyhow::Result<()> {
        if self.sheets.is_empty() {
            bail!("工作簿没有工作表");
        }
        // 逐表加入:与**已加入**的表名比对,不拿自己与自己撞名。
        let mut names: Vec<String> = Vec::with_capacity(self.sheets.len());
        for sheet in &self.sheets {
            let taken: Vec<&str> = names.iter().map(String::as_str).collect();
            names.push(sanitize_sheet_name(sheet.name(), &taken));
        }
        let (y, mo, d, h, mi, s) = FIXED_MTIME;
        let mtime = zip::DateTime::from_date_and_time(y, mo, d, h, mi, s)
            .map_err(|e| anyhow::anyhow!("固定时间戳非法: {e:?}"))?;
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .last_modified_time(mtime);

        let file =
            fs::File::create(path).with_context(|| format!("创建 {} 失败", path.display()))?;
        let mut zw = zip::ZipWriter::new(file);
        let mut entry = |name: &str, body: &str| -> anyhow::Result<()> {
            zw.start_file(name, opts)
                .with_context(|| format!("写入 {name} 失败"))?;
            zw.write_all(body.as_bytes())?;
            Ok(())
        };

        entry("[Content_Types].xml", &content_types_xml(names.len()))?;
        entry("_rels/.rels", ROOT_RELS)?;
        entry("xl/workbook.xml", &workbook_xml(&names))?;
        entry(
            "xl/_rels/workbook.xml.rels",
            &workbook_rels_xml(names.len()),
        )?;
        for (index, sheet) in self.sheets.iter().enumerate() {
            entry(
                &format!("xl/worksheets/sheet{}.xml", index + 1),
                &sheet.xml(),
            )?;
        }
        zw.finish().context("收尾工作簿失败")?;
        Ok(())
    }
}

/// 工作表名合法化:去禁用字符、按字符(非字节)截到 31 位、重名加序号后缀。
fn sanitize_sheet_name(raw: &str, taken: &[&str]) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| match c {
            '[' | ']' | ':' | '*' | '?' | '/' | '\\' => '_',
            other => other,
        })
        .collect();
    let name: String = cleaned.chars().take(31).collect();
    if !taken.contains(&name.as_str()) {
        return name;
    }
    let mut suffixed: String = name.chars().take(29).collect();
    suffixed.push_str(&format!("-{}", taken.len() + 1));
    suffixed
}

fn content_types_xml(sheet_count: usize) -> String {
    let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n");
    out.push_str("<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">");
    out.push_str("<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>");
    out.push_str("<Default Extension=\"xml\" ContentType=\"application/xml\"/>");
    out.push_str("<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>");
    for index in 1..=sheet_count {
        out.push_str(&format!(
            "<Override PartName=\"/xl/worksheets/sheet{index}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>"
        ));
    }
    out.push_str("</Types>");
    out
}

fn workbook_xml(names: &[String]) -> String {
    let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n");
    out.push_str("<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets>");
    for (index, name) in names.iter().enumerate() {
        out.push_str(&format!(
            "<sheet name=\"{}\" sheetId=\"{}\" r:id=\"rId{}\"/>",
            xml_escape(name),
            index + 1,
            index + 1
        ));
    }
    out.push_str("</sheets></workbook>");
    out
}

fn workbook_rels_xml(sheet_count: usize) -> String {
    let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n");
    out.push_str(
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
    );
    for index in 1..=sheet_count {
        out.push_str(&format!(
            "<Relationship Id=\"rId{index}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet{index}.xml\"/>"
        ));
    }
    out.push_str("</Relationships>");
    out
}

const ROOT_RELS: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>";

/// 读产物 CSV:首行是表头;支持引号字段(内嵌逗号 / 换行 / 双引号转义),
/// 与本 CLI `csv_field` 写出端同一套 RFC 4180 口径。
fn read_csv(path: &Path) -> anyhow::Result<(Vec<String>, Vec<Vec<String>>)> {
    let text = fs::read_to_string(path).with_context(|| format!("读 {} 失败", path.display()))?;
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut field = String::new();
    let mut row: Vec<String> = Vec::new();
    let mut in_quotes = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    field.push('"');
                } else {
                    in_quotes = false;
                }
            } else {
                field.push(c);
            }
            continue;
        }
        match c {
            '"' => in_quotes = true,
            ',' => {
                row.push(std::mem::take(&mut field));
            }
            '\r' => {}
            '\n' => {
                row.push(std::mem::take(&mut field));
                if !(row.len() == 1 && row[0].is_empty()) {
                    rows.push(std::mem::take(&mut row));
                } else {
                    row.clear();
                }
            }
            other => field.push(other),
        }
    }
    if in_quotes {
        bail!("{} 的引号字段未闭合", path.display());
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    let Some(header) = rows.first() else {
        bail!("{} 是空文件(缺表头)", path.display());
    };
    Ok((header.clone(), rows.into_iter().skip(1).collect()))
}

/// manifest 工作表:工作簿自描述(sheet 清单 + 版本 + 缺席产物记录)。
/// `data` 是本工作簿除 manifest 外的全部表(已含 metric_dictionary),
/// manifest 自己的规模由 `self_rows` 给出,因此清单不含任何缺项。
fn manifest_sheet(
    data: &[(&'static str, usize, usize)],
    self_rows: usize,
    absent: &[&'static str],
    model_version: &str,
    dict_version: &str,
) -> Sheet {
    let mut sheet = Sheet::new(
        "manifest",
        vec![
            "name".into(),
            "kind".into(),
            "source".into(),
            "rows".into(),
            "cols".into(),
            "note".into(),
        ],
    );
    let version_rows = [
        ("model_version", "version", "core", model_version),
        (
            "metric_dict_version",
            "version",
            "core::kpi_dict",
            dict_version,
        ),
    ];
    for (name, kind, source, version) in version_rows {
        sheet.push_text_rows(vec![vec![
            name.to_string(),
            kind.to_string(),
            source.to_string(),
            version.to_string(),
            String::new(),
            String::new(),
        ]]);
    }
    for (name, rows, cols) in [("manifest", self_rows, 6)]
        .into_iter()
        .chain(data.iter().map(|(n, r, c)| (*n, *r, *c)))
    {
        sheet.push_text_rows(vec![vec![
            name.to_string(),
            "sheet".into(),
            source_of(name).to_string(),
            rows.to_string(),
            cols.to_string(),
            String::new(),
        ]]);
    }
    for artifact in absent {
        sheet.push_text_rows(vec![vec![
            (*artifact).to_string(),
            "absent".into(),
            String::new(),
            String::new(),
            String::new(),
            "产物缺失,未生成工作表(不补空表)".into(),
        ]]);
    }
    sheet
}

/// 工作表名 → 数据来源(产物文件或内核来源);全函数,不做兜底猜测。
fn source_of(sheet_name: &str) -> &'static str {
    match sheet_name {
        "manifest" => "this workbook",
        "metric_dictionary" => "core::kpi_dict",
        "parameters" => "params.csv",
        "candidates" => "candidates.csv",
        "summary" => "summary.csv",
        "comparison" => "comparison.json",
        "daily" => "days.csv",
        _ => "unknown",
    }
}

/// 字段字典工作表:内核指标口径(与 CSV 列名、sweep.json 约束名同口径)。
fn metric_dictionary_sheet(dict_version: &str) -> Sheet {
    let mut sheet = Sheet::new(
        "metric_dictionary",
        vec![
            "id".into(),
            "kind".into(),
            "decimals".into(),
            "optional".into(),
            "days_required".into(),
            "requires_gacha".into(),
            "requires_loot".into(),
            "dict_version".into(),
        ],
    );
    for definition in kpi_dict::metric_definitions() {
        let kind = match definition.kind {
            MetricKind::Ratio => "ratio",
            MetricKind::Value => "value",
        };
        sheet.push_rows(vec![vec![
            definition.id.to_string(),
            kind.to_string(),
            definition.decimals.to_string(),
            definition.optional.to_string(),
            definition.days_required.to_string(),
            definition.requires_gacha.to_string(),
            definition.requires_loot.to_string(),
            dict_version.to_string(),
        ]]);
    }
    sheet
}

/// 差异工作表:A/B 比较,一行一指标;字段与 comparison.json 同名同义。
fn comparison_sheet(comparison: &Comparison) -> Sheet {
    let mut sheet = Sheet::new(
        "comparison",
        vec![
            "metric".into(),
            "arm_a_mean".into(),
            "arm_a_ci95_lo".into(),
            "arm_a_ci95_hi".into(),
            "arm_a_n".into(),
            "arm_b_mean".into(),
            "arm_b_ci95_lo".into(),
            "arm_b_ci95_hi".into(),
            "arm_b_n".into(),
            "diff_mean".into(),
            "diff_ci95_lo".into(),
            "diff_ci95_hi".into(),
            "effect_size_d".into(),
            "verdict".into(),
        ],
    );
    let verdict = match serde_json::to_value(comparison.verdict) {
        Ok(serde_json::Value::String(text)) => text,
        _ => comparison.verdict.as_str().to_string(),
    };
    sheet.push_rows(vec![vec![
        comparison.metric.clone(),
        number_text(comparison.arm_a.mean),
        number_text(comparison.arm_a.ci95_lo),
        number_text(comparison.arm_a.ci95_hi),
        comparison.arm_a.n.to_string(),
        number_text(comparison.arm_b.mean),
        number_text(comparison.arm_b.ci95_lo),
        number_text(comparison.arm_b.ci95_hi),
        comparison.arm_b.n.to_string(),
        number_text(comparison.diff_mean),
        number_text(comparison.diff_ci95_lo),
        number_text(comparison.diff_ci95_hi),
        number_text(comparison.effect_size_d),
        verdict,
    ]]);
    sheet
}

/// 装配结果:工作簿 + 各表规模 + 缺席产物清单(供 CLI 回执)。
pub struct Package {
    pub workbook: Workbook,
    pub present: Vec<(&'static str, usize, usize)>,
    pub absent: Vec<&'static str>,
}

/// 装配工作流数据包:读 dir 下已有产物,缺席记 manifest,不出空表。
pub fn build(dir: &Path) -> anyhow::Result<Package> {
    if !dir.is_dir() {
        bail!(
            "{} 不是目录(应指向 simulate/sweep/compare 的 --out 产物目录)",
            dir.display()
        );
    }
    let mut data_present: Vec<(&'static str, usize, usize)> = Vec::new();
    let mut absent: Vec<&'static str> = Vec::new();
    let mut sheets: Vec<Sheet> = Vec::new();

    push_csv(
        dir,
        "parameters",
        "params.csv",
        &mut sheets,
        &mut data_present,
        &mut absent,
    )?;
    push_csv(
        dir,
        "candidates",
        "candidates.csv",
        &mut sheets,
        &mut data_present,
        &mut absent,
    )?;
    push_csv(
        dir,
        "summary",
        "summary.csv",
        &mut sheets,
        &mut data_present,
        &mut absent,
    )?;

    let comparison_path = dir.join("comparison.json");
    if comparison_path.exists() {
        let text = fs::read_to_string(&comparison_path).context("读 comparison.json 失败")?;
        #[derive(serde::Deserialize)]
        struct Artifact {
            comparison: Comparison,
        }
        let artifact: Artifact = serde_json::from_str(&text)
            .with_context(|| format!("解析 {} 失败", comparison_path.display()))?;
        let sheet = comparison_sheet(&artifact.comparison);
        let row_count = sheet.row_count();
        let col_count = sheet.col_count();
        sheets.push(sheet);
        data_present.push(("comparison", row_count, col_count));
    } else {
        absent.push("comparison.json");
    }

    push_csv(
        dir,
        "daily",
        "days.csv",
        &mut sheets,
        &mut data_present,
        &mut absent,
    )?;

    if data_present.is_empty() {
        bail!(
            "{} 里没有任何已知产物(期待 params.csv / candidates.csv / summary.csv / comparison.json / days.csv 之一,文档 09 章)",
            dir.display()
        );
    }

    let dict_version = kpi_dict::METRIC_DICT_VERSION;
    let dict_rows = kpi_dict::metric_definitions().len();
    // 先把全量表清单定下来(含 metric_dictionary 与 manifest 自己),
    // 再据此生成 manifest,否则 manifest 会漏报自己与字典表。
    data_present.push(("metric_dictionary", dict_rows, 8));
    let self_rows = manifest_row_count(&data_present, &absent);
    let mut present: Vec<(&'static str, usize, usize)> = vec![("manifest", self_rows, 6)];
    present.extend(data_present.iter().copied());
    let mut wb_sheets = sheets;
    wb_sheets.insert(
        0,
        manifest_sheet(
            &data_present,
            self_rows,
            &absent,
            sandtable_core::MODEL_VERSION,
            dict_version,
        ),
    );
    wb_sheets.push(metric_dictionary_sheet(dict_version));
    Ok(Package {
        workbook: Workbook { sheets: wb_sheets },
        present,
        absent,
    })
}

/// manifest 行数:两条版本行 + 全部表清单(含 manifest 自己)+ absent。
fn manifest_row_count(data: &[(&'static str, usize, usize)], absent: &[&'static str]) -> usize {
    2 + 1 + data.len() + absent.len()
}

/// 读一个产物 CSV 入表:缺席则记 absent(缺席 ≠ 空表,不生成空表)。
fn push_csv(
    dir: &Path,
    sheet_name: &'static str,
    artifact: &'static str,
    sheets: &mut Vec<Sheet>,
    data_present: &mut Vec<(&'static str, usize, usize)>,
    absent: &mut Vec<&'static str>,
) -> anyhow::Result<()> {
    let path = dir.join(artifact);
    if !path.exists() {
        absent.push(artifact);
        return Ok(());
    }
    match read_csv(&path) {
        Ok((header, rows)) => {
            let mut sheet = Sheet::new(sheet_name, header);
            let row_count = rows.len();
            let col_count = sheet.col_count();
            sheet.push_rows(rows);
            sheets.push(sheet);
            data_present.push((sheet_name, row_count, col_count));
            Ok(())
        }
        Err(e) => bail!("读 {} 失败: {e:#}", artifact),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn column_letters() {
        assert_eq!(col_letter(0), "A");
        assert_eq!(col_letter(25), "Z");
        assert_eq!(col_letter(26), "AA");
        assert_eq!(col_letter(27), "AB");
        assert_eq!(col_letter(51), "AZ");
        assert_eq!(col_letter(52), "BA");
    }

    #[test]
    fn xml_escaping_and_cells() {
        assert_eq!(
            xml_escape("a<b>&\"c\"'"),
            "a&lt;b&gt;&amp;&quot;c&quot;&apos;"
        );
        assert_eq!(Cell::from_field(""), Cell::Blank);
        assert_eq!(Cell::from_field("10"), Cell::Number(10.0));
        assert_eq!(Cell::from_field("0.125"), Cell::Number(0.125));
        assert_eq!(
            Cell::from_field("model.warrior.attack"),
            Cell::Text("model.warrior.attack".into())
        );
        assert_eq!(Cell::from_field("inf"), Cell::Text("inf".into()));
        // 版本号是标签:不做数值推断,manifest 版本列才不混型
        assert_eq!(Cell::from_text("1"), Cell::Text("1".into()));
        assert_eq!(Cell::from_text("0.1.0"), Cell::Text("0.1.0".into()));
        assert_eq!(Cell::from_text(""), Cell::Blank);
        let mut out = String::new();
        Cell::Text("说<话>".into()).render("A1", &mut out);
        assert_eq!(
            out,
            "<c r=\"A1\" t=\"inlineStr\"><is><t xml:space=\"preserve\">说&lt;话&gt;</t></is></c>"
        );
        let mut out = String::new();
        Cell::Number(0.125).render("B2", &mut out);
        assert_eq!(out, "<c r=\"B2\"><v>0.125</v></c>");
    }

    #[test]
    fn csv_reader_matches_writer_escaping() {
        let dir = std::env::temp_dir().join("st-workbook-csv-test");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("in.csv");
        fs::write(&path, "a,\"b,1\"\n1,\"x\"\"y\"\nlast,\n").unwrap();
        let (header, rows) = read_csv(&path).unwrap();
        assert_eq!(header, vec!["a", "b,1"]);
        assert_eq!(rows, vec![vec!["1", "x\"y"], vec!["last", ""]]);
    }

    #[test]
    fn sheet_name_sanitized_and_deduped() {
        assert_eq!(sanitize_sheet_name("daily", &[]), "daily");
        assert_eq!(sanitize_sheet_name("da/ily:*?", &["daily"]), "da_ily___");
        assert_eq!(
            sanitize_sheet_name("daily", &["daily", "da_ily___"]),
            "daily-3"
        );
        let long = "很长的表名".repeat(10);
        assert_eq!(sanitize_sheet_name(&long, &[]).chars().count(), 31);
    }
}
