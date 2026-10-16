use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use russh::ChannelMsg;
use russh_sftp::protocol::FileAttributes;
use serde::Serialize;
use tauri::State;
use tauri::ipc::{Channel, Response};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::AppState;
use crate::error::{AppError, Result};
use crate::ssh::shell_quote;

const TEXT_LIMIT: u64 = 5 * 1024 * 1024;
const BYTES_LIMIT: u64 = 25 * 1024 * 1024;
const CHUNK: usize = 256 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    name: String,
    path: String,
    is_dir: bool,
    is_link: bool,
    size: u64,
    mtime: u64,
    mode: u32,
    uid: u32,
    gid: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    name: String,
    done: u64,
    total: u64,
}

pub fn join(dir: &str, name: &str) -> String {
    if dir.ends_with('/') { format!("{dir}{name}") } else { format!("{dir}/{name}") }
}

fn parent(path: &str) -> &str {
    match path.trim_end_matches('/').rfind('/') {
        Some(0) => "/",
        Some(i) => &path[..i],
        None => ".",
    }
}

fn base_name(path: &str) -> &str {
    path.trim_end_matches('/').rsplit('/').next().unwrap_or(path)
}

struct Reporter<'a> {
    ch: &'a Channel<Progress>,
    last: Instant,
}

impl Reporter<'_> {
    fn report(&mut self, name: &str, done: u64, total: u64, force: bool) {
        if force || self.last.elapsed() >= Duration::from_millis(100) {
            self.last = Instant::now();
            let _ = self.ch.send(Progress { name: name.to_string(), done, total });
        }
    }
}

