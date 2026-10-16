use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::{self, Handle, KeyboardInteractiveAuthResponse};
use russh::keys::{HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate, decode_secret_key};
use russh::ChannelMsg;
use russh_sftp::client::SftpSession;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectParams {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: Auth,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Auth {
    Password { password: String },
    Key { key: String, passphrase: Option<String> },
}

impl Auth {
    pub fn kind(&self) -> &'static str {
        match self {
            Auth::Password { .. } => "password",
            Auth::Key { .. } => "key",
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub home: String,
    pub fingerprint: String,
    pub hostname: String,
    pub kernel: String,
    pub os: String,
}

pub struct ExecOutput {
    pub stdout: String,
    pub stderr: String,
    pub code: Option<u32>,
}

impl ExecOutput {
    pub fn ok(&self) -> bool {
        self.code == Some(0)
    }

    pub fn into_result(self) -> Result<String> {
        if self.ok() {
            Ok(self.stdout)
        } else {
            let msg = if self.stderr.trim().is_empty() { self.stdout } else { self.stderr };
            Err(AppError::msg(msg.trim().to_string()))
        }
    }
}

pub struct Client {
    known: Option<String>,
    trust: Option<String>,
    seen: Arc<Mutex<Option<String>>>,
}

impl client::Handler for Client {
    type Error = russh::Error;

    async fn check_server_key(&mut self, key: &PublicKeyOrCertificate) -> std::result::Result<bool, Self::Error> {
        let fp = match key {
            PublicKeyOrCertificate::PublicKey { key, .. } => key.fingerprint(HashAlg::Sha256).to_string(),
            PublicKeyOrCertificate::Certificate(c) => c.public_key().fingerprint(HashAlg::Sha256).to_string(),
        };
        *self.seen.lock().unwrap() = Some(fp.clone());
        Ok(self.known.as_deref() == Some(fp.as_str()) || self.trust.as_deref() == Some(fp.as_str()))
    }
}

pub struct Conn {
    pub handle: Handle<Client>,
    pub sftp: SftpSession,
    pub params: ConnectParams,
    pub info: SessionInfo,
    pub sudo_pw: Mutex<Option<String>>,
    pub closing: AtomicBool,
}

pub fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

fn load_key_text(key: &str) -> Result<String> {
    let t = key.trim();
    if t.starts_with("-----BEGIN") || t.starts_with("PuTTY-User-Key-File") {
        Ok(key.to_string())
    } else {
        std::fs::read_to_string(t).map_err(|e| AppError::msg(format!("Anahtar dosyası okunamadı: {e}")))
    }
}

pub async fn open(mut params: ConnectParams, known: Option<String>, trust: Option<String>) -> Result<Conn> {
    if let Auth::Key { key, .. } = &mut params.auth {
        *key = load_key_text(key)?;
    }

    let config = Arc::new(client::Config {
        keepalive_interval: Some(Duration::from_secs(15)),
        keepalive_max: 3,
        nodelay: true,
        ..Default::default()
    });
    let seen = Arc::new(Mutex::new(None));
    let handler = Client { known: known.clone(), trust: trust.clone(), seen: seen.clone() };

    let connecting = client::connect(config, (params.host.as_str(), params.port), handler);
    let res = tokio::time::timeout(Duration::from_secs(20), connecting)
        .await
        .map_err(|_| AppError::msg("Bağlantı zaman aşımına uğradı"))?;
    let fingerprint = seen.lock().unwrap().clone();
    let mut handle = match res {
        Ok(h) => h,
        Err(e) => {
            if let Some(fp) = fingerprint
                && trust.as_deref() != Some(fp.as_str())
            {
                match known {
                    Some(k) if k != fp => return Err(AppError::HostKeyMismatch { expected: k, actual: fp }),
                    None => return Err(AppError::UnknownHostKey { fingerprint: fp }),
                    _ => {}
                }
            }
            return Err(AppError::msg(format!("Bağlanılamadı: {e}")));
        }
    };
    let fingerprint = fingerprint.unwrap_or_default();

    let authed = match &params.auth {
        Auth::Password { password } => {
            handle.authenticate_password(&params.username, password).await?.success()
                || keyboard_interactive(&mut handle, &params.username, password).await?
        }
        Auth::Key { key, passphrase } => {
            let pass = passphrase.as_deref().filter(|p| !p.is_empty());
            let key = decode_secret_key(key, pass)
                .map_err(|e| AppError::msg(format!("Özel anahtar çözülemedi (passphrase?): {e}")))?;
            let hash = handle.best_supported_rsa_hash().await?.flatten();
            handle
                .authenticate_publickey(&params.username, PrivateKeyWithHashAlg::new(Arc::new(key), hash))
                .await?
                .success()
        }
    };
    if !authed {
        return Err(AppError::Auth);
    }

    let channel = handle.channel_open_session().await?;
    channel.request_subsystem(true, "sftp").await?;
    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| AppError::msg(format!("SFTP başlatılamadı: {e}")))?;
    let home = sftp.canonicalize(".").await?;

    let sudo_pw = match &params.auth {
        Auth::Password { password } => Some(password.clone()),
        Auth::Key { .. } => None,
    };
    let mut conn = Conn {
        handle,
        sftp,
        info: SessionInfo {
            host: params.host.clone(),
            port: params.port,
            username: params.username.clone(),
            home,
            fingerprint,
            hostname: String::new(),
            kernel: String::new(),
            os: String::new(),
        },
        params,
        sudo_pw: Mutex::new(sudo_pw),
        closing: AtomicBool::new(false),
    };
    let out = conn
        .exec("uname -n; uname -r; (. /etc/os-release 2>/dev/null && echo \"$PRETTY_NAME\")", None)
        .await?;
    let mut lines = out.stdout.lines().map(str::to_string);
    conn.info.hostname = lines.next().unwrap_or_default();
    conn.info.kernel = lines.next().unwrap_or_default();
    conn.info.os = lines.next().unwrap_or_default();
    Ok(conn)
}

async fn keyboard_interactive(handle: &mut Handle<Client>, user: &str, password: &str) -> Result<bool> {
    let mut resp = handle.authenticate_keyboard_interactive_start(user, None::<String>).await?;
    for _ in 0..5 {
        match resp {
            KeyboardInteractiveAuthResponse::Success => return Ok(true),
            KeyboardInteractiveAuthResponse::Failure { .. } => return Ok(false),
            KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                let answers = prompts.iter().map(|_| password.to_string()).collect();
                resp = handle.authenticate_keyboard_interactive_respond(answers).await?;
            }
        }
    }
    Ok(false)
}

