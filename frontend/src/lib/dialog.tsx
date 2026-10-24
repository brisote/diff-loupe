import { type ReactNode, useEffect, useRef } from "react";

type DialogProps = {
  label: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
};

export function Dialog({ label, className, onClose, children }: DialogProps) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.shiftKey) return;
      if (box.current?.querySelector(".dl-popup")) return;
      const modals = document.querySelectorAll(".app-modal");
      if (modals[modals.length - 1] !== box.current?.parentElement) return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  useEffect(() => {
    const element = box.current;
    if (element && !element.contains(document.activeElement)) element.focus();
  }, []);
  return (
    <div className="app-modal">
      <div
        ref={box}
        className={`dl-dialog ${className ?? ""}`}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label={label}
      >
        {children}
      </div>
    </div>
  );
}
