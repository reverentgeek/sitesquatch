(() => {
	// What `ssqch serve` adds to each page it sends: it asks the server what changed,
	// and reloads, swaps a stylesheet or shows a build error. It's never written to the output.
	let seen;
	let panel;
	let icon;
	let hidden;
	const title = document.title;
	const show = error => {
		if (!error || error === hidden) {
			if (panel) {
				panel.remove();
				icon.remove();
				panel = icon = null;
				document.title = title;
			}
			if (!error) hidden = null;
			return;
		}
		if (!panel) {
			panel = document.createElement("div");
			panel.attachShadow({ mode: "open" }).innerHTML = `<style>
				section { position: fixed; inset: 0; z-index: 2147483647; overflow: auto; box-sizing: border-box; padding: 2rem 1rem; background: rgba(27, 32, 29, 0.97); color: #e5e9e1; font: 16px/1.5 system-ui, sans-serif; }
				div { max-width: 60rem; margin: 0 auto; }
				h1 { margin: 0 0 0.25rem; font-size: 1.4rem; color: #f0a17d; }
				p { margin: 0 0 1rem; color: #a2aca3; }
				pre { margin: 0 0 1rem; padding: 1rem; border-left: 5px solid #e8af43; background: #252b27; color: #e5e9e1; font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
				button { padding: 0.35rem 0.9rem; border: 0; border-radius: 4px; background: #a23e20; color: #fafaf7; font: inherit; cursor: pointer; }
				small { margin-left: 0.75rem; color: #a2aca3; }
			</style><section role="alert"><div><h1>Build failed</h1><p>This page is from the last build that worked. Fix the error and this goes away.</p><pre></pre><button type="button">Hide</button><small>Squatch Watch (ssqch serve)</small></div></section>`;
			panel.shadowRoot.querySelector("button").addEventListener("click", () => {
				hidden = panel.shadowRoot.querySelector("pre").textContent;
				show(hidden);
			});
			document.body.append(panel);
			icon = document.createElement("link");
			icon.rel = "icon";
			icon.href = "/__ssqch/favicon-error.svg";
			document.head.append(icon);
			document.title = `[build failed] ${title}`;
		}
		panel.shadowRoot.querySelector("pre").textContent = error;
	};
	// A changed stylesheet is fetched again in place: the page keeps its scroll position and its forms.
	const swap = (path, id) => {
		for (const link of document.querySelectorAll('link[rel~="stylesheet"]')) {
			const url = new URL(link.href, location.href);
			if (url.origin === location.origin && url.pathname === path) {
				url.searchParams.set("ssqch", id);
				link.href = url.href;
			}
		}
	};
	setInterval(async () => {
		try {
			const now = await (await fetch(`/__ssqch/build?v=${seen ?? ""}&p=${encodeURIComponent(location.pathname)}`)).json();
			show(now.error);
			if (seen !== undefined && now.id !== seen && !now.error) {
				if (now.reload) {
					console.log("[ssqch] Fresh tracks. Reloading.");
					location.reload();
					return;
				}
				for (const path of now.css) swap(path, now.id);
			}
			seen = now.id;
		} catch {}
	}, 700);
})();