impl Conn {
    pub async fn exec(&self, cmd: &str, stdin: Option<&[u8]>) -> Result<ExecOutput> {
        let mut ch = self.handle.channel_open_session().await?;
        ch.exec(true, cmd).await?;
        if let Some(input) = stdin {
            ch.data(input).await?;
        }
        ch.eof().await?;
        let (mut out, mut err, mut code) = (Vec::new(), Vec::new(), None);
        while let Some(msg) = ch.wait().await {
            match msg {
                ChannelMsg::Data { data } => out.extend_from_slice(&data),
                ChannelMsg::ExtendedData { data, .. } => err.extend_from_slice(&data),
                ChannelMsg::ExitStatus { exit_status } => code = Some(exit_status),
                _ => {}
            }
        }
        Ok(ExecOutput {
            stdout: String::from_utf8_lossy(&out).into_owned(),
            stderr: String::from_utf8_lossy(&err).into_owned(),
            code,
        })
    }

    pub async fn exec_sudo(&self, cmd: &str) -> Result<ExecOutput> {
        let pw = self.sudo_pw.lock().unwrap().clone();
        let quoted = shell_quote(cmd);
        let out = match pw {
            Some(pw) => {
                let input = format!("{pw}\n");
                self.exec(&format!("sudo -S -p '' -- sh -c {quoted}"), Some(input.as_bytes())).await?
            }
            None => self.exec(&format!("sudo -n -- sh -c {quoted}"), None).await?,
        };
        if !out.ok() && is_sudo_auth_failure(&out.stderr) {
            *self.sudo_pw.lock().unwrap() = None;
            return Err(AppError::SudoRequired);
        }
        Ok(out)
    }

    pub fn set_sudo_password(&self, pw: String) {
        *self.sudo_pw.lock().unwrap() = Some(pw);
    }

    pub async fn close(&self) {
        self.closing.store(true, Ordering::SeqCst);
        let _ = self.handle.disconnect(russh::Disconnect::ByApplication, "", "en").await;
    }
}

fn is_sudo_auth_failure(stderr: &str) -> bool {
    ["password is required", "incorrect password", "Sorry, try again", "a terminal is required", "no password was provided"]
        .iter()
        .any(|m| stderr.contains(m))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_quote_escapes_everything() {
        assert_eq!(shell_quote("abc"), "'abc'");
        assert_eq!(shell_quote("a b"), "'a b'");
        assert_eq!(shell_quote("it's"), r"'it'\''s'");
        assert_eq!(shell_quote("$(rm -rf /)"), "'$(rm -rf /)'");
        assert_eq!(shell_quote(""), "''");
    }

    #[test]
    fn sudo_failure_detection() {
        assert!(is_sudo_auth_failure("sudo: a password is required\n"));
        assert!(is_sudo_auth_failure("Sorry, try again.\nsudo: 1 incorrect password attempt"));
        assert!(!is_sudo_auth_failure("Failed to restart foo.service: Unit foo.service not found."));
    }
}
