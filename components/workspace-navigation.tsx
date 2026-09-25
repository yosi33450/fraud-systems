"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, Search, X, type LucideIcon } from "lucide-react";
import { CenteredDialog } from "@/components/centered-dialog";

const sidebarPreferenceKey = "shield-ledger:sidebar-collapsed";

/** Presentation preferences only; no tenant records or account settings are changed. */
export function useWorkspaceNavigation(mobileOpen: boolean, setMobileOpen: Dispatch<SetStateAction<boolean>>) {
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(sidebarPreferenceKey) === "true"); } catch { /* Storage may be disabled. */ }
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(sidebarPreferenceKey, String(next)); } catch { /* Keep the session preference. */ }
  };

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !document.querySelector("dialog[open]")) {
        event.preventDefault();
        setMobileOpen(false);
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, [setMobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const sidebar = document.getElementById("primary-navigation");
    const main = document.getElementById("main-content");
    const trigger = document.getElementById("mobile-navigation-trigger");
    const previousOverflow = document.body.style.overflow;
    const previouslyInert = main?.inert ?? false;
    if (main) main.inert = true;
    document.body.style.overflow = "hidden";
    const focusMenu = () => sidebar?.querySelector<HTMLButtonElement>(".mobile-only")?.focus();
    // Wait for the visibility transition to start before moving keyboard focus.
    const focusFrame = window.requestAnimationFrame(focusMenu);
    const focusAfterReveal = window.setTimeout(() => {
      if (!sidebar?.contains(document.activeElement)) focusMenu();
    }, 260);
    const desktop = window.matchMedia("(min-width: 821px)");
    const closeOnDesktop = () => { if (desktop.matches) setMobileOpen(false); };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setMobileOpen(false); return; }
      if (event.key !== "Tab" || !sidebar) return;
      const items = [...sidebar.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], [tabindex='0']")].filter((item) => item.getClientRects().length > 0);
      const first = items[0];
      const last = items.at(-1);
      if (!sidebar.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    desktop.addEventListener("change", closeOnDesktop);
    document.addEventListener("keydown", keyboard);
    closeOnDesktop();
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.clearTimeout(focusAfterReveal);
      desktop.removeEventListener("change", closeOnDesktop);
      document.removeEventListener("keydown", keyboard);
      if (main) main.inert = previouslyInert;
      document.body.style.overflow = previousOverflow;
      if (!desktop.matches) trigger?.focus();
    };
  }, [mobileOpen, setMobileOpen]);

  return { collapsed, toggleCollapsed, searchOpen, setSearchOpen };
}

export function SidebarItem({ label, Icon, active, count, collapsed, onClick }: {
  label: string; Icon: LucideIcon; active?: boolean; count?: number; collapsed: boolean; onClick: () => void;
}) {
  const [tooltip, setTooltip] = useState<{ top: number; right: number } | null>(null);
  const reveal = (target: HTMLButtonElement) => {
    if (!collapsed || !window.matchMedia("(min-width: 821px)").matches) return;
    const rect = target.getBoundingClientRect();
    setTooltip({ top: rect.top + rect.height / 2, right: window.innerWidth - rect.left + 10 });
  };
  useEffect(() => {
    if (!tooltip) return;
    const dismiss = () => setTooltip(null);
    const dismissOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("keydown", dismissOnEscape);
    return () => { window.removeEventListener("resize", dismiss); window.removeEventListener("scroll", dismiss, true); window.removeEventListener("keydown", dismissOnEscape); };
  }, [tooltip]);
  return <>
    <button className={`sidebar-item ${active ? "nav-active" : ""}`} aria-current={active ? "page" : undefined}
      aria-label={count ? `${label} ${count}` : label}
      onMouseEnter={(event) => reveal(event.currentTarget)} onMouseLeave={() => setTooltip(null)}
      onFocus={(event) => reveal(event.currentTarget)} onBlur={() => setTooltip(null)}
      onClick={() => { setTooltip(null); onClick(); }}>
      <Icon size={19} strokeWidth={1.8} aria-hidden="true" /><span className="nav-label">{label}</span>
      {count ? <small className="nav-count" aria-hidden="true">{count}</small> : null}
    </button>
    {tooltip && collapsed ? createPortal(<span className="sidebar-tooltip" style={tooltip} aria-hidden="true">{label}{count ? ` · ${count}` : ""}</span>, document.body) : null}
  </>;
}

export type WorkspaceDestination = { id: string; label: string; Icon: LucideIcon };

export function WorkspaceQuickNavigation({ destinations, current, onNavigate, onClose }: {
  destinations: WorkspaceDestination[]; current: string; onNavigate: (id: string) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const matches = destinations.filter((item) => item.label.includes(query.trim()));
  const select = (id: string) => { onNavigate(id); onClose(); };
  return <CenteredDialog label="מעבר מהיר בין מסכים" className="workspace-search-dialog" onClose={onClose}>
    <header className="workspace-search-header"><Search size={21} aria-hidden="true" /><input autoFocus aria-label="חיפוש מסך במערכת" placeholder="לאן לעבור?" value={query} onChange={(event) => setQuery(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && matches.length) { event.preventDefault(); select(matches[0].id); }
        if (event.key === "ArrowDown") { event.preventDefault(); event.currentTarget.closest("dialog")?.querySelector<HTMLButtonElement>(".workspace-search-result")?.focus(); }
      }} /><button className="icon-button" onClick={onClose} aria-label="סגירת חיפוש"><X size={18} /></button></header>
    <div className="workspace-search-results" onKeyDown={(event) => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(".workspace-search-result")];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }}>
      <p>מסכי המערכת</p>
      {matches.map(({ id, label, Icon }) => <button className="workspace-search-result" key={id} onClick={() => select(id)}><Icon size={19} aria-hidden="true" /><span>{label}</span>{id === current ? <small>המסך הנוכחי</small> : null}<ChevronLeft size={16} aria-hidden="true" /></button>)}
      {!matches.length ? <div className="workspace-search-empty">לא נמצא מסך בשם הזה. נסה למשל ״גיפט״ או ״חוק״.</div> : null}
    </div>
    <footer className="workspace-search-footer">חצים למעבר · Enter לפתיחה · Esc לסגירה</footer>
  </CenteredDialog>;
}
