import { ScanLine } from "lucide-react";
import { useLibraryStore } from "../store/library";

export function ScanButton({ className = "" }: { className?: string }) {
  const scanning = useLibraryStore((state) => state.scanning);
  const scanProgress = useLibraryStore((state) => state.scanProgress);
  const scan = useLibraryStore((state) => state.scan);

  const label = scanning
    ? scanProgress
      ? `Сканирование ${scanProgress.current}/${scanProgress.total}`
      : "Сканирование…"
    : "Сканировать";

  return (
    <button
      className={`secondary-button scan-button${className ? ` ${className}` : ""}`}
      onClick={() => void scan()}
      disabled={scanning}
      title="Сканировать папки"
    >
      <ScanLine size={15} className={scanning ? "spin" : ""} />
      {label}
    </button>
  );
}
