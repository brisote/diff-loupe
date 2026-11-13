import type { CSSProperties } from "react";

export function Icon({
  name,
  className,
  style,
}: {
  name: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`dl-i dl-i-${name}${className ? ` ${className}` : ""}`}
      style={style}
      aria-hidden="true"
    />
  );
}
