import {
  Disc3,
  Download,
  Folder,
  Heart,
  Home,
  Library,
  Link2,
  ListMusic,
  Mic,
  Settings,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { formatBytes, trackCountLabel } from "../lib/format";
import { favoriteTracks, useLibraryStore, visibleTracks } from "../store/library";
import { useUiStore } from "../store/ui";

const NAV_MAIN = [
  { to: "/", label: "Главная", icon: Home, end: true },
  { to: "/library", label: "Библиотека", icon: Library },
  { to: "/albums", label: "Альбомы", icon: Disc3 },
  { to: "/folders", label: "Папки", icon: Folder },
];

const NAV_COLLECTIONS = [
  { to: "/favorites", label: "Избранное", icon: Heart, count: "favorites" },
  { to: "/playlists", label: "Плейлисты", icon: ListMusic, count: "playlists" },
];

const NAV_TOOLS = [
  { to: "/downloads", label: "Загрузки", icon: Download },
  { to: "/import", label: "Импорт ссылки", icon: Link2 },
  { to: "/shazam", label: "Распознать трек", icon: Mic },
];

export function Sidebar() {
  const tracks = useLibraryStore((state) => state.tracks);
  const playlists = useLibraryStore((state) => state.playlists);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);

  const visible = visibleTracks(tracks);
  const favorites = favoriteTracks(tracks);
  const totalSize = visible.reduce((sum, track) => sum + track.size, 0);
  const counts: Record<string, number> = {
    favorites: favorites.length,
    playlists: playlists.length,
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-text">
          <span className="brand-name serif">Nova</span>
          <span className="brand-sub">локальная музыка</span>
        </div>
      </div>

      <nav className="nav">
        <div className="nav-group">
          <span className="nav-label">Библиотека</span>
          {NAV_MAIN.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `nav-item${isActive ? " active" : ""}`
              }
              onClick={() => setMobileNavOpen(false)}
            >
              <item.icon size={16} strokeWidth={1.6} />
              <span>{item.label}</span>
              {item.to === "/library" ? (
                <span className="nav-count">{visible.length}</span>
              ) : null}
            </NavLink>
          ))}
        </div>

        <div className="nav-group">
          <span className="nav-label">Коллекции</span>
          {NAV_COLLECTIONS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `nav-item${isActive ? " active" : ""}`
              }
              onClick={() => setMobileNavOpen(false)}
            >
              <item.icon size={16} strokeWidth={1.6} />
              <span>{item.label}</span>
              <span className="nav-count">{counts[item.count] ?? 0}</span>
            </NavLink>
          ))}
        </div>

        <div className="nav-group">
          <span className="nav-label">Ещё</span>
          {NAV_TOOLS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `nav-item${isActive ? " active" : ""}`
              }
              onClick={() => setMobileNavOpen(false)}
            >
              <item.icon size={16} strokeWidth={1.6} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      <div className="sidebar-foot">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `nav-item settings-link${isActive ? " active" : ""}`
          }
          onClick={() => setMobileNavOpen(false)}
        >
          <Settings size={16} strokeWidth={1.6} />
          <span>Настройки</span>
        </NavLink>

        <div className="storage">
          <div className="storage-line">
            <span>{trackCountLabel(visible.length)}</span>
            <span>{formatBytes(totalSize)}</span>
          </div>
          <div className="storage-bar">
            <span style={{ width: `${Math.min(100, (totalSize / 120e9) * 100)}%` }} />
          </div>
        </div>
      </div>
    </aside>
  );
}
