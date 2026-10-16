mod db;
mod error;
mod sftp;
mod ssh;
mod system;
mod terminal;
mod tunnel;
#[cfg(test)]
mod live_test;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use base64::Engine;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{RwLock, mpsc::UnboundedSender};

use error::{AppError, Result};
use ssh::{ConnectParams, Conn, SessionInfo};
use terminal::TermCmd;
use tunnel::Tunnel;

pub struct AppState {
    db: Mutex<rusqlite::Connection>,
    conn: RwLock<Option<Arc<Conn>>>,
    last_params: Mutex<Option<ConnectParams>>,
    terms: Mutex<HashMap<u32, UnboundedSender<TermCmd>>>,
    tunnels: Mutex<HashMap<u32, Tunnel>>,
    next_id: AtomicU32,
}

impl AppState {
    pub async fn conn(&self) -> Result<Arc<Conn>> {
        self.conn.read().await.clone().ok_or(AppError::NotConnected)
    }

    pub fn next_id(&self) -> u32 {
        self.next_id.fetch_add(1, Ordering::SeqCst)
    }

    fn stop_features(&self) {
        for (_, tx) in self.terms.lock().unwrap().drain() {
            let _ = tx.send(TermCmd::Close);
        }
        for (_, t) in self.tunnels.lock().unwrap().drain() {
            t.stop();
        }
    }
}

async fn install(app: &AppHandle, state: &AppState, conn: Conn) -> Result<SessionInfo> {
    state.stop_features();
    let conn = Arc::new(conn);
    *state.last_params.lock().unwrap() = Some(conn.params.clone());
    let info = conn.info.clone();
    if let Some(old) = state.conn.write().await.replace(conn.clone()) {
        old.close().await;
    }
    spawn_watcher(app.clone(), Arc::downgrade(&conn));
    Ok(info)
}

fn spawn_watcher(app: AppHandle, conn: Weak<Conn>) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(3)).await;
            let Some(c) = conn.upgrade() else { return };
            if c.closing.load(Ordering::SeqCst) {
                return;
            }
            if c.handle.is_closed() {
                let _ = app.emit("ssh-disconnected", ());
                return;
            }
        }
    });
}

async fn open_and_install(
    app: &AppHandle,
    state: &AppState,
    params: ConnectParams,
    trust: Option<String>,
) -> Result<(SessionInfo, ConnectParams)> {
    let known = db::known_host(&state.db.lock().unwrap(), &params.host, params.port)?;
    let conn = ssh::open(params, known, trust).await?;
    db::save_known_host(&state.db.lock().unwrap(), &conn.info.host, conn.info.port, &conn.info.fingerprint)?;
    let params = conn.params.clone();
    Ok((install(app, state, conn).await?, params))
}

#[tauri::command]
async fn connect(
    app: AppHandle,
    state: State<'_, AppState>,
    params: ConnectParams,
    remember: bool,
    trust: Option<String>,
) -> Result<SessionInfo> {
    let (info, params) = open_and_install(&app, &state, params, trust).await?;
    let saved = {
        let db = state.db.lock().unwrap();
        if remember { db::save_profile(&db, &params) } else { db::delete_profile(&db) }
    };
    if let Err(e) = saved {
        let _ = app.emit("notice", format!("Bağlantı bilgileri kaydedilemedi: {e}"));
    }
    Ok(info)
}

#[tauri::command]
async fn auto_connect(app: AppHandle, state: State<'_, AppState>) -> Result<Option<SessionInfo>> {
    let profile = db::load_profile(&state.db.lock().unwrap())?;
    match profile {
        Some(params) => Ok(Some(open_and_install(&app, &state, params, None).await?.0)),
        None => Ok(None),
    }
}

#[tauri::command]
async fn reconnect(app: AppHandle, state: State<'_, AppState>) -> Result<SessionInfo> {
    let params = state.last_params.lock().unwrap().clone().ok_or(AppError::NotConnected)?;
    Ok(open_and_install(&app, &state, params, None).await?.0)
}

#[tauri::command]
async fn disconnect(state: State<'_, AppState>) -> Result<()> {
    state.stop_features();
    let old = state.conn.write().await.take();
    if let Some(c) = old {
        c.close().await;
    }
    Ok(())
}

#[tauri::command]
async fn session_info(state: State<'_, AppState>) -> Result<Option<SessionInfo>> {
    Ok(state.conn.read().await.as_ref().map(|c| c.info.clone()))
}

#[tauri::command]
fn saved_profile(state: State<'_, AppState>) -> Result<Option<db::ProfileSummary>> {
    db::profile_summary(&state.db.lock().unwrap())
}

#[tauri::command]
fn forget_profile(state: State<'_, AppState>) -> Result<()> {
    db::delete_profile(&state.db.lock().unwrap())
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Result<HashMap<String, String>> {
    db::settings(&state.db.lock().unwrap())
}

#[tauri::command]
fn set_setting(state: State<'_, AppState>, key: String, value: String) -> Result<()> {
    db::set_setting(&state.db.lock().unwrap(), &key, &value)
}

#[tauri::command]
fn read_local_image(path: String) -> Result<String> {
    let bytes = std::fs::read(&path)?;
    if bytes.len() > 15 * 1024 * 1024 {
        return Err(AppError::TooLarge(bytes.len() as u64));
    }
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        _ => return Err(AppError::msg("Desteklenmeyen resim biçimi")),
    };
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db = db::open(&dir.join("remote-vps.db"))?;
            app.manage(AppState {
                db: Mutex::new(db),
                conn: RwLock::new(None),
                last_params: Mutex::new(None),
                terms: Mutex::new(HashMap::new()),
                tunnels: Mutex::new(HashMap::new()),
                next_id: AtomicU32::new(1),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connect,
            auto_connect,
            reconnect,
            disconnect,
            session_info,
            saved_profile,
            forget_profile,
            get_settings,
            set_setting,
            read_local_image,
            sftp::list_dir,
            sftp::mkdir,
            sftp::create_file,
            sftp::rename,
            sftp::copy_paths,
            sftp::move_paths,
            sftp::remove,
            sftp::chmod,
            sftp::read_text,
            sftp::read_text_sudo,
            sftp::write_text_sudo,
            sftp::write_text,
            sftp::read_bytes,
            sftp::upload,
            sftp::download,
            terminal::term_open,
            terminal::term_write,
            terminal::term_resize,
            terminal::term_close,
            system::sys_stats,
            system::proc_list,
            system::proc_kill,
            system::svc_list,
            system::svc_action,
            system::svc_logs,
            system::set_sudo_password,
            tunnel::tunnel_open,
            tunnel::tunnel_close,
            tunnel::tunnel_list,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
