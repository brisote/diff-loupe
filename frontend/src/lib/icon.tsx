export function Icon({ name }: { name: string }) {
  return <span className={`dl-i dl-i-${name}`} aria-hidden="true" />;
}
