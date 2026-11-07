import { Disc3, Download, Home, Library, Settings } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useUiStore } from "../store/ui";

const ITEMS = [
  { to: "/", label: "Главная", icon: Home, end: true },
  { to: "/library", label: "Библиотека", icon: Library },
  { to: "/albums", label: "Альбомы", icon: Disc3 },
  { to: "/downloads", label: "Загрузки", icon: Download },
  { to: "/settings", label: "Настройки", icon: Settings },
];

export function MobileNav() {
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);

  return (
    <nav className="mobile-nav" aria-label="Основная навигация">
      {ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={() => setMobileNavOpen(false)}
          className={({ isActive }) =>
            `mobile-nav-item${isActive ? " is-active" : ""}`
          }
        >
          <item.icon size={19} strokeWidth={1.7} />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
