import { copied } from "./star";

export function copyButtons() {
  for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-copy]")) {
    const label = button.querySelector<HTMLElement>("[data-label]");
    const text = label?.textContent ?? "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy ?? "");
      } catch {
        return;
      }
      document.dispatchEvent(new Event(copied));
      if (!label) return;
      label.textContent = "Copied";
      clearTimeout(timer);
      timer = setTimeout(() => {
        label.textContent = text;
      }, 2000);
    });
  }
}
