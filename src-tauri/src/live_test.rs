
use russh::ChannelMsg;

use crate::error::AppError;
use crate::ssh::{self, Auth, ConnectParams};
use crate::system;

fn env(k: &str) -> String {
    std::env::var(k).unwrap_or_else(|_| panic!("{k} is not set"))
}

#[tokio::test]
#[ignore]
async fn live_server_roundtrip() {
    let params = ConnectParams {
        host: env("VPS_HOST"),
        port: std::env::var("VPS_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(22),
        username: env("VPS_USER"),
        auth: Auth::Password { password: env("VPS_PASS") },
    };

    let fp = match ssh::open(params.clone(), None, None).await {
        Err(AppError::UnknownHostKey { fingerprint }) => fingerprint,
        Err(e) => panic!("expected UnknownHostKey, got: {e}"),
        Ok(_) => panic!("unknown host key was accepted"),
    };
    assert!(fp.starts_with("SHA256:"), "{fp}");
    match ssh::open(params.clone(), Some("SHA256:wrong".into()), None).await {
        Err(AppError::HostKeyMismatch { .. }) => {}
        Err(e) => panic!("expected HostKeyMismatch, got: {e}"),
        Ok(_) => panic!("mismatching host key was accepted"),
    }

    let conn = ssh::open(params, Some(fp), None).await.expect("connect with known key");
    println!("connected: {} / {} / home {}", conn.info.os, conn.info.kernel, conn.info.home);
    assert!(conn.info.home.starts_with('/'));

    let out = conn.exec("echo hi", None).await.unwrap();
    assert_eq!(out.stdout.trim(), "hi");
    assert_eq!(out.code, Some(0));

    let names: Vec<String> = conn.sftp.read_dir(conn.info.home.clone()).await.unwrap().map(|e| e.file_name()).collect();
    println!("home entries: {}", names.len());

    let stats = system::parse_stats(&conn.exec(system::STATS_CMD, None).await.unwrap().stdout);
    assert!(stats.cpus.len() >= 2, "cpu lines parsed");
    assert!(stats.mem.total > 0);
    assert!(!stats.disks.is_empty());
    let procs = system::parse_ps(&conn.exec(system::PS_CMD, None).await.unwrap().stdout);
    assert!(procs.iter().any(|p| p.pid == 1));
    let services = system::parse_services(&conn.exec(system::SVC_CMD, None).await.unwrap().stdout);
    assert!(services.iter().any(|s| s.unit.starts_with("ssh")), "ssh service listed");

    let mut ch = conn.handle.channel_open_session().await.unwrap();
    ch.request_pty(true, "xterm-256color", 80, 24, 0, 0, &[]).await.unwrap();
    ch.request_shell(true).await.unwrap();
    ch.data(&b"echo pty-$((40+2))\n"[..]).await.unwrap();
    let mut seen = String::new();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
    while !seen.contains("pty-42") {
        let msg = tokio::time::timeout_at(deadline, ch.wait()).await.expect("pty output in time");
        if let Some(ChannelMsg::Data { data }) = msg {
            seen.push_str(&String::from_utf8_lossy(&data));
        }
    }
    conn.close().await;
}
