import { type KeyboardEvent, type PointerEvent, useRef } from "react";

type SplitterProps = {
  width: number;
  min: number;
  max: number;
  vertical?: boolean;
  label?: string;
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
};

export function clampWidth(width: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(width, min), Math.max(min, max)));
}

export function Splitter({
  width,
  min,
  max,
  vertical,
  label = "Resize the tool window",
  onResize,
  onResizeEnd,
}: SplitterProps) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const last = useRef(width);
  const position = (event: PointerEvent<HTMLHRElement>) =>
    vertical ? -event.clientY : event.clientX;

  const onPointerDown = (event: PointerEvent<HTMLHRElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: position(event), width };
    last.current = width;
  };
  const onPointerMove = (event: PointerEvent<HTMLHRElement>) => {
    if (!drag.current) return;
    last.current = clampWidth(drag.current.width + position(event) - drag.current.x, min, max);
    onResize(last.current);
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    onResizeEnd(last.current);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLHRElement>) => {
    const [less, more] = vertical ? ["ArrowDown", "ArrowUp"] : ["ArrowLeft", "ArrowRight"];
    const step = event.key === less ? -16 : event.key === more ? 16 : 0;
    if (!step) return;
    event.preventDefault();
    const next = clampWidth(width + step, min, max);
    onResize(next);
    onResizeEnd(next);
  };

  return (
    <hr
      className={vertical ? "dl-splitter app-hsplit" : "app-vsplit"}
      aria-orientation={vertical ? "horizontal" : "vertical"}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
    />
  );
}
