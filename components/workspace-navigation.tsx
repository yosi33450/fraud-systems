"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";

const sidebarPreferenceKey = "shield-ledger:sidebar-collapsed";

/** Presentation preferences only; no tenant records or account settings are changed. */
export function useWorkspaceNavigation(mobileOpen: boolean, setMobileOpen: Dispatch<SetStateAction<boolean>>) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(sidebarPreferenceKey) === "true"); } catch { /* Storage may be disabled. */ }
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(sidebarPreferenceKey, String(next)); } catch { /* Keep the session preference. */ }
  };

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

  return { collapsed, toggleCollapsed };
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
