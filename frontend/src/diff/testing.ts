export function compareRanges(
  text: string,
  marks: { from: number; to: number; className: string }[],
) {
  return marks.map((mark) => [text.slice(mark.from, mark.to), mark.className]);
}
