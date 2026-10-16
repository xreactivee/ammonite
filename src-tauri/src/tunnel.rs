use serde::Serialize;
use tauri::State;
use tauri::async_runtime::JoinHandle;
use tokio::net::TcpListener;

use crate::AppState;
use crate::error::{AppError, Result};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TunnelInfo {
    id: u32,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
}

pub struct Tunnel {
    info: TunnelInfo,
    task: JoinHandle<()>,
}

impl Tunnel {
    pub fn stop(&self) {
        self.task.abort();
    }
}

#[tauri::command]
pub async fn tunnel_open(
    state: State<'_, AppState>,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
) -> Result<TunnelInfo> {
    let conn = state.conn().await?;
    let listener = TcpListener::bind(("127.0.0.1", local_port))
        .await
        .map_err(|e| AppError::msg(format!("Yerel port {local_port} açılamadı: {e}")))?;
    let local_port = listener.local_addr()?.port();
    let info = TunnelInfo { id: state.next_id(), local_port, remote_host: remote_host.clone(), remote_port };

    let task = tauri::async_runtime::spawn(async move {
        while let Ok((mut sock, peer)) = listener.accept().await {
            let conn = conn.clone();
            let host = remote_host.clone();
            tauri::async_runtime::spawn(async move {
                let opened = conn
                    .handle
                    .channel_open_direct_tcpip(host, remote_port as u32, peer.ip().to_string(), peer.port() as u32)
                    .await;
                if let Ok(ch) = opened {
                    let mut stream = ch.into_stream();
                    let _ = tokio::io::copy_bidirectional(&mut sock, &mut stream).await;
                }
            });
        }
    });
    state.tunnels.lock().unwrap().insert(info.id, Tunnel { info: info.clone(), task });
    Ok(info)
}

#[tauri::command]
pub fn tunnel_close(state: State<'_, AppState>, id: u32) -> Result<()> {
    if let Some(t) = state.tunnels.lock().unwrap().remove(&id) {
        t.stop();
    }
    Ok(())
}

#[tauri::command]
pub fn tunnel_list(state: State<'_, AppState>) -> Vec<TunnelInfo> {
    let mut v: Vec<TunnelInfo> = state.tunnels.lock().unwrap().values().map(|t| t.info.clone()).collect();
    v.sort_by_key(|t| t.id);
    v
}
