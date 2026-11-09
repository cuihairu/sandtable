//! DuckDB 查询面(文档 09 章红线:只读结果查询,不进仿真路径)。
//! SQL 只读白名单 + 输入按词根注册视图 + 终端表格输出。

#[cfg(feature = "duckdb")]
use std::path::PathBuf;

#[cfg(feature = "duckdb")]
use anyhow::Context;

/// SQL 查询结果:(列名, 行)。
#[cfg(feature = "duckdb")]
type QueryResult = (Vec<String>, Vec<Vec<String>>);

/// SQL 白名单(I-010 同口径,desktop tauri 层 2026-11-05 先落地,CLI 侧补齐
/// = ST-AUD-10 留尾闭环):仅允许只读 SELECT / WITH 查询。DuckDB 的文件表
/// 函数(read_csv_auto / read_parquet 等)与写语句(COPY / INSERT / CREATE
/// 等)一律拒绝——文件访问只经 `--input` 注册视图这一条路,SQL 不得自带。
// duckdb 特性缺省时唯一消费方 run_query 不在编译面,仅单测引用 → 允许死代码
#[cfg_attr(not(feature = "duckdb"), allow(dead_code))]
fn validate_query_sql(raw: &str) -> Result<&str, String> {
    let sql = raw.trim().trim_end_matches(';').trim();
    if sql.is_empty() {
        return Err("查询 SQL 不可为空".into());
    }
    let upper = sql.to_ascii_uppercase();
    if !(upper.starts_with("SELECT ") || upper.starts_with("WITH ")) {
        return Err("查询仅允许只读 SELECT/WITH 语句".into());
    }
    // 文件表函数与写语句:即使语句以 SELECT 开头,内部仍可引用文件表函数
    // (read_csv_auto / read_parquet 读任意本地路径)或借子句落盘,一律拦截。
    for word in [
        "READ_CSV_AUTO",
        "READ_CSV",
        "READ_PARQUET",
        "READ_JSON",
        "READ_JSON_AUTO",
        "READ_JSON_OBJECTS_AUTO",
        "READ_JSON_OBJECTS",
        "READ_NDJSON_AUTO",
        "READ_NDJSON",
        "READ_XLSX",
        "READ_TEXT",
        "READ_BLOB",
        "PARQUET_SCAN",
        "GLOB",
        "COPY",
        "INSERT",
        "UPDATE",
        "DELETE",
        "CREATE",
        "DROP",
        "CREATE_VIEW",
        "CREATE_TABLE",
        "ATTACH",
        "DETACH",
        "PRAGMA",
        "EXPORT",
        "INSTALL",
        "LOAD",
        "CALL",
        "IMPORT",
    ] {
        if contains_word(&upper, word) {
            return Err(format!(
                "查询包含被禁用的 {word},只读查询不允许文件访问或写操作"
            ));
        }
    }
    Ok(sql)
}

/// 词边界检查(ASCII):`SELECT` 与 `SELECTED` 不混同。
#[cfg_attr(not(feature = "duckdb"), allow(dead_code))]
fn contains_word(haystack: &str, word: &str) -> bool {
    let bytes = haystack.as_bytes();
    let w = word.as_bytes();
    if w.is_empty() || bytes.len() < w.len() {
        return false;
    }
    (0..=bytes.len() - w.len()).any(|i| {
        if &bytes[i..i + w.len()] != w {
            return false;
        }
        let before_ok = i == 0 || !bytes[i - 1].is_ascii_alphanumeric() && bytes[i - 1] != b'_';
        let after = i + w.len();
        let after_ok =
            after == bytes.len() || !bytes[after].is_ascii_alphanumeric() && bytes[after] != b'_';
        before_ok && after_ok
    })
}

/// 对已落盘的结果数据集跑 SQL(文档 09 章红线:DuckDB 只读结果,
/// 不进仿真路径)。输入按词根注册为视图:summary.csv → summary。
#[cfg(feature = "duckdb")]
pub(crate) fn run_query(inputs: &[PathBuf], sql: &str) -> anyhow::Result<QueryResult> {
    use duckdb::Connection;

    // I-010 同口径:先过只读白名单,再碰 DuckDB
    let sql = validate_query_sql(sql).map_err(anyhow::Error::msg)?;

    let conn = Connection::open_in_memory().context("打开 DuckDB 内存库失败")?;
    for path in inputs {
        // 输入路径 canonicalize 消除 .. 与符号链接,只收存在的普通文件
        let resolved = path
            .canonicalize()
            .with_context(|| format!("输入路径不可访问: {}", path.display()))?;
        if !resolved.is_file() {
            anyhow::bail!("输入路径不是普通文件: {}", path.display());
        }
        let stem = resolved
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or_else(|| anyhow::anyhow!("无法从 {} 取视图名", path.display()))?;
        if !is_ident(stem) {
            anyhow::bail!("视图名 {stem:?} 非法:文件名词根须为 [A-Za-z_][A-Za-z0-9_]*");
        }
        // 路径进 DDL 字面量:单引号翻倍(视图名已在 is_ident 拦住)
        let p = resolved.to_string_lossy().replace('\'', "''");
        let ddl = match resolved.extension().and_then(|e| e.to_str()) {
            Some("parquet") => format!("CREATE VIEW {stem} AS SELECT * FROM read_parquet('{p}')"),
            _ => format!("CREATE VIEW {stem} AS SELECT * FROM read_csv_auto('{p}', header = true)"),
        };
        conn.execute_batch(&ddl)
            .with_context(|| format!("注册视图 {stem} 失败({})", path.display()))?;
    }

    // 列名取自 DESCRIBE(计划期元数据,不执行查询体):prepare 阶段的
    // C API 不暴露结果列,column_names 要执行后才可用
    let mut desc = conn.prepare(&format!("DESCRIBE {sql}"))?;
    let mut dcur = desc.query([])?;
    let mut names = Vec::new();
    while let Some(r) = dcur.next()? {
        let n: String = r.get(0)?;
        names.push(n);
    }

    let mut stmt = conn.prepare(sql)?;
    let ncols = names.len();
    let mut rows = Vec::new();
    let mut cur = stmt.query([])?;
    while let Some(r) = cur.next()? {
        let mut row = Vec::with_capacity(ncols);
        for i in 0..ncols {
            row.push(cell_string(r, i)?);
        }
        rows.push(row);
    }
    Ok((names, rows))
}

