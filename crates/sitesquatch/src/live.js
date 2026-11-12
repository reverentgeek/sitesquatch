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
	// Stylesheets and scripts the page links that aren't in the output: a note in the corner (the
	// page is there, just unstyled or without its script), and the server says so in the terminal.
	let note;
	let missing = new Map();
	const assets = () => [...document.querySelectorAll('link[rel~="stylesheet"][href], script[src]')]
		.map(el => new URL(el.getAttribute("href") ?? el.getAttribute("src"), location.href))
		.filter(url => url.origin === location.origin && !url.pathname.startsWith("/__ssqch/"))
		.map(url => url.pathname);
	const notice = () => {
		if (!missing.size) {
			note?.remove();
			note = null;
			return;
		}
		if (!note) {
			note = document.createElement("div");
			note.attachShadow({ mode: "open" }).innerHTML = `<style>
				aside { position: fixed; right: 1rem; bottom: 1rem; z-index: 2147483646; max-width: 32rem; box-sizing: border-box; padding: 0.75rem 1rem; border-left: 5px solid #e8af43; background: #1b201d; color: #e5e9e1; font: 14px/1.5 system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3); }
				strong { display: block; color: #f0a17d; }
				p { margin: 0.35rem 0 0; overflow-wrap: anywhere; }
				button { margin-top: 0.5rem; padding: 0.2rem 0.7rem; border: 0; border-radius: 4px; background: #a23e20; color: #fafaf7; font: inherit; cursor: pointer; }
			</style><aside role="status"><strong>Missing from the output</strong><div></div><button type="button">Hide</button></aside>`;
			note.shadowRoot.querySelector("button").addEventListener("click", () => note.remove());
			document.body.append(note);
		}
		const list = note.shadowRoot.querySelector("div");
		list.replaceChildren(...[...missing.values()].map(message => Object.assign(document.createElement("p"), { textContent: message })));
	};
	const check = async paths => {
		for (const path of paths) {
			try {
				const found = (await fetch(path, { method: "HEAD", cache: "no-store" })).ok;
				if (found) {
					missing.delete(path);
					continue;
				}
				const { message } = await (await fetch(`/__ssqch/missing?path=${encodeURIComponent(path)}`)).json();
				if (message) missing.set(path, message);
				else missing.delete(path);
			} catch {}
		}
		notice();
	};
	check(assets());
	// A changed stylesheet is fetched again in place: the page keeps its scroll position and its forms.
	// The new one loads next to the old, which goes once it's there, so the page is never unstyled
	// in between. One that doesn't load, or comes back empty where the old one had rules (a tool
	// still writing it), leaves the old one in place and is tried again.
	const loading = new Map();
	const rules = link => {
		try {
			return link.sheet?.cssRules.length ?? 0;
		} catch {
			return 1;
		}
	};
	const swap = (path, id, tries = 0) => {
		const replacements = new Set(loading.values());
		for (const link of document.querySelectorAll('link[rel~="stylesheet"]')) {
			const url = new URL(link.href, location.href);
			if (replacements.has(link) || url.origin !== location.origin || url.pathname !== path) continue;
			url.searchParams.set("ssqch", tries ? `${id}.${tries}` : id);
			// A newer change replaces one still loading.
			loading.get(link)?.remove();
			const next = link.cloneNode();
			next.href = url.href;
			const done = ok => {
				if (loading.get(link) !== next) return;
				loading.delete(link);
				(ok ? link : next).remove();
				if (!ok && tries < 5) setTimeout(() => swap(path, id, tries + 1), 300);
			};
			next.addEventListener("load", () => done(rules(next) > 0 || rules(link) === 0), { once: true });
			next.addEventListener("error", () => done(false), { once: true });
			loading.set(link, next);
			link.after(next);
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
				// A file that was missing may be there now.
				if (missing.size) check([...missing.keys()]);
			}
			seen = now.id;
		} catch {}
	}, 700);
})();
