import { CircleCheck, CircleX, Info, X } from "lucide-react";
import { dismissToast, useStore } from "../lib/store";

const ICONS = { info: Info, success: CircleCheck, error: CircleX };
const COLORS = { info: "text-ink-100", success: "text-[#86efac]", error: "text-danger" };

export default function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed right-4 bottom-[108px] z-[9900] flex w-[360px] flex-col gap-2">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div key={t.id} className="panel pointer-events-auto overflow-hidden rounded-lg animate-rise">
            <div className="flex items-start gap-2.5 p-3 text-[13px]">
              <Icon className={`mt-0.5 size-4 shrink-0 ${COLORS[t.kind]}`} />
              <span className="min-w-0 flex-1 break-words">{t.text}</span>
              {t.action && (
                <button
                  className="shrink-0 text-xs font-medium text-accent hover:underline"
                  onClick={() => {
                    t.action!.onClick();
                    dismissToast(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
              <button className="shrink-0 text-ink-400 hover:text-ink-100" onClick={() => dismissToast(t.id)}>
                <X className="size-3.5" />
              </button>
            </div>
            {t.progress !== undefined && (
              <div className="h-0.5 bg-ink-800">
                {t.progress === null ? (
                  <div className="h-full w-1/3 animate-pulse bg-accent/70" />
                ) : (
                  <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(t.progress * 100)}%` }} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
