// <site-menu>: the header's Menu on a narrow screen, where the site's links don't fit beside the
// brand. It opens a panel from the side with the site's links and, on a docs page, the docs'
// sidebar, scrolled to the page you're on (on any other page, the footer's links). Without JavaScript the tag's link stays, and goes to
// the sidebar (after the page) or the footer.
//
// The panel is a modal <dialog>: Escape closes it, focus stays in it while it's open, and it goes
// back to the button after. Its links are copies of the header's and the sidebar's, made the
// first time it opens, so a page that's only read makes none.
customElements.define("site-menu", class extends HTMLElement {
	connectedCallback() {
		const button = Object.assign(document.createElement("button"), { type: "button", className: "menu-link", textContent: "Menu" });
		button.setAttribute("aria-haspopup", "dialog");
		button.setAttribute("aria-expanded", "false");
		const dialog = document.createElement("dialog");
		dialog.className = "menu-panel";
		dialog.setAttribute("aria-label", "Menu");
		this.replaceChildren(button, dialog);

		const fill = () => {
			const head = `<div class="menu-head"><span>Menu</span><form method="dialog"><button class="close">Close</button></form></div>`;
			const site = document.querySelector(".site-nav")?.cloneNode(true);
			const docs = document.querySelector("#sidebar .sidebar-inner")?.cloneNode(true);
			dialog.innerHTML = head;
			if (site) {
				site.className = "menu-site";
				dialog.append(site);
			}
			// The docs' sidebar, or on any other page the footer's groups of links (Docs, Project, Help).
			const nav = document.createElement("nav");
			nav.className = "menu-docs";
			nav.setAttribute("aria-label", docs ? "Documentation" : "More");
			if (docs) nav.append(...docs.childNodes);
			else {
				for (const group of document.querySelectorAll(".site-footer nav")) {
					const copy = group.cloneNode(true);
					copy.querySelector("h2")?.removeAttribute("id");
					nav.append(...copy.childNodes);
				}
			}
			if (nav.firstChild) dialog.append(nav);
		};
		const open = () => {
			if (!dialog.firstChild) fill();
			dialog.showModal();
			button.setAttribute("aria-expanded", "true");
			dialog.querySelector(".menu-docs [aria-current]")?.scrollIntoView({ block: "center" });
		};

		button.addEventListener("click", open);
		dialog.addEventListener("close", () => button.setAttribute("aria-expanded", "false"));
		// A click on the backdrop, or on a link (one to a heading on this page leaves the page as it is).
		dialog.addEventListener("click", (event) => {
			if (event.target === dialog || event.target.closest("a")) dialog.close();
		});
		// Wide enough for the header's own links: the panel isn't needed.
		matchMedia("(min-width: 54.01rem)").addEventListener("change", (event) => event.matches && dialog.close());
	}
});
