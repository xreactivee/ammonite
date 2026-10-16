use russh::ChannelMsg;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, State};
use tokio::sync::mpsc;

use crate::AppState;
use crate::error::{AppError, Result};
use crate::ssh::shell_quote;

pub enum TermCmd {
    Input(Vec<u8>),
    Resize(u32, u32),
    Close,
}

#[tauri::command]
pub async fn term_open(
    app: AppHandle,
    state: State<'_, AppState>,
    cols: u32,
    rows: u32,
    cwd: Option<String>,
    on_data: Channel<InvokeResponseBody>,
) -> Result<u32> {
    let conn = state.conn().await?;
    let mut ch = conn.handle.channel_open_session().await?;
    ch.request_pty(true, "xterm-256color", cols, rows, 0, 0, &[]).await?;
    match cwd {
        Some(dir) => {
            let cmd = format!("cd {} 2>/dev/null; exec \"${{SHELL:-/bin/bash}}\" -l", shell_quote(&dir));
            ch.exec(true, cmd).await?;
        }
        None => ch.request_shell(true).await?,
    }

    let (tx, mut rx) = mpsc::unbounded_channel();
    let id = state.next_id();
    state.terms.lock().unwrap().insert(id, tx);

    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                msg = ch.wait() => match msg {
                    Some(ChannelMsg::Data { data }) | Some(ChannelMsg::ExtendedData { data, .. }) => {
                        if on_data.send(InvokeResponseBody::Raw(data.to_vec())).is_err() {
                            break;
                        }
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                    _ => {}
                },
                cmd = rx.recv() => match cmd {
                    Some(TermCmd::Input(bytes)) => { let _ = ch.data(&bytes[..]).await; }
                    Some(TermCmd::Resize(c, r)) => { let _ = ch.window_change(c, r, 0, 0).await; }
                    Some(TermCmd::Close) | None => { let _ = ch.close().await; break; }
                },
            }
        }
        let _ = on_data.send(InvokeResponseBody::Raw(Vec::new()));
        app.state::<AppState>().terms.lock().unwrap().remove(&id);
    });
    Ok(id)
}

fn send(state: &AppState, id: u32, cmd: TermCmd) -> Result<()> {
    let terms = state.terms.lock().unwrap();
    let tx = terms.get(&id).ok_or_else(|| AppError::msg("Terminal oturumu kapalı"))?;
    tx.send(cmd).map_err(|_| AppError::msg("Terminal oturumu kapalı"))
}

#[tauri::command]
pub fn term_write(state: State<'_, AppState>, id: u32, data: String) -> Result<()> {
    send(&state, id, TermCmd::Input(data.into_bytes()))
}

#[tauri::command]
pub fn term_resize(state: State<'_, AppState>, id: u32, cols: u32, rows: u32) -> Result<()> {
    send(&state, id, TermCmd::Resize(cols, rows))
}

#[tauri::command]
pub fn term_close(state: State<'_, AppState>, id: u32) -> Result<()> {
    let _ = send(&state, id, TermCmd::Close);
    Ok(())
}
