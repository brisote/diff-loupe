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

export function useBelow(anchor: RefObject<HTMLElement | null>, width?: number): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ position: "fixed", zIndex: 20 });

  useLayoutEffect(() => {
    const update = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) {
        setStyle({ position: "fixed", zIndex: 20 });
        return;
      }
      let left = rect.left;
      if (width && typeof window !== "undefined" && left + width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - width - 8);
      }
      setStyle({
        position: "fixed",
        top: rect.bottom + 4,
        left,
        zIndex: 20,
      });
    };

    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [anchor, width]);

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
