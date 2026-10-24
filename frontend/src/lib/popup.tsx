import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

type PopupProps = {
  label: string;
  role: "dialog" | "menu";
  className?: string;
  anchor?: RefObject<HTMLElement | null>;
  style?: CSSProperties;
  onClose: () => void;
  children: ReactNode;
};

export function useBelow(anchor: RefObject<HTMLElement | null>): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    const rect = anchor.current?.getBoundingClientRect();
    if (rect) setStyle({ top: rect.bottom + 4, left: rect.left });
  }, [anchor]);
  return style;
}

export function Popup({ label, role, className, anchor, style, onClose, children }: PopupProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || anchor?.current?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const timer = window.setTimeout(() => document.addEventListener("pointerdown", onPointer));
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);
  const classes = `dl-popup ${className ?? ""}`;
  if (role === "menu") {
    return (
      <div
        ref={ref}
        className={classes}
        role="menu"
        aria-label={label}
        style={style}
        data-tauri-drag-region="false"
      >
        {children}
      </div>
    );
  }
  return (
    <div
      ref={ref}
      className={classes}
      role="dialog"
      aria-label={label}
      style={style}
      data-tauri-drag-region="false"
    >
      {children}
    </div>
  );
}
