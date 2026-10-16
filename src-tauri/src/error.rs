use serde::ser::{Serialize, SerializeStruct, Serializer};

pub type Result<T> = std::result::Result<T, AppError>;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Message(String),
    #[error("Sunucuya bağlı değil")]
    NotConnected,
    #[error("Kimlik doğrulama başarısız: kullanıcı adı, şifre veya anahtar hatalı")]
    Auth,
    #[error("Sunucu ilk kez görülüyor. Anahtar parmak izi: {fingerprint}")]
    UnknownHostKey { fingerprint: String },
    #[error(
        "UYARI: Sunucu anahtarı değişmiş! Beklenen {expected}, gelen {actual}. Ortadaki adam saldırısı olabilir, bağlantı reddedildi."
    )]
    HostKeyMismatch { expected: String, actual: String },
    #[error("Bu işlem için sudo şifresi gerekiyor")]
    SudoRequired,
    #[error("Dosya metin değil (ikili veya UTF-8 olmayan içerik)")]
    Binary,
    #[error("Dosya çok büyük ({0} bayt)")]
    TooLarge(u64),
}

impl AppError {
    pub fn msg(m: impl Into<String>) -> Self {
        AppError::Message(m.into())
    }

    fn kind(&self) -> &'static str {
        match self {
            AppError::Message(_) => "Message",
            AppError::NotConnected => "NotConnected",
            AppError::Auth => "Auth",
            AppError::UnknownHostKey { .. } => "UnknownHostKey",
            AppError::HostKeyMismatch { .. } => "HostKeyMismatch",
            AppError::SudoRequired => "SudoRequired",
            AppError::Binary => "Binary",
            AppError::TooLarge(_) => "TooLarge",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        let fingerprint = match self {
            AppError::UnknownHostKey { fingerprint } => Some(fingerprint),
            AppError::HostKeyMismatch { actual, .. } => Some(actual),
            _ => None,
        };
        let mut st = s.serialize_struct("AppError", 3)?;
        st.serialize_field("kind", self.kind())?;
        st.serialize_field("message", &self.to_string())?;
        st.serialize_field("fingerprint", &fingerprint)?;
        st.end()
    }
}

macro_rules! from_err {
    ($($t:ty),* $(,)?) => {
        $(impl From<$t> for AppError {
            fn from(e: $t) -> Self {
                AppError::Message(e.to_string())
            }
        })*
    };
}

from_err!(
    russh::Error,
    russh::keys::Error,
    russh_sftp::client::error::Error,
    rusqlite::Error,
    std::io::Error,
    keyring::Error,
    tauri::Error,
    serde_json::Error,
);
