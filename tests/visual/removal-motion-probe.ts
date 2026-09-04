let checks = 0;
let movingChecks = 0;
const observer = new MutationObserver(() => {
  const body = document.querySelector(".downloads-table-body");
  if (!body) return;
  checks++;
  const moving = [...body.querySelectorAll<HTMLElement>(".downloads-virtual-row")].some((row) => {
    const target = Number.parseFloat(row.style.getPropertyValue("--downloads-virtual-row-top"));
    return Math.abs(new DOMMatrixReadOnly(getComputedStyle(row).transform).m42 - target) > 0.5;
  });
  const spacer = body.querySelector<HTMLElement>(".downloads-virtual-spacer");
  const resizing = spacer && Math.abs(spacer.getBoundingClientRect().height - Number.parseFloat(spacer.style.getPropertyValue("--downloads-virtual-total-height"))) > 0.5;
  if (moving || resizing) movingChecks++;
  document.documentElement.dataset.removalMotion = JSON.stringify({ checks, movingChecks });
});
observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class"] });

export {};
