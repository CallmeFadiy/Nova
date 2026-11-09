import { ArrowLeft, Menu } from "lucide-react";
import { useUiStore } from "../store/ui";

/**
 * Mobile-only menu trigger. It shows a burger while the drawer is closed and a
 * back arrow while it is open, so the same control can sit in a page header or
 * float over the open drawer.
 */
export function MobileMenuButton({ className = "" }: { className?: string }) {
  const open = useUiStore((state) => state.mobileNavOpen);
  const setOpen = useUiStore((state) => state.setMobileNavOpen);

  return (
    <button
      className={`mobile-menu${className ? ` ${className}` : ""}`}
      onClick={() => setOpen(!open)}
      aria-label={open ? "Назад" : "Меню"}
    >
      {open ? <ArrowLeft size={18} /> : <Menu size={18} />}
    </button>
  );
}
