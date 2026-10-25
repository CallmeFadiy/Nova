import { AlertTriangle, Check, X } from "lucide-react";
import { useConfirmStore } from "../store/confirm";
import { Modal } from "./Modal";

export function ConfirmDialog() {
  const request = useConfirmStore((state) => state.request);
  const settle = useConfirmStore((state) => state.settle);

  return (
    <Modal
      open={Boolean(request)}
      onClose={() => settle(false)}
      title={request?.title ?? "Подтвердите действие"}
      size="sm"
    >
      {request ? (
        <div className="confirm-dialog">
          <div
            className={`confirm-icon${request.tone === "danger" ? " is-danger" : ""}`}
          >
            <AlertTriangle size={18} />
          </div>
          <p className="confirm-message">{request.message}</p>
          <div className="modal-actions">
            <button className="ghost-button" onClick={() => settle(false)}>
              <X size={14} />
              {request.cancelLabel ?? "Отмена"}
            </button>
            <button
              className={
                request.tone === "danger"
                  ? "danger-button"
                  : "primary-button"
              }
              onClick={() => settle(true)}
            >
              <Check size={14} />
              {request.confirmLabel ?? "Подтвердить"}
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