/// 视图名须是合法标识符(拼进 DDL,注入在注册处拦截)。
#[cfg(feature = "duckdb")]
fn is_ident(s: &str) -> bool {
    let mut cs = s.chars();
    matches!(cs.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && cs.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// 单元格转显示文本:数值/文本直转,复合类型走 Debug。
#[cfg(feature = "duckdb")]
fn cell_string(r: &duckdb::Row<'_>, i: usize) -> anyhow::Result<String> {
    use duckdb::types::ValueRef;
    let s = match r.get_ref(i)? {
        ValueRef::Null => String::new(),
        ValueRef::Boolean(v) => v.to_string(),
        ValueRef::TinyInt(v) => v.to_string(),
        ValueRef::SmallInt(v) => v.to_string(),
        ValueRef::Int(v) => v.to_string(),
        ValueRef::BigInt(v) => v.to_string(),
        ValueRef::HugeInt(v) => v.to_string(),
        ValueRef::UTinyInt(v) => v.to_string(),
        ValueRef::USmallInt(v) => v.to_string(),
        ValueRef::UInt(v) => v.to_string(),
        ValueRef::UBigInt(v) => v.to_string(),
        ValueRef::UHugeInt(v) => v.to_string(),
        ValueRef::Float(v) => v.to_string(),
        ValueRef::Double(v) => v.to_string(),
        ValueRef::Text(t) => String::from_utf8_lossy(t).into_owned(),
        ValueRef::Date32(v) => v.to_string(),
        other => format!("{other:?}"),
    };
    Ok(s)
}

/// 简单表格输出:按列宽对齐(终端人读,面向 stdout)。
#[cfg(feature = "duckdb")]
pub(crate) fn print_table((names, rows): &QueryResult) {
    if names.is_empty() {
        return;
    }
    let mut widths: Vec<usize> = names.iter().map(|n| n.chars().count()).collect();
    for r in rows {
        for (i, c) in r.iter().enumerate() {
            widths[i] = widths[i].max(c.chars().count());
        }
    }
    let line = |cells: &[String]| {
        cells
            .iter()
            .enumerate()
            .map(|(i, c)| format!("{c:>width$}", width = widths[i]))
            .collect::<Vec<_>>()
            .join("  ")
    };
    println!("{}", line(names));
    let rule = widths
        .iter()
        .map(|w| "-".repeat(*w))
        .collect::<Vec<_>>()
        .join("  ");
    println!("{rule}");
    for r in rows {
        println!("{}", line(r));
    }
    println!("({} 行)", rows.len());
}

#[cfg(test)]
mod tests {
    use super::*;

    /// I-010 同口径 · 只读白名单:文件表函数与语句内嵌写操作被词表拦下,
    /// 错误信息点名被禁关键词;SELECTED 不误伤词边界。
    #[test]
    fn query_rejects_file_functions_and_writes() {
        for (sql, needle) in [
            (
                "SELECT * FROM read_csv_auto('/etc/passwd')",
                "READ_CSV_AUTO",
            ),
            (
                "SELECT * FROM read_parquet('/data/x.parquet')",
                "READ_PARQUET",
            ),
            ("SELECT * FROM read_text('/etc/passwd')", "READ_TEXT"),
            ("SELECT * FROM read_blob('/etc/passwd')", "READ_BLOB"),
            ("SELECT * FROM read_ndjson('/data/x.json')", "READ_NDJSON"),
            (
                "SELECT * FROM read_ndjson_auto('/data/x.json')",
                "READ_NDJSON_AUTO",
            ),
            (
                "SELECT * FROM read_json_objects('/data/x.json')",
                "READ_JSON_OBJECTS",
            ),
            (
                "SELECT * FROM read_json_objects_auto('/data/x.json')",
                "READ_JSON_OBJECTS_AUTO",
            ),
            (
                "SELECT * FROM parquet_scan('/data/x.parquet')",
                "PARQUET_SCAN",
            ),
            ("SELECT * FROM glob('/tmp/*')", "GLOB"),
            ("SELECT * FROM t; DELETE FROM t", "DELETE"),
        ] {
            let err = validate_query_sql(sql).unwrap_err();
            assert!(err.contains(needle), "{sql} -> {err}");
        }
        // 非 SELECT/WITH 前缀(COPY/INSERT/CREATE 等):前置只读门直接拒绝
        for sql in [
            "COPY (SELECT * FROM t) TO '/tmp/x.csv'",
            "INSERT INTO t VALUES (1)",
            "CREATE TABLE t AS SELECT 1",
        ] {
            let err = validate_query_sql(sql).unwrap_err();
            assert!(err.contains("仅允许只读"), "{sql} -> {err}");
        }
        assert!(validate_query_sql("SELECT * FROM t").is_ok());
        assert!(validate_query_sql("WITH x AS (SELECT 1) SELECT * FROM x").is_ok());
        assert!(validate_query_sql("SELECTED").is_err());
        assert!(validate_query_sql("").is_err());
    }
}
