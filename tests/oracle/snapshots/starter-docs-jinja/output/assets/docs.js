// Optional extras. Every page reads fine without this file.

// Tabs: turn each group's labeled sections into buttons, and remember the
// choice, so picking "pnpm" once picks it in every group.
const groups = [...document.querySelectorAll(".tabs")].map((tabs) => {
  const panels = /** @type {HTMLElement[]} */ ([...tabs.querySelectorAll(":scope > .tab")]);
  const list = document.createElement("div");
  list.setAttribute("role", "tablist");
  for (const panel of panels) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = panel.dataset.label ?? "";
    button.setAttribute("role", "tab");
    button.addEventListener("click", () => choose(panel.dataset.label));
    list.append(button);
    panel.querySelector(".tab-label")?.remove();
    panel.setAttribute("role", "tabpanel");
  }
  tabs.prepend(list);
  return { panels, buttons: /** @type {HTMLElement[]} */ ([...list.children]) };
});

/** @param {string | undefined} label */
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

// The light and dark switch. It starts with the system's choice, and remembers the reader's.
/** @type {HTMLElement | null} */
const themeSwitch = document.querySelector(".theme-switch");
if (themeSwitch) {
  const dark = matchMedia("(prefers-color-scheme: dark)");
  const current = () => document.documentElement.dataset.theme ?? (dark.matches ? "dark" : "light");
  const label = () => (themeSwitch.textContent = current() === "dark" ? "Switch to light" : "Switch to dark");
  themeSwitch.addEventListener("click", () => {
    const next = current() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {}
    label();
  });
  dark.addEventListener("change", label);
  label();
  themeSwitch.hidden = false;
}

// Copy as Markdown: the page's Markdown copy (llmsPlugin() writes it), for pasting into a chat
// with an agent. The button stays hidden where there's no clipboard to copy to.
for (const button of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll("[data-copy-markdown]"))) {
  if (!navigator.clipboard) continue;
  button.hidden = false;
  button.addEventListener("click", async () => {
    try {
      const response = await fetch(/** @type {string} */ (button.dataset.copyMarkdown));
      await navigator.clipboard.writeText(await response.text());
      button.textContent = "Copied";
    } catch {
      button.textContent = "Couldn't copy";
    }
    setTimeout(() => { button.textContent = "Copy as Markdown"; }, 2000);
  });
}

// Copy link: the # beside each heading copies the address of that section as well as going
// there, ready to paste into a message, an issue or a chat with an agent. Without a clipboard
// it's the plain link it always was.
if (navigator.clipboard) {
  for (const anchor of /** @type {NodeListOf<HTMLAnchorElement>} */ (document.querySelectorAll("a.anchor"))) {
    anchor.title = "Copy link";
    anchor.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(anchor.href);
        anchor.dataset.copied = "";
        setTimeout(() => { delete anchor.dataset.copied; }, 2000);
      } catch {}
    });
  }
}
