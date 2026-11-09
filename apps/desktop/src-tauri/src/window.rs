//! 窗口与下载面(桌面壳):主窗构建(缩放热键 polyfill 与下载拦截挂在
//! WebviewBuilder 上)+ 下载目标路径消歧。

use std::path::{Path, PathBuf};

use tauri::path::BaseDirectory;
use tauri::webview::DownloadEvent;
use tauri::{Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

pub(crate) fn main_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::WebviewWindow<R>> {
    let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title("sandtable")
        .inner_size(1280.0, 840.0)
        .zoom_hotkeys_enabled(true)
        .on_download(|webview, event| match event {
            DownloadEvent::Requested { destination, .. } => {
                let name = destination
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .filter(|n| !n.is_empty())
                    .unwrap_or_else(|| "download".to_owned());
                *destination = download_destination(&download_dir(webview.app_handle()), &name);
                true
            }
            DownloadEvent::Finished { success, .. } => {
                // 无头走查(桌面冒烟脚本)靠这行判定下载是否真的落盘
                eprintln!("下载{success}");
                false
            }
            _ => false,
        });
    window.build()
}

/// 下载目录:Download 定位失败(无 XDG 下载目录)回退到 家目录/Downloads;
/// 目录不存在时补建——WebKit 写入不存在的目录会直接失败。
pub(crate) fn download_dir<R: Runtime>(app: &tauri::AppHandle<R>) -> PathBuf {
    let dir = app
        .path()
        .resolve("", BaseDirectory::Download)
        .unwrap_or_else(|_| {
            let mut p = std::env::home_dir().unwrap_or_else(|| PathBuf::from("."));
            p.push("Downloads");
            p
        });
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// 下载落点:重名加序号,不静默覆盖上一次导出的产物。
pub(crate) fn download_destination(dir: &Path, name: &str) -> PathBuf {
    // 点号前的整体当干,name 形如 days.tar.gz 时只截最后一节
    let (stem, ext) = match name.split_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_owned(), Some(e.to_owned())),
        _ => (name.to_owned(), None),
    };
    let mut n = 0u32;
    loop {
        let cand = if n == 0 {
            dir.join(name)
        } else {
            dir.join(match &ext {
                Some(e) => format!("{stem} ({n}).{e}"),
                None => format!("{stem} ({n})"),
            })
        };
        if !cand.exists() {
            return cand;
        }
        n += 1;
    }
}
