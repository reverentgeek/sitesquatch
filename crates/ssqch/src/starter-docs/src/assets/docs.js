// Optional extras. Every page reads fine without this file.

// Tabs: turn each group's labeled sections into buttons, and remember the
// choice, so picking "pnpm" once picks it in every group.
const groups = [...document.querySelectorAll(".tabs")].map((tabs) => {
  const panels = [...tabs.querySelectorAll(":scope > .tab")];
  const list = document.createElement("div");
  list.setAttribute("role", "tablist");
  for (const panel of panels) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = panel.dataset.label;
    button.setAttribute("role", "tab");
    button.addEventListener("click", () => choose(panel.dataset.label));
    list.append(button);
    panel.querySelector(".tab-label")?.remove();
    panel.setAttribute("role", "tabpanel");
  }
  tabs.prepend(list);
  return { panels, buttons: [...list.children] };
});

function choose(label) {
  for (const { panels, buttons } of groups) {
    // A group without that label keeps what it shows.
    const index = panels.findIndex((p) => p.dataset.label === label);
    if (index === -1 && panels.some((p) => !p.hidden) && buttons.some((b) => b.ariaSelected === "true")) continue;
    const shown = index === -1 ? 0 : index;
    panels.forEach((p, i) => (p.hidden = i !== shown));
    buttons.forEach((b, i) => (b.ariaSelected = String(i === shown)));
  }
  try {
    if (label) localStorage.setItem("tab", label);
  } catch {}
}

let remembered = "";
try {
  remembered = localStorage.getItem("tab") ?? "";
} catch {}
choose(remembered);

// Search, when the site was built with SEARCH=1.
if (window.PagefindUI && document.getElementById("search")) {
  new PagefindUI({ element: "#search", showSubResults: true });
}
