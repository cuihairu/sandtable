//! 项目打包(文档 9/10 章):场景 / 实验(可选产物)→ 单个 `.sandtable`
//! 归档(zip + manifest v1)。
//!
//! 纪律(文档 9 章「项目打包」):
//! - Project 是配置组织单元,不新增仿真语义;包内容就是普通配置文件,
//!   展开(restore/unpack)后 `simulate` / `sweep` 直接可跑;
//! - 导入即全量校验:manifest 结构、路径纪律、逐条 sha256、归档文件集合
//!   与清单严格相等、scenario / experiment 逐个加载校验;坏条目逐条报完
//!   再失败(同 params import),不静默跳过;
//! - 确定性:条目按路径排序、归档时间戳固定,同目录两次打包字节一致。

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Read;
use std::path::{Component, Path};

use anyhow::{anyhow, bail, Context};
use sandtable_core as core;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const MANIFEST: &str = "manifest.json";
/// 归档内固定时间戳(zip 格式起点 1980-01-01):打包产物只随内容变化。
const FIXED_MTIME: (u16, u8, u8, u8, u8, u8) = (1980, 1, 1, 0, 0, 0);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Kind {
    Scenario,
    Experiment,
    Result,
}

impl Kind {
    fn dir(self) -> &'static str {
        match self {
            Kind::Scenario => "scenarios",
            Kind::Experiment => "experiments",
            Kind::Result => "results",
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct Entry {
    path: String,
    kind: Kind,
    sha256: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Manifest {
    schema_version: String,
    name: String,
    entries: Vec<Entry>,
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut hex = String::with_capacity(64);
    for b in digest {
        hex.push_str(&format!("{b:02x}"));
    }
    hex
}

/// 路径纪律(文档 9 章):相对、正斜杠、两段 `<目录>/<文件>`、无 `..` /
/// 盘符;kind 决定所属目录,scenario / experiment 须为 .yaml。
fn check_entry_path(path: &str, kind: Kind) -> anyhow::Result<()> {
    if path.contains('\\') {
        bail!("路径须用正斜杠: {path}");
    }
    let p = Path::new(path);
    if p.components().any(|c| !matches!(c, Component::Normal(_))) {
        bail!("路径须为相对路径且不含 .. 或 .: {path}");
    }
    let comps: Vec<_> = p.components().collect();
    if comps.len() != 2 {
        bail!("路径须为 <目录>/<文件> 两段: {path}");
    }
    let dir = comps[0].as_os_str().to_str().context("路径非 UTF-8")?;
    let file = comps[1].as_os_str().to_str().context("路径非 UTF-8")?;
    if dir != kind.dir() {
        bail!("{path}: {} 条目须位于 {}/ 下", kind.dir(), kind.dir());
    }
    if kind != Kind::Result && Path::new(file).extension().and_then(|e| e.to_str()) != Some("yaml")
    {
        bail!("{path}: {} 条目须为 .yaml", kind.dir());
    }
    Ok(())
}

/// 收集项目目录(一层):scenarios/*.yaml、experiments/*.yaml、results/*。
/// 清单约定之外的条目报错(不静默丢弃)。
fn collect_dir(dir: &Path) -> anyhow::Result<BTreeMap<String, (Kind, Vec<u8>)>> {
    let mut files = BTreeMap::new();
    let mut errors: Vec<String> = Vec::new();
    for kind in [Kind::Scenario, Kind::Experiment, Kind::Result] {
        let sub = dir.join(kind.dir());
        let rd = match fs::read_dir(&sub) {
            Ok(rd) => rd,
            // results 可缺省;另两个目录缺失按空处理(允许只带其一)
            Err(e) if kind == Kind::Result && e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => {
                errors.push(format!("读取 {} 失败: {e}", sub.display()));
                continue;
            }
        };
        for e in rd {
            let e = match e {
                Ok(e) => e,
                Err(er) => {
                    errors.push(format!("遍历 {} 失败: {er}", sub.display()));
                    continue;
                }
            };
            let name = e.file_name().to_string_lossy().into_owned();
            let ft = match e.file_type() {
                Ok(t) => t,
                Err(er) => {
                    errors.push(format!("{}/{name}: 读取类型失败: {er}", kind.dir()));
                    continue;
                }
            };
            if !ft.is_file() {
                errors.push(format!("{}/{name}: 仅支持一层文件(不收子目录)", kind.dir()));
                continue;
            }
            let rel = format!("{}/{name}", kind.dir());
            if kind != Kind::Result
                && Path::new(&name).extension().and_then(|x| x.to_str()) != Some("yaml")
            {
                errors.push(format!("{rel}: {} 目录只收 .yaml", kind.dir()));
                continue;
            }
            match fs::read(e.path()) {
                Ok(bytes) => {
                    files.insert(rel, (kind, bytes));
                }
                Err(er) => errors.push(format!("读取 {rel} 失败: {er}")),
            }
        }
    }
    // 项目根下除三个约定目录(与旧清单)之外,出现任何条目都报错
    if let Ok(rd) = fs::read_dir(dir) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name != MANIFEST
                && ![Kind::Scenario, Kind::Experiment, Kind::Result]
                    .iter()
                    .any(|k| k.dir() == name)
            {
                errors.push(format!(
                    "项目根出现清单约定之外的条目:{name}(仅 scenarios/ experiments/ results/ 可打包)"
                ));
            }
        }
    }
    if !errors.is_empty() {
        bail!("项目目录不符合打包约定:\n{}", errors.join("\n"));
    }
    Ok(files)
}

fn counts(manifest: &Manifest) -> (usize, usize, usize) {
    let mut ns = 0;
    let mut ne = 0;
    let mut nr = 0;
    for e in &manifest.entries {
        match e.kind {
            Kind::Scenario => ns += 1,
            Kind::Experiment => ne += 1,
            Kind::Result => nr += 1,
        }
    }
    (ns, ne, nr)
}

/// 打包项目目录为 `.sandtable` 归档(文档 9 章契约)。
pub fn pack(dir: &Path, out: &Path) -> anyhow::Result<()> {
    if !dir.is_dir() {
        bail!("项目目录不存在: {}", dir.display());
    }
    let files = collect_dir(dir)?;
    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .context("项目目录缺名称")?;
    let n_cfg = files.values().filter(|(k, _)| *k != Kind::Result).count();
    if n_cfg == 0 {
        bail!("至少需要一个 scenario 或 experiment 才能打包");
    }
    let entries: Vec<Entry> = files
        .iter()
        .map(|(path, (kind, bytes))| Entry {
            path: path.clone(),
            kind: *kind,
            sha256: sha256_hex(bytes),
        })
        .collect();
    let manifest = Manifest {
        schema_version: "1".into(),
        name,
        entries,
    };
    // manifest 用 JSON:机器生成的打包元数据,序列化字节稳定,
    // 浏览器端零依赖可解析(Web 侧加载项目文件,文档 22 章)
    let manifest_json = serde_json::to_string_pretty(&manifest).context("manifest 序列化失败")?;

    let file = fs::File::create(out).with_context(|| format!("创建 {} 失败", out.display()))?;
    let mut zw = zip::ZipWriter::new(file);
    let (y, mo, d, h, mi, s) = FIXED_MTIME;
    let mtime = zip::DateTime::from_date_and_time(y, mo, d, h, mi, s)
        .map_err(|e| anyhow!("固定时间戳非法: {e:?}"))?;
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .last_modified_time(mtime);
    zw.start_file(MANIFEST, opts)
        .context("写入 manifest 失败")?;
    std::io::Write::write_all(&mut zw, manifest_json.as_bytes())?;
    for (path, (_, bytes)) in &files {
        zw.start_file(path.as_str(), opts)
            .with_context(|| format!("写入 {path} 失败"))?;
        std::io::Write::write_all(&mut zw, bytes)?;
    }
    zw.finish().context("收尾归档失败")?;

    let (ns, ne, nr) = counts(&manifest);
    println!(
        "已打包 {} → {}(scenario {ns} / experiment {ne} / result {nr})",
        out.display(),
        dir.display()
    );
    Ok(())
}

fn read_entry(ar: &mut zip::ZipArchive<fs::File>, name: &str) -> anyhow::Result<Vec<u8>> {
    let mut zr = ar
        .by_name(name)
        .with_context(|| format!("归档读取 {name} 失败"))?;
    let mut buf = Vec::new();
    zr.read_to_end(&mut buf)
        .with_context(|| format!("读取 {name} 失败"))?;
    Ok(buf)
}

/// 读归档并校验 manifest 结构:schema_version、路径不重复、归档文件集合
/// 与清单严格相等(多一件少一件都报错)。
fn read_archive(path: &Path) -> anyhow::Result<(Manifest, BTreeMap<String, Vec<u8>>)> {
    let f = fs::File::open(path).with_context(|| format!("打开 {} 失败", path.display()))?;
    let mut ar = zip::ZipArchive::new(f)
        .with_context(|| format!("{} 不是有效的 zip 归档", path.display()))?;
    let mut names: BTreeSet<String> = ar.file_names().map(str::to_owned).collect();
    if !names.remove(MANIFEST) {
        bail!("归档缺少 {MANIFEST}");
    }
    let manifest_bytes = read_entry(&mut ar, MANIFEST)?;
    let text = std::str::from_utf8(&manifest_bytes).map_err(|_| anyhow!("{MANIFEST} 非 UTF-8"))?;
    let manifest: Manifest =
        serde_json::from_str(text).map_err(|e| anyhow!("{MANIFEST} 解析失败: {e}"))?;
    if manifest.schema_version != "1" {
        bail!(
            "manifest schema_version = {},本工具支持 \"1\"",
            manifest.schema_version
        );
    }
    if manifest.name.trim().is_empty() {
        bail!("manifest name 不能为空");
    }
    let mut declared = BTreeSet::new();
    for e in &manifest.entries {
        if !declared.insert(e.path.as_str()) {
            bail!("清单路径重复: {}", e.path);
        }
    }
    for e in &manifest.entries {
        // 路径纪律先于存在性:越界路径不进文件系统
        if let Err(er) = check_entry_path(&e.path, e.kind) {
            bail!("{er}");
        }
        if !names.remove(e.path.as_str()) {
            bail!("清单声明 {} 但归档中不存在", e.path);
        }
    }
    if !names.is_empty() {
        bail!(
            "归档中存在清单未声明的条目:{}",
            names.into_iter().collect::<Vec<_>>().join(", ")
        );
    }
    let mut files = BTreeMap::new();
    for e in &manifest.entries {
        files.insert(e.path.clone(), read_entry(&mut ar, &e.path)?);
    }
    Ok((manifest, files))
}

/// 导入即全量校验(文档 9 章):路径纪律、逐条 sha256、scenario /
/// experiment 加载校验;坏条目逐条报完再失败,不静默跳过。
fn validate_project(manifest: &Manifest, files: &BTreeMap<String, Vec<u8>>) -> anyhow::Result<()> {
    let mut errors: Vec<String> = Vec::new();
    for e in &manifest.entries {
        if let Err(er) = check_entry_path(&e.path, e.kind) {
            errors.push(format!("{}: {er}", e.path));
            continue;
        }
        let bytes = &files[&e.path];
        let got = sha256_hex(bytes);
        if got != e.sha256 {
            errors.push(format!(
                "{}: sha256 不匹配(清单 {},实际 {got})",
                e.path, e.sha256
            ));
            continue;
        }
        if e.kind == Kind::Result {
            continue;
        }
        let text = match std::str::from_utf8(bytes) {
            Ok(t) => t,
            Err(_) => {
                errors.push(format!("{}: 非 UTF-8", e.path));
                continue;
            }
        };
        let r = match e.kind {
            Kind::Scenario => core::scenario::load_str(text).map(|_| ()),
            Kind::Experiment => core::scenario::load_experiment_str(text).map(|_| ()),
            Kind::Result => Ok(()),
        };
        if let Err(er) = r {
            errors.push(format!("{}: 配置校验失败: {er}", e.path));
        }
    }
    if !errors.is_empty() {
        bail!("项目校验失败:\n{}", errors.join("\n"));
    }
    Ok(())
}

/// 只校验归档,不落盘(文档 10 章 `project check`)。
pub fn check(path: &Path) -> anyhow::Result<()> {
    let (manifest, files) = read_archive(path)?;
    validate_project(&manifest, &files)?;
    let (ns, ne, nr) = counts(&manifest);
    println!(
        "归档有效:{}(scenario {ns} / experiment {ne} / result {nr})",
        manifest.name
    );
    Ok(())
}

/// 校验后展开到目标目录(目标目录须不存在或为空,不覆盖既有文件)。
pub fn unpack(path: &Path, out: &Path) -> anyhow::Result<()> {
    let (manifest, files) = read_archive(path)?;
    validate_project(&manifest, &files)?;
    if let Ok(mut rd) = fs::read_dir(out) {
        if rd.next().is_some() {
            bail!("目标目录非空: {}(解包不覆盖既有文件)", out.display());
        }
    }
    for (p, bytes) in &files {
        let dst = out.join(p);
        // 路径已在 check_entry_path 拦截 ..,父目录必为约定目录
        fs::create_dir_all(dst.parent().context("条目缺父目录")?)
            .with_context(|| format!("创建 {} 失败", dst.parent().unwrap().display()))?;
        fs::write(&dst, bytes).with_context(|| format!("写 {} 失败", dst.display()))?;
    }
    let (ns, ne, nr) = counts(&manifest);
    println!(
        "已展开 {} → {}(scenario {ns} / experiment {ne} / result {nr})",
        manifest.name,
        out.display()
    );
    Ok(())
}
