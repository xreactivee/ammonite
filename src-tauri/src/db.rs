use std::collections::HashMap;

use chacha20poly1305::aead::{Aead, Generate, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use crate::error::{AppError, Result};
use crate::ssh::{Auth, ConnectParams};

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  username TEXT NOT NULL,
  auth_kind TEXT NOT NULL,
  secret BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS known_hosts (
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  PRIMARY KEY (host, port)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
";

const KEYRING_SERVICE: &str = "remote-vps-desktop";
const KEYRING_USER: &str = "master-key";
const NONCE_LEN: usize = 24;

pub fn open(path: &std::path::Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSummary {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_kind: String,
}

pub fn known_host(db: &Connection, host: &str, port: u16) -> Result<Option<String>> {
    Ok(db
        .query_row(
            "SELECT fingerprint FROM known_hosts WHERE host = ?1 AND port = ?2",
            params![host, port],
            |r| r.get(0),
        )
        .optional()?)
}

pub fn save_known_host(db: &Connection, host: &str, port: u16, fingerprint: &str) -> Result<()> {
    db.execute(
        "INSERT OR REPLACE INTO known_hosts (host, port, fingerprint) VALUES (?1, ?2, ?3)",
        params![host, port, fingerprint],
    )?;
    Ok(())
}

pub fn save_profile(db: &Connection, p: &ConnectParams) -> Result<()> {
    let secret = encrypt(&master_key()?, &serde_json::to_vec(&p.auth)?)?;
    db.execute(
        "INSERT OR REPLACE INTO profile (id, host, port, username, auth_kind, secret) VALUES (1, ?1, ?2, ?3, ?4, ?5)",
        params![p.host, p.port, p.username, p.auth.kind(), secret],
    )?;
    Ok(())
}

pub fn load_profile(db: &Connection) -> Result<Option<ConnectParams>> {
    let row: Option<(String, u16, String, Vec<u8>)> = db
        .query_row(
            "SELECT host, port, username, secret FROM profile WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    let Some((host, port, username, secret)) = row else {
        return Ok(None);
    };
    let auth: Auth = serde_json::from_slice(&decrypt(&master_key()?, &secret)?)?;
    Ok(Some(ConnectParams { host, port, username, auth }))
}

pub fn profile_summary(db: &Connection) -> Result<Option<ProfileSummary>> {
    Ok(db
        .query_row("SELECT host, port, username, auth_kind FROM profile WHERE id = 1", [], |r| {
            Ok(ProfileSummary { host: r.get(0)?, port: r.get(1)?, username: r.get(2)?, auth_kind: r.get(3)? })
        })
        .optional()?)
}

pub fn delete_profile(db: &Connection) -> Result<()> {
    db.execute("DELETE FROM profile", [])?;
    Ok(())
}

pub fn settings(db: &Connection) -> Result<HashMap<String, String>> {
    let mut stmt = db.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn set_setting(db: &Connection, key: &str, value: &str) -> Result<()> {
    db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)", params![key, value])?;
    Ok(())
}

fn master_key() -> Result<Vec<u8>> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)?;
    match entry.get_secret() {
        Ok(k) if k.len() == 32 => Ok(k),
        Ok(_) | Err(keyring::Error::NoEntry) => {
            let key = chacha20poly1305::Key::generate();
            entry.set_secret(&key)?;
            Ok(key.to_vec())
        }
        Err(e) => Err(e.into()),
    }
}

pub fn encrypt(key: &[u8], plain: &[u8]) -> Result<Vec<u8>> {
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|_| AppError::msg("Geçersiz anahtar"))?;
    let nonce = XNonce::generate();
    let mut out = nonce.to_vec();
    out.extend(cipher.encrypt(&nonce, plain).map_err(|_| AppError::msg("Şifreleme hatası"))?);
    Ok(out)
}

pub fn decrypt(key: &[u8], blob: &[u8]) -> Result<Vec<u8>> {
    if blob.len() < NONCE_LEN {
        return Err(AppError::msg("Kayıtlı veri bozuk"));
    }
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|_| AppError::msg("Geçersiz anahtar"))?;
    let nonce = XNonce::try_from(&blob[..NONCE_LEN]).map_err(|_| AppError::msg("Kayıtlı veri bozuk"))?;
    cipher
        .decrypt(&nonce, &blob[NONCE_LEN..])
        .map_err(|_| AppError::msg("Kayıtlı bağlantı bilgisi çözülemedi; lütfen tekrar giriş yapın"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_roundtrip_and_tamper_detection() {
        let key = [7u8; 32];
        let blob = encrypt(&key, b"{\"kind\":\"password\",\"password\":\"s3cret\"}").unwrap();
        assert_eq!(decrypt(&key, &blob).unwrap(), b"{\"kind\":\"password\",\"password\":\"s3cret\"}");
        assert_ne!(encrypt(&key, b"x").unwrap(), encrypt(&key, b"x").unwrap());
        assert!(decrypt(&[8u8; 32], &blob).is_err(), "wrong key must fail");
        let mut tampered = blob.clone();
        *tampered.last_mut().unwrap() ^= 1;
        assert!(decrypt(&key, &tampered).is_err(), "tampered data must fail");
        assert!(decrypt(&key, &blob[..10]).is_err(), "truncated data must fail");
    }

    #[test]
    fn schema_settings_and_known_hosts() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(SCHEMA).unwrap();
        db.execute_batch(SCHEMA).unwrap();
        set_setting(&db, "wallpaper", "aurora").unwrap();
        set_setting(&db, "wallpaper", "dusk").unwrap();
        assert_eq!(settings(&db).unwrap().get("wallpaper").map(String::as_str), Some("dusk"));
        assert_eq!(known_host(&db, "h", 22).unwrap(), None);
        save_known_host(&db, "h", 22, "SHA256:a").unwrap();
        save_known_host(&db, "h", 22, "SHA256:b").unwrap();
        assert_eq!(known_host(&db, "h", 22).unwrap().as_deref(), Some("SHA256:b"));
        assert_eq!(known_host(&db, "h", 2222).unwrap(), None);
        assert!(profile_summary(&db).unwrap().is_none());
    }

    #[test]
    #[ignore]
    fn keyring_is_a_real_persistent_store() {
        let entry = keyring::Entry::new(KEYRING_SERVICE, "selftest").unwrap();
        entry.set_secret(&[1, 2, 3]).unwrap();
        let again = keyring::Entry::new(KEYRING_SERVICE, "selftest").unwrap();
        assert_eq!(again.get_secret().unwrap(), vec![1, 2, 3]);
        again.delete_credential().unwrap();
        assert!(matches!(entry.get_secret(), Err(keyring::Error::NoEntry)));
    }
}
