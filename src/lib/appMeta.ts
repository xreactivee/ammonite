import {
  Activity,
  Cable,
  Cpu,
  FileCode,
  FolderOpen,
  Image,
  ServerCog,
  Settings,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";

export type AppId =
  | "files"
  | "terminal"
  | "editor"
  | "viewer"
  | "monitor"
  | "processes"
  | "services"
  | "tunnels"
  | "settings";

export type AppMeta = {
  title: string;
  icon: LucideIcon;
  size: [number, number];
  single?: boolean;
  dock?: boolean;
};

export const APPS: Record<AppId, AppMeta> = {
  files: { title: "Dosyalar", icon: FolderOpen, size: [920, 580], dock: true },
  terminal: { title: "Terminal", icon: SquareTerminal, size: [860, 520], dock: true },
  editor: { title: "Editör", icon: FileCode, size: [900, 620], dock: true },
  monitor: { title: "Sistem İzleyici", icon: Activity, size: [880, 640], single: true, dock: true },
  processes: { title: "Süreçler", icon: Cpu, size: [900, 600], single: true, dock: true },
  services: { title: "Servisler", icon: ServerCog, size: [960, 620], single: true, dock: true },
  tunnels: { title: "Tüneller", icon: Cable, size: [640, 480], single: true, dock: true },
  settings: { title: "Ayarlar", icon: Settings, size: [720, 560], single: true, dock: true },
  viewer: { title: "Görüntüleyici", icon: Image, size: [820, 600] },
};
