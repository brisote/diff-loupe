export const copied = "diffloupe:copied";

export function starPanels() {
  const show = () => {
    for (const panel of document.querySelectorAll<HTMLElement>("[data-star-panel]"))
      panel.dataset.shown = "";
  };
  document.addEventListener(copied, show);
  for (const link of document.querySelectorAll("[data-download]"))
    link.addEventListener("click", show);
}
