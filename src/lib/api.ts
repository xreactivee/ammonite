import { Channel, invoke } from "@tauri-apps/api/core";

export type AppError = { kind: string; message: string; fingerprint?: string | null };

export const errMsg = (e: unknown): string =>
  typeof e === "object" && e && "message" in e ? String((e as AppError).message) : String(e);

export const isErr = (e: unknown, kind: string): e is AppError =>
  typeof e === "object" && e !== null && (e as AppError).kind === kind;

export type Auth =
  | { kind: "password"; password: string }
  | { kind: "key"; key: string; passphrase?: string | null };

export type ConnectParams = { host: string; port: number; username: string; auth: Auth };

export type SessionInfo = {
  host: string;
  port: number;
  username: string;
  home: string;
  fingerprint: string;
  hostname: string;
  kernel: string;
  os: string;
};

export type ProfileSummary = { host: string; port: number; username: string; authKind: "password" | "key" };

export type Entry = {
  name: string;
  path: string;
  isDir: boolean;
  isLink: boolean;
  size: number;
  mtime: number;
  mode: number;
  uid: number;
  gid: number;
};

export type Progress = { name: string; done: number; total: number };

export type Stats = {
  cpus: { total: number; idle: number }[];
  cpuModel: string;
  mem: { total: number; available: number; swapTotal: number; swapFree: number };
  load: [number, number, number];
  uptime: number;
  net: { name: string; rx: number; tx: number }[];
  disks: { fs: string; kind: string; size: number; used: number; avail: number; mount: string }[];
};

export type Proc = {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  rss: number;
  etime: number;
  stat: string;
  name: string;
  command: string;
};

export type Service = {
  unit: string;
  load: string;
  active: string;
  sub: string;
  description: string;
  enabled: string;
};

export type TunnelInfo = { id: number; localPort: number; remoteHost: string; remotePort: number };

function channel<T>(fn: (m: T) => void) {
  const ch = new Channel<T>();
  ch.onmessage = fn;
  return ch;
}

export const api = {
  connect: (params: ConnectParams, remember: boolean, trust?: string) =>
    invoke<SessionInfo>("connect", { params, remember, trust: trust ?? null }),
  autoConnect: () => invoke<SessionInfo | null>("auto_connect"),
  reconnect: () => invoke<SessionInfo>("reconnect"),
  disconnect: () => invoke<void>("disconnect"),
  savedProfile: () => invoke<ProfileSummary | null>("saved_profile"),
  forgetProfile: () => invoke<void>("forget_profile"),
  getSettings: () => invoke<Record<string, string>>("get_settings"),
  setSetting: (key: string, value: string) => invoke<void>("set_setting", { key, value }),
  readLocalImage: (path: string) => invoke<string>("read_local_image", { path }),

  listDir: (path: string, showHidden: boolean) => invoke<Entry[]>("list_dir", { path, showHidden }),
  mkdir: (path: string) => invoke<void>("mkdir", { path }),
  createFile: (path: string) => invoke<void>("create_file", { path }),
  rename: (from: string, to: string) => invoke<void>("rename", { from, to }),
  copyPaths: (paths: string[], destDir: string) => invoke<void>("copy_paths", { paths, destDir }),
  movePaths: (paths: string[], destDir: string) => invoke<void>("move_paths", { paths, destDir }),
  remove: (paths: string[]) => invoke<void>("remove", { paths }),
  chmod: (path: string, mode: number) => invoke<void>("chmod", { path, mode }),
  readText: (path: string) => invoke<string>("read_text", { path }),
  writeText: (path: string, content: string) => invoke<void>("write_text", { path, content }),
  readTextSudo: (path: string) => invoke<string>("read_text_sudo", { path }),
  writeTextSudo: (path: string, content: string) => invoke<void>("write_text_sudo", { path, content }),
  readBytes: (path: string) => invoke<ArrayBuffer>("read_bytes", { path }),
  upload: (localPaths: string[], remoteDir: string, onProgress: (p: Progress) => void) =>
    invoke<void>("upload", { localPaths, remoteDir, onProgress: channel(onProgress) }),
  download: (remotePath: string, localPath: string, onProgress: (p: Progress) => void) =>
    invoke<void>("download", { remotePath, localPath, onProgress: channel(onProgress) }),

  termOpen: (cols: number, rows: number, cwd: string | undefined, onData: (b: ArrayBuffer) => void) =>
    invoke<number>("term_open", { cols, rows, cwd: cwd ?? null, onData: channel(onData) }),
  termWrite: (id: number, data: string) => invoke<void>("term_write", { id, data }),
  termResize: (id: number, cols: number, rows: number) => invoke<void>("term_resize", { id, cols, rows }),
  termClose: (id: number) => invoke<void>("term_close", { id }),

  sysStats: () => invoke<Stats>("sys_stats"),
  procList: () => invoke<Proc[]>("proc_list"),
  procKill: (pid: number, signal: string) => invoke<void>("proc_kill", { pid, signal }),
  svcList: () => invoke<Service[]>("svc_list"),
  svcAction: (unit: string, action: string) => invoke<void>("svc_action", { unit, action }),
  svcLogs: (unit: string, lines: number) => invoke<string>("svc_logs", { unit, lines }),
  setSudoPassword: (password: string) => invoke<void>("set_sudo_password", { password }),

  tunnelOpen: (localPort: number, remoteHost: string, remotePort: number) =>
    invoke<TunnelInfo>("tunnel_open", { localPort, remoteHost, remotePort }),
  tunnelClose: (id: number) => invoke<void>("tunnel_close", { id }),
  tunnelList: () => invoke<TunnelInfo[]>("tunnel_list"),
};
