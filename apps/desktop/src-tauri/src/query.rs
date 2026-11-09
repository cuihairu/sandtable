//! DuckDB 查询命令域(桌面壳):只读 SQL 白名单 + 输入视图注册 +
//! 单元格转文本。SQL 只读结果,不进仿真路径。

use std::path::{Path, PathBuf};

/// 本地分析层(文档 09 章红线:DuckDB 只读结果,不进仿真路径):输入文件
/// 按词根注册视图(summary.csv → summary;parquet 走 read_parquet),跑 SQL
/// 返回 `{columns, rows}`;与 CLI `query` 子命令同源(视图名 is_ident 拦注入、
/// 列名走 DESCRIBE、单元格转显示文本)。SQL 只允许只读 SELECT/WITH(禁止
/// 文件表函数与写语句)。input 路径经 canonicalize 解析为存在且为普通文件
/// (拒目录/缺失/符号链接逃逸);本命令读的是**用户自选的结果文件**(对话框/
/// 手输路径/下载目录,设计见 docs 18 Phase 7 第 5-6 步),并非单一「应用
/// 数据目录」下的文件,故不做单目录限定——只读边界由 SQL 词表承担。
#[tauri::command]
pub(crate) fn query(inputs: Vec<String>, sql: String) -> Result<serde_json::Value, String> {
    use duckdb::types::ValueRef;
    use duckdb::Connection;

    let sql = validate_query_sql(&sql)?;
    let conn = Connection::open_in_memory().map_err(|e| format!("打开 DuckDB 内存库失败: {e}"))?;
    for path in &inputs {
        let p = resolve_query_input(path)?;
        let stem = path
            .rsplit(['/', '\\'])
            .next()
            .and_then(|s| s.rsplit_once('.'))
            .map(|(stem, _)| stem)
            .ok_or_else(|| format!("无法从 {path} 取视图名"))?;
        if !is_ident(stem) {
            return Err(format!(
                "视图名 {stem:?} 非法:文件名词根须为 [A-Za-z_][A-Za-z0-9_]*"
            ));
        }
        let p = p.to_string_lossy().replace('\'', "''");
        let ddl = if p.ends_with(".parquet") {
            format!("CREATE VIEW {stem} AS SELECT * FROM read_parquet('{p}')")
        } else {
            format!("CREATE VIEW {stem} AS SELECT * FROM read_csv_auto('{p}', header = true)")
        };
        conn.execute_batch(&ddl)
            .map_err(|e| format!("注册视图 {stem} 失败: {e}"))?;
    }

    // 列名取自 DESCRIBE(计划期元数据,不执行查询体):prepare 阶段的
    // C API 不暴露结果列,column_names 要执行后才可用
    let mut desc = conn
        .prepare(&format!("DESCRIBE {sql}"))
        .map_err(|e| format!("查询准备失败: {e}"))?;
    let mut dcur = desc.query([]).map_err(|e| format!("查询准备失败: {e}"))?;
    let mut names = Vec::new();
    while let Some(r) = dcur.next().map_err(|e| format!("查询准备失败: {e}"))? {
        let n: String = r.get(0).map_err(|e| format!("列名读取失败: {e}"))?;
        names.push(n);
    }

    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| format!("查询准备失败: {e}"))?;
    let ncols = names.len();
    let mut rows = Vec::new();
    let mut cur = stmt.query([]).map_err(|e| format!("查询执行失败: {e}"))?;
    while let Some(r) = cur.next().map_err(|e| format!("查询执行失败: {e}"))? {
        let mut row = Vec::with_capacity(ncols);
        for i in 0..ncols {
            let s = match r.get_ref(i).map_err(|e| format!("单元格读取失败: {e}"))? {
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
                ValueRef::Float(v) => v.to_string(),
                ValueRef::Double(v) => v.to_string(),
                ValueRef::Decimal(v) => v.to_string(),
                ValueRef::Text(v) => String::from_utf8_lossy(v).into_owned(),
                ValueRef::Blob(v) => String::from_utf8_lossy(v).into_owned(),
                other => format!("{other:?}"),
            };
            row.push(s);
        }
        rows.push(row);
    }
    Ok(serde_json::json!({ "columns": names, "rows": rows }))
}

/// SQL 白名单(I-010):仅允许只读 SELECT / WITH 查询。DuckDB 的文件表函数
/// (read_csv_auto / read_parquet 等)与写语句(COPY / INSERT / CREATE 等)一律
/// 拒绝,防止 WebView 借 query 读任意本地文件或落盘。
pub(crate) fn validate_query_sql(raw: &str) -> Result<&str, String> {
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
    // 2026-11-05 审核发现:词表原缺 read_text/read_blob(标量文件读取)与
    // read_ndjson/read_json_objects/parquet_scan/glob(文件表函数),可借
    // `SELECT * FROM read_text('/etc/passwd')` 绕 SELECT 前缀读任意文件;
    // 补齐全部 DuckDB 文件访问/写入口(含 glob 路径枚举、INSTALL/LOAD 等)。
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
pub(crate) fn contains_word(haystack: &str, word: &str) -> bool {
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

/// 校验输入路径存在且为普通文件(I-010):canonicalize 消除 .. 与符号链接,
/// 拒绝目录与非普通文件。
pub(crate) fn resolve_query_input(raw: &str) -> Result<PathBuf, String> {
    if raw.trim().is_empty() {
        return Err("输入路径不可为空".into());
    }
    let path = Path::new(raw);
    let resolved = path
        .canonicalize()
        .map_err(|_| format!("输入路径不可访问: {raw}"))?;
    let meta = std::fs::metadata(&resolved).map_err(|_| format!("输入路径不可访问: {raw}"))?;
    if !meta.is_file() {
        return Err(format!("输入路径不是普通文件: {raw}"));
    }
    Ok(resolved)
}

/// 视图名须是合法标识符(拼进 DDL,注入在注册处拦截)。
pub(crate) fn is_ident(s: &str) -> bool {
    let mut cs = s.chars();
    matches!(cs.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && cs.all(|c| c.is_ascii_alphanumeric() || c == '_')
}