#[tauri::command]
pub async fn list_dir(state: State<'_, AppState>, path: String, show_hidden: bool) -> Result<Vec<Entry>> {
    let conn = state.conn().await?;
    let mut out = Vec::new();
    for e in conn.sftp.read_dir(path.clone()).await? {
        let name = e.file_name();
        if name == "." || name == ".." || (!show_hidden && name.starts_with('.')) {
            continue;
        }
        let md = e.metadata();
        let full = join(&path, &name);
        let is_link = md.is_symlink();
        let (is_dir, size) = if is_link {
            match conn.sftp.metadata(full.clone()).await {
                Ok(t) => (t.is_dir(), t.size.unwrap_or(0)),
                Err(_) => (false, 0),
            }
        } else {
            (md.is_dir(), md.size.unwrap_or(0))
        };
        out.push(Entry {
            name,
            path: full,
            is_dir,
            is_link,
            size,
            mtime: md.mtime.unwrap_or(0) as u64,
            mode: md.permissions.unwrap_or(0) & 0o7777,
            uid: md.uid.unwrap_or(0),
            gid: md.gid.unwrap_or(0),
        });
    }
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

#[tauri::command]
pub async fn mkdir(state: State<'_, AppState>, path: String) -> Result<()> {
    Ok(state.conn().await?.sftp.create_dir(path).await?)
}

#[tauri::command]
pub async fn create_file(state: State<'_, AppState>, path: String) -> Result<()> {
    let conn = state.conn().await?;
    if conn.sftp.try_exists(path.clone()).await? {
        return Err(AppError::msg("Bu adla bir öğe zaten var"));
    }
    conn.sftp.create(path).await?.shutdown().await?;
    Ok(())
}

#[tauri::command]
pub async fn rename(state: State<'_, AppState>, from: String, to: String) -> Result<()> {
    let conn = state.conn().await?;
    if conn.sftp.try_exists(to.clone()).await? {
        return Err(AppError::msg("Hedefte aynı adla bir öğe zaten var"));
    }
    Ok(conn.sftp.rename(from, to).await?)
}

#[tauri::command]
pub async fn copy_paths(state: State<'_, AppState>, paths: Vec<String>, dest_dir: String) -> Result<()> {
    let conn = state.conn().await?;
    let args: Vec<String> = paths.iter().map(|p| shell_quote(p)).collect();
    conn.exec(&format!("cp -a -- {} {}", args.join(" "), shell_quote(&dest_dir)), None).await?.into_result()?;
    Ok(())
}

#[tauri::command]
pub async fn move_paths(state: State<'_, AppState>, paths: Vec<String>, dest_dir: String) -> Result<()> {
    let conn = state.conn().await?;
    let args: Vec<String> = paths.iter().map(|p| shell_quote(p)).collect();
    conn.exec(&format!("mv -n -- {} {}", args.join(" "), shell_quote(&dest_dir)), None).await?.into_result()?;
    Ok(())
}

#[tauri::command]
pub async fn remove(state: State<'_, AppState>, paths: Vec<String>) -> Result<()> {
    let conn = state.conn().await?;
    for p in &paths {
        let t = p.trim_end_matches('/');
        if t.is_empty() || t == conn.info.home.trim_end_matches('/') || !t.starts_with('/') {
            return Err(AppError::msg(format!("Güvenlik nedeniyle silinmedi: {p}")));
        }
    }
    let args: Vec<String> = paths.iter().map(|p| shell_quote(p)).collect();
    conn.exec(&format!("rm -rf -- {}", args.join(" ")), None).await?.into_result()?;
    Ok(())
}

#[tauri::command]
pub async fn chmod(state: State<'_, AppState>, path: String, mode: u32) -> Result<()> {
    let attrs = FileAttributes { permissions: Some(mode & 0o7777), ..FileAttributes::empty() };
    Ok(state.conn().await?.sftp.set_metadata(path, attrs).await?)
}

#[tauri::command]
pub async fn read_text(state: State<'_, AppState>, path: String) -> Result<String> {
    let conn = state.conn().await?;
    let size = conn.sftp.metadata(path.clone()).await?.size.unwrap_or(0);
    if size > TEXT_LIMIT {
        return Err(AppError::TooLarge(size));
    }
    decode_text(conn.sftp.read(path).await?)
}

pub fn decode_text(bytes: Vec<u8>) -> Result<String> {
    if bytes[..bytes.len().min(8192)].contains(&0) {
        return Err(AppError::Binary);
    }
    String::from_utf8(bytes).map_err(|_| AppError::Binary)
}

#[tauri::command]
pub async fn write_text(state: State<'_, AppState>, path: String, content: String) -> Result<()> {
    let conn = state.conn().await?;
    let mut f = conn.sftp.create(path).await?;
    f.write_all(content.as_bytes()).await?;
    f.shutdown().await?;
    Ok(())
}

#[tauri::command]
pub async fn read_text_sudo(state: State<'_, AppState>, path: String) -> Result<String> {
    let conn = state.conn().await?;
    let text = conn
        .exec_sudo(&format!("head -c {} -- {}", TEXT_LIMIT + 1, shell_quote(&path)))
        .await?
        .into_result()?;
    if text.len() as u64 > TEXT_LIMIT {
        return Err(AppError::TooLarge(text.len() as u64));
    }
    if text.contains('\0') || text.contains('\u{FFFD}') {
        return Err(AppError::Binary);
    }
    Ok(text)
}

#[tauri::command]
pub async fn write_text_sudo(state: State<'_, AppState>, path: String, content: String) -> Result<()> {
    let conn = state.conn().await?;
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let tmp = join(&conn.info.home, &format!(".rvd-save-{nanos}"));
    let mut f = conn.sftp.create(tmp.clone()).await?;
    let private = FileAttributes { permissions: Some(0o600), ..FileAttributes::empty() };
    conn.sftp.set_metadata(tmp.clone(), private).await?;
    f.write_all(content.as_bytes()).await?;
    f.shutdown().await?;
    let res = conn.exec_sudo(&format!("cat -- {} > {}", shell_quote(&tmp), shell_quote(&path))).await;
    let _ = conn.sftp.remove_file(tmp).await;
    res?.into_result()?;
    Ok(())
}

#[tauri::command]
pub async fn read_bytes(state: State<'_, AppState>, path: String) -> Result<Response> {
    let conn = state.conn().await?;
    let size = conn.sftp.metadata(path.clone()).await?.size.unwrap_or(0);
    if size > BYTES_LIMIT {
        return Err(AppError::TooLarge(size));
    }
    Ok(Response::new(conn.sftp.read(path).await?))
}

#[tauri::command]
pub async fn upload(
    state: State<'_, AppState>,
    local_paths: Vec<String>,
    remote_dir: String,
    on_progress: Channel<Progress>,
) -> Result<()> {
    let conn = state.conn().await?;
    let mut files: Vec<(PathBuf, String, u64)> = Vec::new();
    let mut dirs: Vec<String> = Vec::new();
    let mut stack: Vec<(PathBuf, String)> = local_paths
        .iter()
        .map(|p| {
            let p = PathBuf::from(p);
            let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            (p, join(&remote_dir, &name))
        })
        .collect();
    while let Some((local, remote)) = stack.pop() {
        let md = std::fs::metadata(&local)?;
        if md.is_dir() {
            dirs.push(remote.clone());
            for e in std::fs::read_dir(&local)? {
                let e = e?;
                stack.push((e.path(), join(&remote, &e.file_name().to_string_lossy())));
            }
        } else {
            files.push((local, remote, md.len()));
        }
    }
    dirs.sort_by_key(|d| d.len());
    for d in dirs {
        if !conn.sftp.try_exists(d.clone()).await? {
            conn.sftp.create_dir(d).await?;
        }
    }

    let total: u64 = files.iter().map(|f| f.2).sum();
    let mut done = 0u64;
    let mut rep = Reporter { ch: &on_progress, last: Instant::now() };
    let mut buf = vec![0u8; CHUNK];
    for (local, remote, _) in files {
        let name = base_name(&remote).to_string();
        let mut src = tokio::fs::File::open(&local).await?;
        let mut dst = conn.sftp.create(remote).await?;
        loop {
            let n = src.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            dst.write_all(&buf[..n]).await?;
            done += n as u64;
            rep.report(&name, done, total, false);
        }
        dst.shutdown().await?;
    }
    rep.report("", total, total, true);
    Ok(())
}

#[tauri::command]
pub async fn download(
    state: State<'_, AppState>,
    remote_path: String,
    local_path: String,
    on_progress: Channel<Progress>,
) -> Result<()> {
    let conn = state.conn().await?;
    let md = conn.sftp.metadata(remote_path.clone()).await?;
    let name = base_name(&remote_path).to_string();
    let mut rep = Reporter { ch: &on_progress, last: Instant::now() };
    let mut dst = tokio::fs::File::create(Path::new(&local_path)).await?;
    let mut done = 0u64;

    if md.is_dir() {
        let cmd = format!("tar czf - -C {} -- {}", shell_quote(parent(&remote_path)), shell_quote(&name));
        let mut ch = conn.handle.channel_open_session().await?;
        ch.exec(true, cmd).await?;
        ch.eof().await?;
        let mut code = None;
        let mut err = Vec::new();
        while let Some(msg) = ch.wait().await {
            match msg {
                ChannelMsg::Data { data } => {
                    dst.write_all(&data).await?;
                    done += data.len() as u64;
                    rep.report(&name, done, 0, false);
                }
                ChannelMsg::ExtendedData { data, .. } => err.extend_from_slice(&data),
                ChannelMsg::ExitStatus { exit_status } => code = Some(exit_status),
                _ => {}
            }
        }
        dst.flush().await?;
        if code != Some(0) {
            return Err(AppError::msg(format!("tar hatası: {}", String::from_utf8_lossy(&err).trim())));
        }
    } else {
        let total = md.size.unwrap_or(0);
        let mut src = conn.sftp.open(remote_path).await?;
        let mut buf = vec![0u8; CHUNK];
        loop {
            let n = src.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            dst.write_all(&buf[..n]).await?;
            done += n as u64;
            rep.report(&name, done, total, false);
        }
        dst.flush().await?;
    }
    rep.report(&name, done, done, true);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_helpers() {
        assert_eq!(join("/home/u", "a"), "/home/u/a");
        assert_eq!(join("/", "etc"), "/etc");
        assert_eq!(parent("/home/u/dir"), "/home/u");
        assert_eq!(parent("/etc"), "/");
        assert_eq!(parent("/home/u/dir/"), "/home/u");
        assert_eq!(base_name("/home/u/dir/"), "dir");
        assert_eq!(base_name("/a/b.txt"), "b.txt");
    }

    #[test]
    fn text_detection() {
        assert_eq!(decode_text(b"hello\n".to_vec()).unwrap(), "hello\n");
        assert_eq!(decode_text("çğüş".as_bytes().to_vec()).unwrap(), "çğüş");
        assert!(matches!(decode_text(vec![0x7f, b'E', b'L', b'F', 0, 1]), Err(AppError::Binary)));
        assert!(matches!(decode_text(vec![0xff, 0xfe, 0x41]), Err(AppError::Binary)));
        assert_eq!(decode_text(Vec::new()).unwrap(), "");
    }
}
