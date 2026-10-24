import type { Layout } from "./geometry";
import { lineHeight } from "./geometry";

type Props = {
  map: Layout;
  label: (line: number) => string;
  lineClass: (line: number) => string;
  top: number;
  height: number;
  className: string;
};

export function LineNumbers({ map, label, lineClass, top, height, className }: Props) {
  const first = Math.max(0, Math.floor(top / lineHeight) - 2);
  const last = Math.min(map.rows, Math.ceil((top + height) / lineHeight) + 2);
  const rows = [];
  for (let row = first; row < last; row += 1) {
    const line = map.lineOfRow[row] ?? 0;
    const style = { transform: `translateY(${row * lineHeight - top}px)` };
    rows.push(
      line < 0 ? (
        <span key={`fold-${row}`} className="app-ln dl-fold" style={style} />
      ) : (
        <span key={line} className={`app-ln${lineClass(line)}`} style={style}>
          {label(line)}
        </span>
      ),
    );
  }
  return (
    <div className={`app-numbers ${className}`} aria-hidden="true">
      {rows}
    </div>
  );
}
