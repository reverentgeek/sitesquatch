(() => {
	// What `ssqch serve` adds to each page it sends: it asks the server what changed,
	// and reloads, swaps a stylesheet or shows a build error. It's never written to the output.
	// It's a file (`/__ssqch/live.js`), not inline, so a site's Content-Security-Policy allows it.
	// The page says which build it was sent from: a rebuild that finished before the first poll
	// (they take 40 ms) is news to it. Taking the server's answer as the start missed an edit saved
	// in the first 0.7 s after a page loaded (Pack Mule).
	const sent = document.currentScript?.dataset.build;
	let seen = sent && /^\d+$/.test(sent) ? Number(sent) : undefined;
	let panel;
	let icon;
	let hidden;
	// Where the keyboard was before the overlay took it, to give it back.
	let before;
	const title = document.title;
	const hide = () => {
		hidden = panel.shadowRoot.querySelector("pre").textContent;
		show(hidden);
	};
	const escape = event => {
		if (event.key === "Escape" && panel) hide();
	};
	const show = error => {
		if (!error || error === hidden) {
			if (panel) {
				const had = panel.shadowRoot.activeElement || document.activeElement === panel;
				panel.remove();
				icon.remove();
				panel = icon = null;
				document.title = title;
				document.removeEventListener("keydown", escape);
				if (had && before?.isConnected) before.focus();
				before = null;
			}
			if (!error) hidden = null;
			return;
		}
		if (!panel) {
			panel = document.createElement("div");
			panel.attachShadow({ mode: "open" }).innerHTML = `<link rel="stylesheet" href="/__ssqch/overlay.css"><section role="alert" aria-labelledby="ssqch-title" tabindex="-1"><div><h1 id="ssqch-title">Build failed</h1><p>This page is from the last build that worked. Fix the error and this goes away.</p><pre></pre><button type="button" data-copy>Copy diagnostic</button><button type="button" data-hide>Hide</button><small>Escape hides it. Squatch Watch (ssqch serve)</small></div></section>`;
			const root = panel.shadowRoot;
			const copy = root.querySelector("[data-copy]");
			copy.addEventListener("click", async () => {
				const text = root.querySelector("pre").textContent;
				try {
					await navigator.clipboard.writeText(text);
					copy.textContent = "Copied";
				} catch {
					// No clipboard (a page served over plain HTTP to another device): select it to copy by hand.
					const range = document.createRange();
					range.selectNodeContents(root.querySelector("pre"));
					getSelection().removeAllRanges();
					getSelection().addRange(range);
					copy.textContent = "Selected: copy it with your keyboard";
				}
				setTimeout(() => {
					copy.textContent = "Copy diagnostic";
				}, 2000);
			});
			root.querySelector("[data-hide]").addEventListener("click", hide);
			document.addEventListener("keydown", escape);
			document.body.append(panel);
			// The keyboard goes to the overlay (Tab reaches its buttons), and comes back when it goes.
			before = document.activeElement;
			root.querySelector("section").focus({ preventScroll: true });
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
			note.attachShadow({ mode: "open" }).innerHTML = `<link rel="stylesheet" href="/__ssqch/overlay.css"><aside role="status"><strong>Missing from the output</strong><div></div><button type="button">Hide</button></aside>`;
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
	// What the server said: its error shown, the page reloaded, or stylesheets swapped. False
	// once the page is reloading.
	const hear = now => {
		show(now.error);
		if (seen !== undefined && now.id !== seen && !now.error) {
			if (now.reload) {
				console.log("[ssqch] Fresh tracks. Reloading.");
				location.reload();
				return false;
			}
			for (const path of now.css) swap(path, now.id);
			// A file that was missing may be there now.
			if (missing.size) check([...missing.keys()]);
		}
		seen = now.id;
		return true;
	};
	let wait = 700;
	const ask = async () => (await fetch(`/__ssqch/build?v=${seen ?? ""}&p=${encodeURIComponent(location.pathname)}`)).json();
	// One tab of the site holds the stream, and says each new id to the others on a channel: a
	// browser gives a site about six connections and a stream keeps one, so a seventh tab couldn't
	// load at all (tried). The tab that holds the lock listens; each of the others asks for its own
	// page's answer when the id moves, a request that gives its connection back. When the tab with
	// the lock goes, another takes it.
	const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("ssqch-live") : undefined;
	const locks = typeof navigator === "object" && navigator.locks;
	const heard = now => {
		channel?.postMessage(now.id);
		return hear(now);
	};
	// A stream that never said anything (a proxy holding it back): asking from then on.
	let streamless = false;
	// The server says each change as it happens (`/__ssqch/events`). It answers at once when the
	// stream opens, so one that's quiet for 2 s is held back somewhere, and the page asks instead.
	// Where it closes (the server stopped), the page asks until the server's back, then listens again.
	const listen = () => {
		if (streamless || typeof EventSource !== "function") return false;
		const events = new EventSource(`/__ssqch/events?v=${seen ?? ""}&p=${encodeURIComponent(location.pathname)}`);
		let said = false;
		const quiet = setTimeout(() => {
			if (said) return;
			streamless = true;
			events.close();
			setTimeout(poll, 0);
		}, 2000);
		events.onmessage = event => {
			said = true;
			if (!heard(JSON.parse(event.data))) events.close();
		};
		events.onerror = () => {
			clearTimeout(quiet);
			events.close();
			setTimeout(poll, wait);
		};
		return true;
	};
	// Every 0.7 s while the server answers. Once it doesn't (it was stopped), less and less often,
	// up to every 10 s, said once in the console: polling at the same pace filled it with an error
	// every 0.7 s (184 in two minutes, the new-docs run). When it answers again, the pace is back.
	const poll = async () => {
		try {
			const now = await ask();
			if (wait !== 700) console.log("[ssqch] The server's back.");
			wait = 700;
			if (!heard(now)) return;
			if (listen()) return;
		} catch {
			if (wait === 700) console.log("[ssqch] The server isn't answering (stopped?). Checking now and then.");
			wait = Math.min(wait * 2, 10_000);
		}
		setTimeout(poll, wait);
	};
	const lead = () => {
		if (!listen()) setTimeout(poll, wait);
	};
	if (locks && channel) {
		// Until this tab has the lock: what the one with it says, and one look of its own now, for a
		// rebuild since the page was sent.
		const look = async () => {
			try { hear(await ask()); } catch { /* the tab with the lock says when the server's back */ }
		};
		channel.onmessage = event => {
			if (event.data !== seen) look();
		};
		look();
		// Held while the page is open: the promise doesn't settle, and a page that goes lets it go.
		locks.request("ssqch-live", () => new Promise(() => {
			channel.onmessage = null;
			lead();
		}));
	} else lead();
})();
