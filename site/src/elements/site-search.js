// <site-search>: the docs' search. Pagefind's script and index load the first time someone opens
// it (the button, or "/"), so a page that's only read loads neither. Without JavaScript the tag's
// link to every name on one page stays. site/build.ts runs Pagefind after the build.
let ready;
const load = () => (ready ??= new Promise((resolve, reject) => {
	const css = Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/pagefind/pagefind-ui.css" });
	const script = Object.assign(document.createElement("script"), { src: "/pagefind/pagefind-ui.js" });
	script.onload = () => {
		new window.PagefindUI({ element: "#search-box", showSubResults: true, showImages: false, autofocus: true });
		resolve();
	};
	script.onerror = reject;
	document.head.append(css, script);
}));

customElements.define("site-search", class extends HTMLElement {
	connectedCallback() {
		const dialog = document.createElement("dialog");
		dialog.className = "search-dialog";
		dialog.setAttribute("aria-label", "Search the docs");
		dialog.innerHTML = `<form method="dialog"><button class="close">Close</button></form><div id="search-box"></div>`;
		const button = Object.assign(document.createElement("button"), { type: "button", className: "search-link" });
		button.innerHTML = "<span>Search the docs</span> <kbd>/</kbd>";
		this.replaceChildren(button, dialog);
		const open = () => {
			dialog.showModal();
			load().then(() => dialog.querySelector("input")?.focus(), () => {
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
