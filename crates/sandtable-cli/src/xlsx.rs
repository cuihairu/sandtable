//! XLSX 数据表读取(calamine;todo「Excel 导入 + 校准往返闭环」step ①)。
//!
//! 与本 crate `workbook::read_csv` 同构的表读取层:一表一读、单行表头,
//! 返回 (表头, 字符串行)。数值单元格渲染为最短往返数值文本(98 → "98"),
//! 读回 `Cell::from_field` / `parse::<f64>` 得到同一个 f64——同一份数据走
//! CSV 与 XLSX 两条入口,下游看到的字符串逐字段一致(等价性由测试锁住)。
//!
//! 复用方:MCP `sandtable_calibrate` 的 .xlsx 观测数据入口(calibration-design
//! 「Excel 数据源」),与工作簿「导出 → 改 → 回读」往返(文档 09 章)。
//!
//! 红线:
//! - 只读。这里没有任何写路径;写回(模拟用户在 Excel 里编辑)复用
//!   `workbook` 的确定性打包,不在本模块引入第二个写端;
//! - 错误单元格(#REF! 等)不回显单元格值,只报工作表名 + 行号 + 列标——
//!   定位所需的最小信息(与校准层「错误不回显原始数据值」同一纪律);
//! - 表头行默认第 1 行;`header_row` 之上的行整行跳过,不参与校验;
//! - 字符串不做 trim:与 `workbook::read_csv` 同口径,trim 语义归调用方
//!   (校准层对 CSV 与 XLSX 两条入口做同一套 trim);
//! - 坐标一律按工作表绝对口径:calamine 的 `Range` 以有效区域左上角为原点
//!   (`get` 取相对坐标),而用户的表可以把有效区域放在任意格起步(首行留空
//!   后从 B2 开始是常见形态)。表头行号(1 基)与错误报错的行号 + 列标都按
//!   绝对坐标换算,与 Excel 里所见一致;
//! - 单元格预算:`height × width` 超过 [`MAX_XLSX_CELLS`] 拒绝读取。calamine
//!   按有效区域稠密分配,远离主体的散落单元格会放大分配;预算是我们自己
//!   下游展开(字符串行)的事后护栏——calamine 内部分配在读入时已发生,
//!   本地 `data_dir` 只读本地文件的威胁模型下接受这一边界。

use std::fmt;
use std::path::Path;

use calamine::{open_workbook, Data, Reader, Xlsx};

/// 读取失败的两类口径,调用方据此决定透传策略:
/// 文件打不开(只报「不可读」,不展开内部错误)与内容级错误(带行列号,
/// 必须原样透传给最终用户)。与校准层 CSV 的「mapping 文件不可读」/
/// 「读 {表} 行失败: {e}」双口径一一对应。
#[derive(Debug)]
pub enum XlsxReadError {
    /// 文件不可读:不存在、非 xlsx、加密或归档损坏。
    Unreadable(String),
    /// 内容级错误:错误单元格(带行列号)、缺工作表、缺表头行、越界表头行。
    Content(String),
}

impl fmt::Display for XlsxReadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            XlsxReadError::Unreadable(msg) => write!(f, "{msg}"),
            XlsxReadError::Content(msg) => write!(f, "{msg}"),
        }
    }
}

impl std::error::Error for XlsxReadError {}

/// 单工作表读取预算(height × width,单元格数)。正常校准观测表远小于此;
/// 触线几乎总是「远离主体的散落单元格把有效区域撑大」。
const MAX_XLSX_CELLS: usize = 2_000_000;

/// 工作表清单(按工作簿内顺序)。
pub fn sheet_names(path: &Path) -> Result<Vec<String>, XlsxReadError> {
    let wb: Xlsx<_> = open_workbook(path)
        .map_err(|e| XlsxReadError::Unreadable(format!("{} 不可读: {e}", path.display())))?;
    Ok(wb.sheet_names())
}

