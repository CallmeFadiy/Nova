import { X } from "lucide-react";
import { useUiStore } from "../store/ui";

export function Toasts() {
  const toasts = useUiStore((state) => state.toasts);
  const dismiss = useUiStore((state) => state.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.tone}`}>
          <span>{toast.message}</span>
          <button
            className="toast-close"
            onClick={() => dismiss(toast.id)}
            aria-label="Закрыть"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
