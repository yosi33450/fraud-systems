"use client";

import { useEffect, useRef, type ReactNode } from "react";

let openDialogs = 0;
let previousOverflow = "";

/** Native top-layer dialogs trap focus and make underlying dialogs/pages inert. */
export function CenteredDialog({ label, onClose, children, className = "" }: {
  label: string; onClose: () => void; children: ReactNode; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (openDialogs++ === 0) { previousOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
    dialog.showModal();
    return () => {
      dialog.close();
      if (--openDialogs === 0) document.body.style.overflow = previousOverflow;
      if (focused?.isConnected) focused.focus();
    };
  }, []);
  return <dialog ref={ref} className={`centered-dialog ${className}`} aria-label={label} dir="rtl"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>{children}</dialog>;
}
