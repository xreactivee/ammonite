use std::collections::HashMap;

use serde::Serialize;
use tauri::State;

use crate::AppState;
use crate::error::{AppError, Result};
use crate::ssh::shell_quote;

pub(crate) const STATS_CMD: &str = "cat /proc/stat; echo @@MEM; cat /proc/meminfo; echo @@LOAD; cat /proc/loadavg; \
echo @@UP; cat /proc/uptime; echo @@NET; cat /proc/net/dev; echo @@MODEL; grep -m1 'model name' /proc/cpuinfo; \
echo @@DF; df -PT -B1 -x tmpfs -x devtmpfs -x squashfs -x overlay -x efivarfs 2>/dev/null";

pub(crate) const PS_CMD: &str = "ps -eo pid=,user:32=,pcpu=,pmem=,rss=,etimes=,stat=,args= --sort=-pcpu";

pub(crate) const SVC_CMD: &str = "systemctl list-units --type=service --all --no-pager --plain --no-legend; echo @@FILES; \
systemctl list-unit-files --type=service --no-pager --plain --no-legend";

#[derive(Serialize, Default, Debug, PartialEq)]
pub struct CpuTimes {
    pub total: u64,
    pub idle: u64,
}

#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Mem {
    pub total: u64,
    pub available: u64,
    pub swap_total: u64,
    pub swap_free: u64,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct NetIf {
    pub name: String,
    pub rx: u64,
    pub tx: u64,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Disk {
    pub fs: String,
    pub kind: String,
    pub size: u64,
    pub used: u64,
    pub avail: u64,
    pub mount: String,
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub cpus: Vec<CpuTimes>,
    pub cpu_model: String,
    pub mem: Mem,
    pub load: [f64; 3],
    pub uptime: f64,
    pub net: Vec<NetIf>,
    pub disks: Vec<Disk>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Proc {
    pub pid: u32,
    pub user: String,
    pub cpu: f32,
    pub mem: f32,
    pub rss: u64,
    pub etime: u64,
    pub stat: String,
    pub name: String,
    pub command: String,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Service {
    pub unit: String,
    pub load: String,
    pub active: String,
    pub sub: String,
    pub description: String,
    pub enabled: String,
}

fn sections(text: &str) -> HashMap<&str, String> {
    let mut map = HashMap::new();
    let mut cur = "";
    let mut buf = String::new();
    for line in text.lines() {
        if let Some(name) = line.strip_prefix("@@") {
            map.insert(cur, std::mem::take(&mut buf));
            cur = name.trim();
        } else {
            buf.push_str(line);
            buf.push('\n');
        }
    }
    map.insert(cur, buf);
    map
}

pub fn parse_stats(text: &str) -> Stats {
    let s = sections(text);
    let get = |k: &str| s.get(k).map(String::as_str).unwrap_or("");
    let mut st = Stats::default();

    for line in get("").lines().filter(|l| l.starts_with("cpu")) {
        let v: Vec<u64> = line.split_whitespace().skip(1).filter_map(|x| x.parse().ok()).collect();
        if v.len() >= 4 {
            st.cpus.push(CpuTimes { total: v.iter().take(8).sum(), idle: v[3] + v.get(4).copied().unwrap_or(0) });
        }
    }

    for line in get("MEM").lines() {
        let mut it = line.split_whitespace();
        let (Some(key), Some(val)) = (it.next(), it.next().and_then(|v| v.parse::<u64>().ok())) else {
            continue;
        };
        let bytes = val * 1024;
        match key {
            "MemTotal:" => st.mem.total = bytes,
            "MemAvailable:" => st.mem.available = bytes,
            "SwapTotal:" => st.mem.swap_total = bytes,
            "SwapFree:" => st.mem.swap_free = bytes,
            _ => {}
        }
    }

    let load: Vec<f64> = get("LOAD").split_whitespace().take(3).filter_map(|x| x.parse().ok()).collect();
    if load.len() == 3 {
        st.load = [load[0], load[1], load[2]];
    }
    st.uptime = get("UP").split_whitespace().next().and_then(|x| x.parse().ok()).unwrap_or(0.0);

    for line in get("NET").lines() {
        let Some((name, rest)) = line.split_once(':') else { continue };
        let name = name.trim();
        let v: Vec<u64> = rest.split_whitespace().filter_map(|x| x.parse().ok()).collect();
        if name != "lo" && v.len() >= 9 {
            st.net.push(NetIf { name: name.to_string(), rx: v[0], tx: v[8] });
        }
    }

    st.cpu_model = get("MODEL").split_once(':').map(|(_, m)| m.trim().to_string()).unwrap_or_default();

    for line in get("DF").lines().skip(1) {
        let f: Vec<&str> = line.split_whitespace().collect();
        if f.len() < 7 {
            continue;
        }
        let num = |i: usize| f[i].parse::<u64>().unwrap_or(0);
        st.disks.push(Disk {
            fs: f[0].to_string(),
            kind: f[1].to_string(),
            size: num(2),
            used: num(3),
            avail: num(4),
            mount: f[6..].join(" "),
        });
    }
    st
}

pub fn parse_ps(text: &str) -> Vec<Proc> {
    text.lines()
        .filter_map(|line| {
            let mut it = line.split_whitespace();
            let pid = it.next()?.parse().ok()?;
            let user = it.next()?.to_string();
            let cpu = it.next()?.parse().ok()?;
            let mem = it.next()?.parse().ok()?;
            let rss = it.next()?.parse::<u64>().ok()? * 1024;
            let etime = it.next()?.parse().ok()?;
            let stat = it.next()?.to_string();
            let command = it.collect::<Vec<_>>().join(" ");
            let first = command.split_whitespace().next().unwrap_or("");
            let name = if first.starts_with('[') { first } else { first.rsplit('/').next().unwrap_or(first) };
            Some(Proc { pid, user, cpu, mem, rss, etime, stat, name: name.to_string(), command })
        })
        .collect()
}

pub fn parse_services(text: &str) -> Vec<Service> {
    let s = sections(text);
    let files: HashMap<&str, &str> = s
        .get("FILES")
        .map(|f| {
            f.lines()
                .filter_map(|l| {
                    let mut it = l.split_whitespace();
                    Some((it.next()?, it.next()?))
                })
                .collect()
        })
        .unwrap_or_default();

    let mut out: Vec<Service> = s
        .get("")
        .map(String::as_str)
        .unwrap_or("")
        .lines()
        .filter_map(|line| {
            let line = line.trim_start().trim_start_matches(['●', '*']).trim_start();
            let mut it = line.split_whitespace();
            let unit = it.next()?.to_string();
            let load = it.next()?.to_string();
            let active = it.next()?.to_string();
            let sub = it.next()?.to_string();
            let description = it.collect::<Vec<_>>().join(" ");
            let enabled = files.get(unit.as_str()).copied().unwrap_or("-").to_string();
            Some(Service { unit, load, active, sub, description, enabled })
        })
        .collect();

    let mut extra: Vec<Service> = files
        .iter()
        .filter(|(u, _)| !u.contains("@.") && !out.iter().any(|s| s.unit == **u))
        .map(|(u, st)| Service {
            unit: u.to_string(),
            load: "-".into(),
            active: "inactive".into(),
            sub: "dead".into(),
            description: String::new(),
            enabled: st.to_string(),
        })
        .collect();
    out.append(&mut extra);
    out.sort_by(|a, b| a.unit.cmp(&b.unit));
    out
}

#[tauri::command]
pub async fn sys_stats(state: State<'_, AppState>) -> Result<Stats> {
    let out = state.conn().await?.exec(STATS_CMD, None).await?;
    Ok(parse_stats(&out.stdout))
}

#[tauri::command]
pub async fn proc_list(state: State<'_, AppState>) -> Result<Vec<Proc>> {
    let out = state.conn().await?.exec(PS_CMD, None).await?.into_result()?;
    Ok(parse_ps(&out))
}

#[tauri::command]
pub async fn proc_kill(state: State<'_, AppState>, pid: u32, signal: String) -> Result<()> {
    if !["TERM", "KILL", "HUP", "INT", "STOP", "CONT"].contains(&signal.as_str()) {
        return Err(AppError::msg("Geçersiz sinyal"));
    }
    let conn = state.conn().await?;
    let cmd = format!("kill -s {signal} {pid}");
    let out = conn.exec(&cmd, None).await?;
    if out.ok() {
        return Ok(());
    }
    if out.stderr.contains("Operation not permitted") {
        conn.exec_sudo(&cmd).await?.into_result()?;
        return Ok(());
    }
    out.into_result().map(|_| ())
}

#[tauri::command]
pub async fn svc_list(state: State<'_, AppState>) -> Result<Vec<Service>> {
    let out = state.conn().await?.exec(SVC_CMD, None).await?;
    Ok(parse_services(&out.stdout))
}

#[tauri::command]
pub async fn svc_action(state: State<'_, AppState>, unit: String, action: String) -> Result<()> {
    if !["start", "stop", "restart", "reload", "enable", "disable"].contains(&action.as_str()) {
        return Err(AppError::msg("Geçersiz işlem"));
    }
    let cmd = format!("systemctl {action} -- {}", shell_quote(&unit));
    state.conn().await?.exec_sudo(&cmd).await?.into_result()?;
    Ok(())
}

#[tauri::command]
pub async fn svc_logs(state: State<'_, AppState>, unit: String, lines: u32) -> Result<String> {
    let cmd = format!("journalctl -u {} -n {} --no-pager -o short-iso", shell_quote(&unit), lines.min(5000));
    state.conn().await?.exec_sudo(&cmd).await?.into_result()
}

#[tauri::command]
pub async fn set_sudo_password(state: State<'_, AppState>, password: String) -> Result<()> {
    let conn = state.conn().await?;
    conn.set_sudo_password(password);
    conn.exec_sudo("true").await?.into_result()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const STATS: &str = "cpu  10132153 290696 3084719 46828483 16683 0 25195 0 0 0
cpu0 1393280 32966 572056 13343292 6130 0 17875 0 0 0
cpu1 1335306 31839 534521 13351036 2427 0 1916 0 0 0
intr 199292 9 0 0
ctxt 3417
@@MEM
MemTotal:       16314532 kB
MemFree:         1015580 kB
MemAvailable:    9812708 kB
SwapTotal:       2097148 kB
SwapFree:        2097148 kB
@@LOAD
0.52 0.58 0.59 1/389 12345
@@UP
350735.47 234388.90
@@NET
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 2776770   11307    0    0    0     0          0         0  2776770   11307    0    0    0     0       0          0
  eth0: 1215645    2751    0    0    0     0          0         0  1782404    4324    0    0    0   427       0          0
@@MODEL
model name\t: Intel(R) Xeon(R) CPU E5-2680 v2 @ 2.80GHz
@@DF
Filesystem     Type        1-blocks        Used   Available Capacity Mounted on
/dev/sda1      ext4     52521566208 19371945984 30447054848      39% /
/dev/sdb1      ext4      1000000000   500000000   500000000      50% /mnt/my disk
";

    #[test]
    fn stats_parse() {
        let s = parse_stats(STATS);
        assert_eq!(s.cpus.len(), 3);
        assert_eq!(
            s.cpus[0],
            CpuTimes { total: 10132153 + 290696 + 3084719 + 46828483 + 16683 + 25195, idle: 46828483 + 16683 }
        );
        assert_eq!(s.mem.total, 16314532 * 1024);
        assert_eq!(s.mem.available, 9812708 * 1024);
        assert_eq!(s.mem.swap_free, 2097148 * 1024);
        assert_eq!(s.load, [0.52, 0.58, 0.59]);
        assert_eq!(s.uptime, 350735.47);
        assert_eq!(s.net, vec![NetIf { name: "eth0".into(), rx: 1215645, tx: 1782404 }]);
        assert_eq!(s.cpu_model, "Intel(R) Xeon(R) CPU E5-2680 v2 @ 2.80GHz");
        assert_eq!(s.disks.len(), 2);
        assert_eq!(s.disks[0].mount, "/");
        assert_eq!(s.disks[0].used, 19371945984);
        assert_eq!(s.disks[1].mount, "/mnt/my disk");
    }

    #[test]
    fn stats_parse_empty_is_safe() {
        let s = parse_stats("");
        assert!(s.cpus.is_empty() && s.disks.is_empty() && s.net.is_empty());
    }

    #[test]
    fn ps_parse() {
        let text = "      1 root                              0.0  0.1 13348  3600 Ss   /sbin/init splash
   812 xreactivee                        2.5  1.2 204800 98765 Sl   /usr/bin/python3 -m http.server 8000
     2 root                              0.0  0.0     0  3601 S    [kthreadd]
garbage line
";
        let p = parse_ps(text);
        assert_eq!(p.len(), 3);
        assert_eq!(p[0].pid, 1);
        assert_eq!(p[0].name, "init");
        assert_eq!(p[0].command, "/sbin/init splash");
        assert_eq!(p[1].user, "xreactivee");
        assert_eq!(p[1].cpu, 2.5);
        assert_eq!(p[1].rss, 204800 * 1024);
        assert_eq!(p[1].etime, 98765);
        assert_eq!(p[1].name, "python3");
        assert_eq!(p[2].name, "[kthreadd]");
    }

    #[test]
    fn services_parse() {
        let text = "accounts-daemon.service    loaded    active   running Accounts Service
● apparmor.service          not-found inactive dead    apparmor.service
ssh.service                loaded    active   running OpenBSD Secure Shell server
@@FILES
accounts-daemon.service    enabled   enabled
ssh.service                enabled   enabled
nginx.service              disabled  enabled
getty@.service             enabled   enabled
";
        let s = parse_services(text);
        let units: Vec<&str> = s.iter().map(|x| x.unit.as_str()).collect();
        assert_eq!(units, ["accounts-daemon.service", "apparmor.service", "nginx.service", "ssh.service"]);
        assert_eq!(s[0].description, "Accounts Service");
        assert_eq!(s[0].enabled, "enabled");
        assert_eq!(s[1].load, "not-found");
        assert_eq!(s[1].enabled, "-");
        assert_eq!(s[2].active, "inactive");
        assert_eq!(s[2].enabled, "disabled");
        assert_eq!(s[3].sub, "running");
    }
}
