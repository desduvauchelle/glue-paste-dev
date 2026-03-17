import { useToasts, removeToast, type Toast } from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from "lucide-react";

const icons: Record<Toast["level"], typeof CheckCircle> = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const colors: Record<Toast["level"], string> = {
  success: "border-green-500/50 bg-green-950/80",
  error: "border-red-500/50 bg-red-950/80",
  warning: "border-amber-500/50 bg-amber-950/80",
  info: "border-blue-500/50 bg-blue-950/80",
};

const iconColors: Record<Toast["level"], string> = {
  success: "text-green-400",
  error: "text-red-400",
  warning: "text-amber-400",
  info: "text-blue-400",
};

export function ToastContainer() {
  const toasts = useToasts();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => {
        const Icon = icons[toast.level];
        return (
          <div
            key={toast.id}
            className={cn(
              "flex items-start gap-3 rounded-lg border p-3 shadow-lg backdrop-blur-sm animate-in slide-in-from-right-full",
              colors[toast.level],
            )}
          >
            <Icon className={cn("w-5 h-5 mt-0.5 shrink-0", iconColors[toast.level])} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{toast.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{toast.message}</p>
            </div>
            <button
              type="button"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => removeToast(toast.id)}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