/// 读一张工作表为 (表头, 数据行),与 CSV 读取同构。
///
/// - `sheet`:`None` 取第一个工作表;指定名缺失则报错并列出可用表名;
/// - `header_row`:1 基表头行号;其上的行整行跳过;
/// - 类型推断:数值 → 最短往返数值文本(98 → "98"),文本 → 原文,
///   布尔 → "true"/"false",日期/时长单元格按底层值渲染(序列数或 ISO 文本),
///   空单元格 → 空串;
/// - 校验:Excel 错误单元格逐个收集后一次性报出(最多列 8 处,附总数),
///   每处报「工作表名 + 行号 + 列标」,不回显单元格值。
pub fn read_sheet(
    path: &Path,
    sheet: Option<&str>,
    header_row: usize,
) -> Result<(Vec<String>, Vec<Vec<String>>), XlsxReadError> {
    if header_row == 0 {
        return Err(XlsxReadError::Content("表头行号从 1 开始".into()));
    }
    let mut wb: Xlsx<_> = open_workbook(path)
        .map_err(|e| XlsxReadError::Unreadable(format!("{} 不可读: {e}", path.display())))?;
    let names = wb.sheet_names();
    let Some(first) = names.first() else {
        return Err(XlsxReadError::Unreadable(format!(
            "{} 不含任何工作表",
            path.display()
        )));
    };
    let name: &str = match sheet {
        Some(want) => match names.iter().find(|n| n.as_str() == want) {
            Some(found) => found.as_str(),
            None => {
                return Err(XlsxReadError::Content(format!(
                    "{} 没有工作表「{want}」;可用工作表:{}",
                    path.display(),
                    names.join("、")
                )))
            }
        },
        None => first.as_str(),
    };
    let range = wb
        .worksheet_range(name)
        .map_err(|e| XlsxReadError::Unreadable(format!("{} 不可读: {e}", path.display())))?;
    let (height, width) = range.get_size();
    if width == 0 || height == 0 {
        return Err(XlsxReadError::Content(format!(
            "{} [{name}] 是空工作表(无表头)",
            path.display()
        )));
    }
    let cells = height.saturating_mul(width);
    if cells > MAX_XLSX_CELLS {
        return Err(XlsxReadError::Content(format!(
            "{} [{name}] 单元格数 {cells} 超出读取预算 {MAX_XLSX_CELLS}(工作表过大,或含远离主体的散落单元格)",
            path.display()
        )));
    }
    // calamine 的 Range 以有效区域左上角为原点(get 取相对坐标);对外一律
    // 换算成工作表绝对坐标,表头行号与错误报错的行号 + 列标都按绝对口径,
    // 与 Excel 里所见一致(2026-11-07 审核:相对坐标会把 B2 起步的表错位)。
    let (start_row, start_col) = range.start().unwrap_or((0, 0));
    let (start_row, start_col) = (start_row as usize, start_col as usize);
    let total_rows = start_row + height;
    let total_cols = start_col + width;
    if header_row > total_rows {
        return Err(XlsxReadError::Content(format!(
            "{} [{name}] 表头行 {header_row} 超出数据范围(共 {total_rows} 行)",
            path.display()
        )));
    }

    let mut error_rows: Vec<String> = Vec::new();
    let mut cell_text = |cell: Option<&Data>, row: usize, col: usize| -> String {
        match cell {
            None | Some(Data::Empty) => String::new(),
            Some(Data::String(text)) => text.clone(),
            Some(Data::Bool(value)) => value.to_string(),
            Some(Data::Int(value)) => value.to_string(),
            Some(Data::Float(value)) if value.is_finite() => value.to_string(),
            Some(Data::DateTime(value)) => value.as_f64().to_string(),
            Some(Data::DateTimeIso(text)) | Some(Data::DurationIso(text)) => text.clone(),
            Some(Data::Float(_)) => {
                error_rows.push(non_finite_message(name, row, col));
                String::new()
            }
            Some(Data::Error(_)) => {
                // 不回显单元格值(错误码也算值);行号 + 列标足够定位。
                error_rows.push(error_cell_message(name, row, col));
                String::new()
            }
        }
    };

    // 有效区域之外的格(含有效区域上方/左侧的整行整列)按空单元格处理。
    let cell_at = |abs_row: usize, abs_col: usize| -> Option<&Data> {
        if abs_row >= start_row
            && abs_row < start_row + height
            && abs_col >= start_col
            && abs_col < start_col + width
        {
            range.get((abs_row - start_row, abs_col - start_col))
        } else {
            None
        }
    };

    let header: Vec<String> = (0..total_cols)
        .map(|col| cell_text(cell_at(header_row - 1, col), header_row - 1, col))
        .collect();
    let mut rows: Vec<Vec<String>> = Vec::with_capacity(total_rows - header_row);
    for row in header_row..total_rows {
        rows.push(
            (0..total_cols)
                .map(|col| cell_text(cell_at(row, col), row, col))
                .collect(),
        );
    }
    if !error_rows.is_empty() {
        let total = error_rows.len();
        let shown: Vec<String> = error_rows.iter().take(8).cloned().collect();
        return Err(XlsxReadError::Content(format!(
            "{} [{name}] 含 {total} 处不可读单元格:{}{}",
            path.display(),
            shown.join(";"),
            if total > 8 {
                format!("(其余 {total} 处同型)")
            } else {
                String::new()
            }
        )));
    }
    Ok((header, rows))
}

