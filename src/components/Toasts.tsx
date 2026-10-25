import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useUiStore } from "../store/ui";

const ICONS = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
};

export function Toasts() {
  const toasts = useUiStore((state) => state.toasts);
  const dismiss = useUiStore((state) => state.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.tone];
        return (
          <div key={toast.id} className={`toast toast-${toast.tone}`}>
            <span className="toast-icon">
              <Icon size={16} />
            </span>
            <span className="toast-message">{toast.message}</span>
            <button
              className="toast-close"
              onClick={() => dismiss(toast.id)}
              aria-label="Закрыть"
            >
              <X size={13} />
            </button>
            <span className="toast-timer" />
          </div>
        );
      })}
    </div>
  );
}
