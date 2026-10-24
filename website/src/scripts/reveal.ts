export function reveal() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!("IntersectionObserver" in window)) return;
  const items = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
  for (const item of items)
    if (item.getBoundingClientRect().top < window.innerHeight) item.classList.add("is-in");
  document.documentElement.classList.add("js-reveal");
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-in");
      observer.unobserve(entry.target);
    }
  });
  for (const item of items) if (!item.classList.contains("is-in")) observer.observe(item);
}
