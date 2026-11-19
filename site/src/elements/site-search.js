// <site-search>: the docs' search. Pagefind's script and index load the first time someone opens
// it (the button, or "/"), so a page that's only read loads neither. Without JavaScript the tag's
// link to every name on one page stays. site/build.ts runs Pagefind after the build.
//
// A name typed as it is (`base`, `imagePlugin`, `ssqch diff`) comes first, above Pagefind's
// results, with its one line and the page that explains it, as `ssqch docs <name>` answers: the
// names are the reference page's, from /docs/names.json.
let ready;
const load = () => (ready ??= Promise.all([new Promise((resolve, reject) => {
	const css = Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/pagefind/pagefind-ui.css" });
	const script = Object.assign(document.createElement("script"), { src: "/pagefind/pagefind-ui.js" });
	script.onload = () => {
		new window.PagefindUI({ element: "#search-box", showSubResults: true, showImages: false, autofocus: true });
		resolve();
	};
	script.onerror = reject;
	document.head.append(css, script);
}), fetch("/docs/names.json").then((r) => r.json()).catch(() => [])]));

const escape = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
/** `x` in a summary as code. */
const inline = (s) => escape(s).replace(/`([^`]+)`/g, "<code>$1</code>");
/** What's typed, the way names are compared: `imagePlugin()` and `imageplugin` are `imageplugin`. */
const key = (s) => s.trim().toLowerCase().replace(/\(\)$/, "");

customElements.define("site-search", class extends HTMLElement {
	connectedCallback() {
		const dialog = document.createElement("dialog");
		dialog.className = "search-dialog";
		dialog.setAttribute("aria-label", "Search the docs");
		dialog.innerHTML = `<form method="dialog"><button class="close">Close</button></form><div class="search-exact" aria-live="polite"></div><div id="search-box"></div>`;
		const button = Object.assign(document.createElement("button"), { type: "button", className: "search-link" });
		button.innerHTML = "<span>Search the docs</span> <kbd>/</kbd>";
		this.replaceChildren(button, dialog);
		const exact = dialog.querySelector(".search-exact");
		const open = () => {
			dialog.showModal();
			load().then(([, names]) => {
				const input = dialog.querySelector("#search-box input");
				input?.focus();
				if (!input || input.dataset.exact) return;
				input.dataset.exact = "on";
				// Between the box and Pagefind's results.
				input.form?.querySelector(".pagefind-ui__drawer")?.before(exact);
				input.addEventListener("input", () => {
					const typed = key(input.value);
					const found = typed === "" ? [] : names.filter((n) => key(n.name) === typed || key(n.name) === `ssqch ${typed}`);
					exact.innerHTML = found.map((n) => `<a href="${escape(n.url)}"><code>${escape(n.name)}</code> <span>${escape(n.group)}</span><p>${inline(n.summary)}</p><b>${escape(n.page)}</b></a>`).join("");
				});
			}, () => {
				dialog.querySelector("#search-box").textContent = "No tracks to follow yet: the search index is made by a production build (node build.ts).";
			});
		};
		button.addEventListener("click", open);
		dialog.addEventListener("click", (event) => event.target === dialog && dialog.close());
		document.addEventListener("keydown", (event) => {
			if (event.key !== "/" || dialog.open || event.target.closest("input, textarea, select, [contenteditable]")) return;
			event.preventDefault();
			open();
		});
	}
});
