// JSON edited as text: a member taken out, put in or given a new value, and everything else in
// the file as it was written, its numbers (`1.0`, `1e5`, `12345678901234567890`), key order,
// escapes and layout. `ssqch import` changes a site's package.json this way, so that the diff a
// person reviews is the change and nothing else.

/** A value in the text: where it starts and ends, and an object's members. */
interface Value {
	start: number;
	end: number;
	members?: Member[];
}

/** An object's member: where its key starts, the key, and its value. */
interface Member {
	start: number;
	key: string;
	value: Value;
}

const SPACE = new Set([" ", "\t", "\n", "\r"]);

/** `text` read as JSON, with each value's place. `text` must be JSON (`JSON.parse` takes it). */
function read(text: string): Value {
	let i = 0;
	const space = () => {
		while (i < text.length && SPACE.has(text[i])) i++;
	};
	const string = () => {
		const start = i++;
		while (text[i] !== "\"") i += text[i] === "\\" ? 2 : 1;
		i++;
		return text.slice(start, i);
	};
	const value = (): Value => {
		space();
		const start = i;
		if (text[i] === "{") {
			i++;
			const members: Member[] = [];
			space();
			if (text[i] === "}") i++;
			else {
				for (;;) {
					space();
					const at = i;
					const key = JSON.parse(string()) as string;
					space();
					i++; // :
					members.push({ start: at, key, value: value() });
					space();
					if (text[i++] === "}") break;
				}
			}
			return { start, end: i, members };
		}
		if (text[i] === "[") {
			i++;
			space();
			if (text[i] === "]") i++;
			else {
				for (;;) {
					value();
					space();
					if (text[i++] === "]") break;
				}
			}
			return { start, end: i };
		}
		if (text[i] === "\"") {
			string();
			return { start, end: i };
		}
		while (i < text.length && !SPACE.has(text[i]) && !",]}".includes(text[i])) i++;
		return { start, end: i };
	};
	return value();
}

/** A JSON document to change in place. Each change reads the text again, so they can follow one another. */
export class JsonText {
	text: string;

	constructor(text: string) {
		this.text = text;
	}

	/** The value at `path`, by keys from the top (the last of two members with one key, as `JSON.parse` keeps it). */
	private find(path: readonly string[]): Value | undefined {
		let at: Value | undefined = read(this.text);
		for (const key of path) at = at?.members?.findLast((m) => m.key === key)?.value;
		return at;
	}

	/** Gives the value at `path` the JSON `json`. */
	replace(path: readonly string[], json: string): void {
		const value = this.find(path);
		if (value) this.splice(value.start, value.end, json);
	}

	/** Takes out every member called `key` from the object at `path`, with the comma and the line break it brings. */
	remove(path: readonly string[], key: string): void {
		for (;;) {
			const object = this.find(path);
			const members = object?.members;
			const i = members?.findLastIndex((m) => m.key === key) ?? -1;
			if (!object || !members || i === -1) return;
			if (members.length === 1) this.splice(object.start + 1, object.end - 1, "");
			else if (i < members.length - 1) this.splice(members[i].start, members[i + 1].start, "");
			else this.splice(members[i - 1].value.end, members[i].value.end, "");
		}
	}

	/**
	 * Puts `"key": json` in the object at `path`, before its first member whose key `before` says
	 * comes after it, or at the end. It takes the space its neighbours have between them; in an
	 * empty object, the file's line breaks and indentation, or none in a file on one line.
	 */
	insert(path: readonly string[], key: string, json: string, before: (other: string) => boolean = () => false): void {
		const object = this.find(path);
		const members = object?.members;
		if (!object || !members) return;
		const member = `${JSON.stringify(key)}: ${json}`;
		const k = members.findIndex((m) => before(m.key));
		// The space between two members: after the comma that ends the one before member `j`. With
		// one member, the space after the `{` if it's a line break, or else one space.
		const spaceBefore = (j: number) => {
			if (members.length === 1) {
				const after = this.text.slice(object.start + 1, members[0].start);
				return after.includes("\n") ? after : " ";
			}
			const from = this.text.indexOf(",", members[Math.max(j, 1) - 1].value.end) + 1;
			return this.text.slice(from, members[Math.max(j, 1)].start);
		};
		if (members.length === 0) {
			const newline = this.newline();
			if (!this.text.trim().includes("\n")) return this.splice(object.start + 1, object.end - 1, member);
			const indent = this.lineIndent(object.start);
			this.splice(object.start + 1, object.end - 1, `${newline}${indent}${this.unit()}${member}${newline}${indent}`);
		} else if (k === -1) {
			const last = members[members.length - 1];
			this.splice(last.value.end, last.value.end, `,${spaceBefore(members.length - 1)}${member}`);
		} else {
			this.splice(members[k].start, members[k].start, `${member},${spaceBefore(k)}`);
		}
	}

	/** An object for a new member, laid out as the file is: `{ "a": "1" }` on one line in a file on one line, else a member a line. */
	object(entries: Array<[string, string]>, depth: number): string {
		if (!this.text.trim().includes("\n")) return `{${entries.map(([k, v]) => `${JSON.stringify(k)}: ${v}`).join(", ")}}`;
		const newline = this.newline();
		const inner = this.unit().repeat(depth + 1);
		return `{${entries.map(([k, v]) => `${newline}${inner}${JSON.stringify(k)}: ${v}`).join(",")}${newline}${this.unit().repeat(depth)}}`;
	}

	private splice(from: number, to: number, insert: string): void {
		this.text = this.text.slice(0, from) + insert + this.text.slice(to);
	}

	private newline(): string {
		return this.text.includes("\r\n") ? "\r\n" : "\n";
	}

	/** One level of indentation: the second line's, as npm writes it, or two spaces. */
	private unit(): string {
		const second = this.text.split("\n")[1];
		const indent = second === undefined ? "" : /^[ \t]*/.exec(second)![0];
		return indent === "" ? "  " : indent;
	}

	/** The indentation of the line that `at` is on. */
	private lineIndent(at: number): string {
		const start = this.text.lastIndexOf("\n", at - 1) + 1;
		return /^[ \t]*/.exec(this.text.slice(start))![0];
	}
}
