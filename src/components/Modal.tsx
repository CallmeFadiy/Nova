import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  size = "md",
  className,
}: ModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;

    // Android runs edge-to-edge: the layout viewport does not shrink when the
    // IME opens, only visualViewport.height does. A 92dvh sheet would keep its
    // last fields and submit button under the keyboard, so cap the sheet to
    // the part of the screen the keyboard leaves visible and let it scroll.
    const sync = () => {
      const modal = modalRef.current;
      if (!modal) return;
      const available = viewport?.height ?? window.innerHeight;
      const topSheet =
        backdropRef.current !== null &&
        getComputedStyle(backdropRef.current).alignItems === "start";
      // Read the sheet's CSS limit (86vh on desktop, 92dvh on phones) before
      // applying the inline cap, so desktop sizing stays exactly as designed.
      modal.style.maxHeight = "";
      const cssLimit = parseFloat(getComputedStyle(modal).maxHeight);
      const top = modal.getBoundingClientRect().top;
      const limit = topSheet
        ? Math.min(Number.isFinite(cssLimit) ? cssLimit : available, available - top - 8)
        : Number.isFinite(cssLimit)
          ? cssLimit
          : available;
      modal.style.maxHeight = `${Math.max(180, Math.round(limit))}px`;
    };

    sync();
    const frame = requestAnimationFrame(sync);
    viewport?.addEventListener("resize", sync);
    viewport?.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", sync);
      viewport?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      if (modalRef.current) modalRef.current.style.maxHeight = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="modal-backdrop" ref={backdropRef} onMouseDown={onClose}>
      <div
        className={`modal modal-${size}${className ? ` ${className}` : ""}`}
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            {title ? <h2 className="serif">{title}</h2> : null}
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            <X size={17} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