fn error_cell_message(sheet: &str, row: usize, col: usize) -> String {
    format!(
        "[{sheet}] 第 {} 行 {} 列:Excel 错误单元格,值不可读",
        row + 1,
        crate::workbook::col_letter(col)
    )
}

fn non_finite_message(sheet: &str, row: usize, col: usize) -> String {
    format!(
        "[{sheet}] 第 {} 行 {} 列:非有限数值,不可读",
        row + 1,
        crate::workbook::col_letter(col)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workbook::{Sheet, Workbook};
    use std::fs;
    use std::io::Write as _;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("st-cli-xlsx-{tag}-{}-{nanos}", std::process::id()))
    }

    /// 单表工作簿夹具:表头 + 文本行(数值推断交给写入端的 from_table)。
    fn write_book(path: &Path, sheets: Vec<Sheet>) {
        Workbook::from_sheets(sheets).write(path).unwrap();
    }

    fn table(name: &str, header: &[&str], rows: &[&[&str]]) -> Sheet {
        Sheet::from_table(
            name,
            header.iter().map(|s| s.to_string()).collect(),
            rows.iter()
                .map(|r| r.iter().map(|s| s.to_string()).collect())
                .collect(),
        )
    }

    #[test]
    fn read_back_is_csv_isomorphic() {
        let dir = temp_dir("iso");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("daily.xlsx");
        write_book(
            &path,
            vec![table(
                "daily",
                &["day", "win_rate", "note"],
                &[&["1", "0.5", "题词"], &["2", "0.985", ""]],
            )],
        );
        let (header, rows) = read_sheet(&path, Some("daily"), 1).unwrap();
        assert_eq!(header, vec!["day", "win_rate", "note"]);
        assert_eq!(
            rows,
            vec![
                vec!["1".to_string(), "0.5".to_string(), "题词".to_string()],
                vec!["2".to_string(), "0.985".to_string(), String::new()],
            ]
        );
        // 数值文本读回同一 f64(最短往返,无漂移)。
        assert_eq!(rows[1][1].parse::<f64>().unwrap(), 0.985);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn sheet_selection_defaults_to_first_and_reports_missing() {
        let dir = temp_dir("sheets");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("book.xlsx");
        write_book(
            &path,
            vec![
                table("alpha", &["a"], &[&["1"]]),
                table("beta", &["b"], &[&["2"]]),
            ],
        );
        let (header, _) = read_sheet(&path, None, 1).unwrap();
        assert_eq!(header, vec!["a"]);
        let (header, rows) = read_sheet(&path, Some("beta"), 1).unwrap();
        assert_eq!(header, vec!["b"]);
        assert_eq!(rows, vec![vec!["2".to_string()]]);

        let err = read_sheet(&path, Some("gamma"), 1).unwrap_err();
        let message = err.to_string();
        assert!(message.contains("没有工作表「gamma」"), "{message}");
        assert!(message.contains("alpha、beta"), "{message}");

        assert_eq!(
            sheet_names(&path).unwrap(),
            vec!["alpha".to_string(), "beta".to_string()]
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn header_row_maps_and_skips_leading_rows() {
        let dir = temp_dir("header");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("titled.xlsx");
        // 第 1 行是标题行(单格),真实表头在第 2 行:header_row=2 读到它。
        write_book(
            &path,
            vec![table(
                "t",
                &["标题"],
                &[&["day", "value"], &["1", "10"], &["2", "20"]],
            )],
        );
        let (header, rows) = read_sheet(&path, Some("t"), 2).unwrap();
        assert_eq!(header, vec!["day", "value"]);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0], vec!["1".to_string(), "10".to_string()]);

        let err = read_sheet(&path, Some("t"), 9).unwrap_err();
        assert!(err.to_string().contains("超出数据范围"), "{err}");
        let err = read_sheet(&path, Some("t"), 0).unwrap_err();
        assert!(err.to_string().contains("从 1 开始"), "{err}");
        fs::remove_dir_all(&dir).ok();
    }

    /// 用 zip 手术替换 sheet1.xml,构造写入端不产的单元格类型
    /// (布尔、Excel 错误值):读端必须按类型推断渲染 / 按行列号报错。
    fn patch_sheet1(src: &Path, dst: &Path, xml: &str) {
        let file = fs::File::open(src).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let out = fs::File::create(dst).unwrap();
        let mut zw = zip::ZipWriter::new(out);
        for index in 0..archive.len() {
            let entry = archive.by_index(index).unwrap();
            let is_sheet1 = entry
                .name()
                .map(|name| name == "xl/worksheets/sheet1.xml")
                .unwrap_or(false);
            if is_sheet1 {
                let opts = zip::write::SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Deflated);
                zw.start_file("xl/worksheets/sheet1.xml", opts).unwrap();
                zw.write_all(xml.as_bytes()).unwrap();
            } else {
                zw.raw_copy_file(entry).unwrap();
            }
        }
        zw.finish().unwrap();
    }

    const TYPED_SHEET_XML: &str = concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
        "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">",
        "<sheetData>",
        "<row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>flag</t></is></c>",
        "<c r=\"B1\" t=\"inlineStr\"><is><t>num</t></is></c></row>",
        "<row r=\"2\"><c r=\"A2\" t=\"b\"><v>1</v></c><c r=\"B2\"><v>1.5</v></c></row>",
        "<row r=\"3\"><c r=\"A3\" t=\"b\"><v>0</v></c><c r=\"B3\"></c></row>",
        "</sheetData></worksheet>"
    );

    const ERROR_SHEET_XML: &str = concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
        "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">",
        "<sheetData>",
        "<row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>v</t></is></c></row>",
        "<row r=\"2\"><c r=\"A2\" t=\"e\"><v>#REF!</v></c></row>",
        "<row r=\"4\"><c r=\"A4\" t=\"e\"><v>#DIV/0!</v></c></row>",
        "</sheetData></worksheet>"
    );

    #[test]
    fn typed_cells_render_and_error_cells_report_row_numbers() {
        let dir = temp_dir("typed");
        fs::create_dir_all(&dir).unwrap();
        let base = dir.join("base.xlsx");
        write_book(&base, vec![table("s", &["x"], &[&["1"]])]);

        let typed = dir.join("typed.xlsx");
        patch_sheet1(&base, &typed, TYPED_SHEET_XML);
        let (header, rows) = read_sheet(&typed, None, 1).unwrap();
        assert_eq!(header, vec!["flag", "num"]);
        assert_eq!(
            rows,
            vec![
                vec!["true".to_string(), "1.5".to_string()],
                vec!["false".to_string(), String::new()],
            ]
        );

        let error = dir.join("error.xlsx");
        patch_sheet1(&base, &error, ERROR_SHEET_XML);
        let err = read_sheet(&error, None, 1).unwrap_err();
        let message = err.to_string();
        assert!(matches!(err, XlsxReadError::Content(_)), "{message}");
        // 行号报告(第 2、4 行,A 列);错误单元格值(#REF! 等)不回显。
        assert!(message.contains("第 2 行 A 列"), "{message}");
        assert!(message.contains("第 4 行 A 列"), "{message}");
        assert!(message.contains("2 处不可读单元格"), "{message}");
        assert!(!message.contains("#REF!"), "{message}");
        assert!(!message.contains("#DIV/0!"), "{message}");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn header_only_sheet_yields_zero_rows_and_garbage_file_is_unreadable() {
        let dir = temp_dir("edges");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("header_only.xlsx");
        write_book(&path, vec![table("s", &["a", "b"], &[])]);
        let (header, rows) = read_sheet(&path, None, 1).unwrap();
        assert_eq!(header, vec!["a", "b"]);
        assert!(rows.is_empty());

        let junk = dir.join("junk.xlsx");
        fs::write(&junk, b"not a zip").unwrap();
        let err = read_sheet(&junk, None, 1).unwrap_err();
        assert!(
            matches!(err, XlsxReadError::Unreadable(_)),
            "垃圾文件应归 Unreadable: {err}"
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// 有效区域从 B2 起步(首行首列留空是用户文件的常见形态):calamine 的
    /// Range.get 取相对坐标,读取必须换算回工作表绝对坐标——表头行号、
    /// 数据行号、错误报错的行号 + 列标都与 Excel 所见一致(2026-11-07 审核)。
    const OFFSET_SHEET_XML: &str = concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
        "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">",
        "<sheetData>",
        "<row r=\"2\"><c r=\"B2\" t=\"inlineStr\"><is><t>day</t></is></c>",
        "<c r=\"C2\" t=\"inlineStr\"><is><t>win_rate</t></is></c></row>",
        "<row r=\"3\"><c r=\"B3\"><v>1</v></c><c r=\"C3\"><v>0.5</v></c></row>",
        "<row r=\"5\"><c r=\"B5\"><v>2</v></c><c r=\"C5\"><v>0.985</v></c></row>",
        "</sheetData></worksheet>"
    );

    const OFFSET_ERROR_SHEET_XML: &str = concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
        "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">",
        "<sheetData>",
        "<row r=\"2\"><c r=\"B2\" t=\"inlineStr\"><is><t>day</t></is></c></row>",
        "<row r=\"3\"><c r=\"B3\"><v>1</v></c></row>",
        "<row r=\"4\"><c r=\"C4\" t=\"e\"><v>#REF!</v></c></row>",
        "</sheetData></worksheet>"
    );

    #[test]
    fn offset_used_range_reads_by_absolute_coordinates() {
        let dir = temp_dir("offset");
        fs::create_dir_all(&dir).unwrap();
        let base = dir.join("base.xlsx");
        write_book(&base, vec![table("anchor", &["a"], &[&["1"]])]);

        let offset = dir.join("offset.xlsx");
        patch_sheet1(&base, &offset, OFFSET_SHEET_XML);
        // 表头在第 2 行(绝对);第 1 行在有效区域之外,整行为空。
        let header_row_1 = read_sheet(&offset, None, 1).unwrap();
        assert_eq!(
            header_row_1.0,
            vec![String::new(), String::new(), String::new()]
        );
        // 表头行 = 绝对第 2 行:B2/C2;数据 = 绝对第 3 行起,有效区域外的
        // 行 4 与列 A 按空处理。
        let (header, rows) = read_sheet(&offset, None, 2).unwrap();
        assert_eq!(header, vec![String::new(), "day".into(), "win_rate".into()]);
        assert_eq!(
            rows,
            vec![
                vec![String::new(), "1".into(), "0.5".into()],
                vec![String::new(), String::new(), String::new()],
                vec![String::new(), "2".into(), "0.985".into()],
            ]
        );

        // 错误单元格报绝对坐标:C4 → 第 4 行 C 列(不是相对的第 3 行 B 列)。
        let error = dir.join("offset_error.xlsx");
        patch_sheet1(&base, &error, OFFSET_ERROR_SHEET_XML);
        let err = read_sheet(&error, None, 2).unwrap_err();
        let message = err.to_string();
        assert!(matches!(err, XlsxReadError::Content(_)), "{message}");
        assert!(message.contains("第 4 行 C 列"), "{message}");
        assert!(!message.contains("#REF!"), "{message}");
        fs::remove_dir_all(&dir).ok();
    }
}
