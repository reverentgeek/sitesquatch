// The light and dark switch: it starts with the system's mode and remembers the reader's choice.
// The page reads fine without it (the mode then follows the system), which is why the button
// starts hidden.
const button = document.querySelector(".theme-switch");
if (button) {
	const system = matchMedia("(prefers-color-scheme: dark)");
	const current = () => document.documentElement.dataset.theme ?? (system.matches ? "dark" : "light");
	const label = () => {
		const next = current() === "dark" ? "Light" : "Dark";
		button.textContent = next;
		button.setAttribute("aria-label", `Switch to ${next.toLowerCase()} mode`);
	};
	button.addEventListener("click", () => {
		const next = current() === "dark" ? "light" : "dark";
		document.documentElement.dataset.theme = next;
		try {
			localStorage.setItem("theme", next);
		} catch {}
		label();
	});
	system.addEventListener("change", label);
	label();
	button.hidden = false;
}
