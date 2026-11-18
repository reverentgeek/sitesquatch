// Patterns in the syntax of Rust's `regex` crate, as JavaScript regular expressions.
//
// 0.7 read `ssqch diff --ignore` with Rust's regex crate, and its importer's patterns are that
// crate's too. There `\w`, `\d`, `\s` and `\b` know every script, `.` stops only at `\n`, and
// flags change partway through a pattern (`(?i:pine) cone`). In JavaScript the first four are
// ASCII, `.` stops at `\r` and U+2028 as well, and flag groups only came with Node 23. So a
// pattern is read here as the crate's parser reads it (regex-syntax 0.8, its errors word for
// word), and written out as JavaScript, in `v` mode, that matches what the crate matched. What
// JavaScript has no way to match is refused, with a message in the crate's format that says so.

/** A pattern the crate wouldn't take, or one JavaScript can't match as it did. The message is the crate's: `regex parse error:`, the pattern with a caret under the spot, and `error: ...`. */
export class RegexError extends Error {}

/**
 * `pattern`, in the regex crate's syntax, as a JavaScript RegExp with `flags` (`g`, `y`, `d`) as well.
 * `flagGroups: false` matches case-insensitive parts as a Node without flag groups does (for tests).
 */
export function rustRegExp(pattern: string, flags = "", options: { flagGroups?: boolean } = {}): RegExp {
	const parser = new Parser(pattern);
	const ast = parser.parse();
	const ir = translate(ast, parser);
	return emit(ir, parser, flags, MODIFIERS && options.flagGroups !== false);
}

// ---- the parser (regex-syntax's `ast::parse`) ----------------------------------------------

/** From one character to another, as indexes into the pattern's characters (code points). */
interface Span { start: number; end: number }

type Look = "start" | "end" | "startLine" | "endLine" | "word" | "notWord" | "wordStart" | "wordEnd" | "wordStartHalf" | "wordEndHalf";
type FlagItem = { flag: string; span: Span } | { flag: "-"; span: Span };
type Lit = { k: "lit"; c: number; byte: boolean; span: Span };
type Perl = { k: "perl"; kind: "d" | "s" | "w"; neg: boolean; span: Span };
type Prop = { k: "prop"; neg: boolean; name: string; op?: "=" | "!="; value?: string; span: Span };
type Bracket = { k: "bracket"; neg: boolean; set: SetAst; span: Span };
type Primitive = Lit | Perl | Prop | { k: "dot"; span: Span } | { k: "look"; kind: Look; span: Span };

type Ast =
	| Primitive
	| Bracket
	| { k: "empty" }
	| { k: "flags"; items: FlagItem[] }
	| { k: "rep"; ast: Ast; min: number; max: number; greedy: boolean }
	| { k: "group"; capture: boolean; flags?: FlagItem[]; ast: Ast }
	| { k: "alt"; asts: Ast[] }
	| { k: "concat"; asts: Ast[] };

type Item = Lit | Perl | Prop | Bracket | { k: "range"; lo: Lit; hi: Lit; span: Span } | { k: "ascii"; name: string; neg: boolean; span: Span };
type SetAst = { k: "union"; items: Item[] } | { k: "op"; op: "&&" | "--" | "~~"; lhs: SetAst; rhs: SetAst };

type GroupState = { k: "group"; concat: Ast[]; capture: boolean; flags?: FlagItem[]; open: Span; ignoreWhitespace: boolean } | { k: "alt"; asts: Ast[] };
type ClassState = { k: "open"; union: Item[]; neg: boolean; start: number; end: number } | { k: "op"; op: "&&" | "--" | "~~"; lhs: SetAst };

const isWhitespace = (c: string | undefined) => c !== undefined && /^\p{White_Space}$/u.test(c);
const isHex = (c: string | undefined) => c !== undefined && /^[0-9a-fA-F]$/.test(c);
const META = "\\.+*?()|[]{}^$#&-~";
/** Rust's `is_escapeable_character`: a meta character, or any ASCII that isn't a letter, a digit, `<` or `>`. */
const isEscapeable = (c: string) => META.includes(c) || (c.codePointAt(0)! <= 0x7f && !/^[0-9A-Za-z<>]$/.test(c));
const ASCII_CLASSES: Record<string, Array<[number, number]>> = {
	alnum: [[48, 57], [65, 90], [97, 122]], alpha: [[65, 90], [97, 122]], ascii: [[0, 127]], blank: [[9, 9], [32, 32]],
	cntrl: [[0, 31], [127, 127]], digit: [[48, 57]], graph: [[33, 126]], lower: [[97, 122]], print: [[32, 126]],
	punct: [[33, 47], [58, 64], [91, 96], [123, 126]], space: [[9, 13], [32, 32]], upper: [[65, 90]], word: [[48, 57], [65, 90], [95, 95], [97, 122]], xdigit: [[48, 57], [65, 70], [97, 102]],
};

class Parser {
	readonly pattern: string;
	readonly cs: string[];
	pos = 0;
	ignoreWhitespace = false;
	private names = new Map<string, Span>();
	private groups: GroupState[] = [];
	private classes: ClassState[] = [];

	constructor(pattern: string) {
		this.pattern = pattern;
		this.cs = Array.from(pattern);
	}

	get eof(): boolean { return this.pos >= this.cs.length; }
	/** The character at the parser, or "" at the end. */
	ch(): string { return this.cs[this.pos] ?? ""; }
	here(): Span { return { start: this.pos, end: this.pos }; }
	charSpan(): Span { return { start: this.pos, end: this.pos + 1 }; }

	/** Moves past one character, and answers whether there's another. */
	bump(): boolean {
		if (this.eof) return false;
		this.pos++;
		return !this.eof;
	}

	bumpIf(prefix: string): boolean {
		const chars = Array.from(prefix);
		for (let k = 0; k < chars.length; k++) if (this.cs[this.pos + k] !== chars[k]) return false;
		this.pos += chars.length;
		return true;
	}

	/** With `x`, past whitespace and `#` comments. */
	bumpSpace(): void {
		if (!this.ignoreWhitespace) return;
		while (!this.eof) {
			if (isWhitespace(this.ch())) this.pos++;
			else if (this.ch() === "#") {
				this.pos++;
				while (!this.eof) {
					const c = this.ch();
					this.pos++;
					if (c === "\n") break;
				}
			} else break;
		}
	}

	bumpAndBumpSpace(): boolean {
		if (!this.bump()) return false;
		this.bumpSpace();
		return !this.eof;
	}

	peek(): string | undefined { return this.cs[this.pos + 1]; }

	/** The next character, past whitespace and comments with `x`, as the crate finds it. */
	peekSpace(): string | undefined {
		if (!this.ignoreWhitespace) return this.peek();
		if (this.eof) return undefined;
		let start = this.pos + 1;
		let inComment = false;
		for (let i = start; i < this.cs.length; i++) {
			const c = this.cs[i];
			if (isWhitespace(c)) continue;
			else if (!inComment && c === "#") inComment = true;
			else if (inComment && c === "\n") inComment = false;
			else { start = i; break; }
		}
		return this.cs[start];
	}

	error(span: Span, message: string, aux?: Span): never {
		throw new RegexError(formatError(this.cs, span, message, aux));
	}

	parse(): Ast {
		let concat: Ast[] = [];
		for (;;) {
			this.bumpSpace();
			if (this.eof) break;
			switch (this.ch()) {
				case "(": concat = this.pushGroup(concat); break;
				case ")": concat = this.popGroup(concat); break;
				case "|": concat = this.pushAlternate(concat); break;
				case "[": concat.push(this.parseSetClass()); break;
				case "?": concat = this.repetition(concat, 0, 1); break;
				case "*": concat = this.repetition(concat, 0, Infinity); break;
				case "+": concat = this.repetition(concat, 1, Infinity); break;
				case "{": concat = this.countedRepetition(concat); break;
				default: concat.push(this.parsePrimitive());
			}
		}
		return this.popGroupEnd(concat);
	}

	private pushAlternate(concat: Ast[]): Ast[] {
		const top = this.groups[this.groups.length - 1];
		if (top?.k === "alt") top.asts.push(asConcat(concat));
		else this.groups.push({ k: "alt", asts: [asConcat(concat)] });
		this.bump();
		return [];
	}

	private pushGroup(concat: Ast[]): Ast[] {
		const open = this.charSpan();
		this.bump();
		this.bumpSpace();
		if (this.bumpIf("?=") || this.bumpIf("?!") || this.bumpIf("?<=") || this.bumpIf("?<!")) {
			this.error({ start: open.start, end: this.pos }, "look-around, including look-ahead and look-behind, is not supported");
		}
		const inner = this.here();
		if (this.bumpIf("?P<") || this.bumpIf("?<")) {
			this.captureName();
			return this.enterGroup(concat, { capture: true, open });
		}
		if (this.bumpIf("?")) {
			if (this.eof) this.error(open, "unclosed group");
			const flags = this.parseFlags();
			const end = this.ch();
			this.bump();
			if (end === ")") {
				if (flags.length === 0) this.error(inner, "repetition operator missing expression");
				const x = flagState(flags, "x");
				if (x !== undefined) this.ignoreWhitespace = x;
				concat.push({ k: "flags", items: flags });
				return concat;
			}
			return this.enterGroup(concat, { capture: false, flags, open });
		}
		return this.enterGroup(concat, { capture: true, open });
	}

	private enterGroup(concat: Ast[], group: { capture: boolean; flags?: FlagItem[]; open: Span }): Ast[] {
		this.groups.push({ k: "group", concat, ...group, ignoreWhitespace: this.ignoreWhitespace });
		const x = group.flags ? flagState(group.flags, "x") : undefined;
		if (x !== undefined) this.ignoreWhitespace = x;
		return [];
	}

	private captureName(): void {
		if (this.eof) this.error(this.here(), "unclosed capture group name");
		const start = this.pos;
		for (;;) {
			if (this.ch() === ">") break;
			const first = this.pos === start;
			if (!(this.ch() === "_" || /^\p{Alphabetic}$/u.test(this.ch()) || (!first && (this.ch() === "." || this.ch() === "[" || this.ch() === "]" || /^\p{N}$/u.test(this.ch()))))) {
				this.error(this.charSpan(), "invalid capture group character");
			}
			if (!this.bump()) break;
		}
		const end = this.pos;
		if (this.eof) this.error(this.here(), "unclosed capture group name");
		this.bump();
		if (end === start) this.error({ start, end: start }, "empty capture group name");
		const name = this.cs.slice(start, end).join("");
		const span = { start, end };
		const before = this.names.get(name);
		if (before) this.error(span, "duplicate capture group name", before);
		this.names.set(name, span);
	}

	private parseFlags(): FlagItem[] {
		const items: FlagItem[] = [];
		let dangling: Span | undefined;
		while (this.ch() !== ":" && this.ch() !== ")") {
			if (this.ch() === "-") {
				dangling = this.charSpan();
				const before = items.find((i) => i.flag === "-");
				if (before) this.error(this.charSpan(), "flag negation operator repeated", before.span);
				items.push({ flag: "-", span: this.charSpan() });
			} else {
				dangling = undefined;
				if (!"imsUuRx".includes(this.ch()) || this.ch() === "") this.error(this.charSpan(), "unrecognized flag");
				const before = items.find((i) => i.flag === this.ch());
				if (before) this.error(this.charSpan(), "duplicate flag", before.span);
				items.push({ flag: this.ch(), span: this.charSpan() });
			}
			if (!this.bump()) this.error(this.here(), "expected flag but got end of regex");
		}
		if (dangling) this.error(dangling, "dangling flag negation operator");
		return items;
	}

	private popGroup(concat: Ast[]): Ast[] {
		let top = this.groups.pop();
		let alt: Ast[] | undefined;
		if (top?.k === "alt") {
			alt = top.asts;
			top = this.groups.pop();
		}
		if (top?.k !== "group") this.error(this.charSpan(), "unopened group");
		this.ignoreWhitespace = top.ignoreWhitespace;
		this.bump();
		const body: Ast = alt ? { k: "alt", asts: [...alt, asConcat(concat)] } : asConcat(concat);
		top.concat.push({ k: "group", capture: top.capture, flags: top.flags, ast: body });
		return top.concat;
	}

	private popGroupEnd(concat: Ast[]): Ast {
		const top = this.groups.pop();
		let ast: Ast;
		if (top === undefined) ast = asConcat(concat);
		else if (top.k === "alt") ast = { k: "alt", asts: [...top.asts, asConcat(concat)] };
		else this.error(top.open, "unclosed group");
		const next = this.groups.pop();
		if (next?.k === "group") this.error(next.open, "unclosed group");
		return ast;
	}

	private repetition(concat: Ast[], min: number, max: number): Ast[] {
		const ast = concat.pop();
		if (ast === undefined || ast.k === "empty" || ast.k === "flags") this.error(this.here(), "repetition operator missing expression");
		let greedy = true;
		if (this.bump() && this.ch() === "?") {
			greedy = false;
			this.bump();
		}
		concat.push({ k: "rep", ast, min, max, greedy });
		return concat;
	}

	private countedRepetition(concat: Ast[]): Ast[] {
		const start = this.pos;
		const ast = concat.pop();
		if (ast === undefined || ast.k === "empty" || ast.k === "flags") this.error(this.here(), "repetition operator missing expression");
		const unclosed = () => this.error({ start, end: this.pos }, "unclosed counted repetition");
		const need = (n: number | Span): number => (typeof n === "number" ? n : this.error(n, "repetition quantifier expects a valid decimal"));
		if (!this.bumpAndBumpSpace()) unclosed();
		const first = this.decimal();
		if (this.eof) unclosed();
		let min: number, max: number;
		if (this.ch() === ",") {
			if (!this.bumpAndBumpSpace()) unclosed();
			if (this.ch() !== "}") {
				min = need(first);
				max = need(this.decimal());
			} else {
				min = need(first);
				max = Infinity;
			}
		} else {
			min = max = need(first);
		}
		if (this.eof || this.ch() !== "}") unclosed();
		let greedy = true;
		if (this.bumpAndBumpSpace() && this.ch() === "?") {
			greedy = false;
			this.bump();
		}
		if (min > max) this.error({ start, end: this.pos }, "invalid repetition count range, the start must be <= the end");
		concat.push({ k: "rep", ast, min, max, greedy });
		return concat;
	}

	/** Digits with whitespace around them (whatever `x` says), or the span where they should be. */
	private decimal(): number | Span {
		while (!this.eof && isWhitespace(this.ch())) this.bump();
		const start = this.pos;
		let digits = "";
		while (!this.eof && this.ch() >= "0" && this.ch() <= "9") {
			digits += this.ch();
			this.bumpAndBumpSpace();
		}
		const span = { start, end: this.pos };
		while (!this.eof && isWhitespace(this.ch())) this.bumpAndBumpSpace();
		if (digits === "") return span;
		const n = Number(digits);
		if (n > 0xffff_ffff) this.error(span, "decimal literal invalid");
		return n;
	}

	parsePrimitive(): Primitive {
		const span = this.charSpan();
		switch (this.ch()) {
			case "\\": return this.parseEscape();
			case ".": this.bump(); return { k: "dot", span };
			case "^": this.bump(); return { k: "look", kind: "startLine", span };
			case "$": this.bump(); return { k: "look", kind: "endLine", span };
		}
		const c = this.ch().codePointAt(0)!;
		this.bump();
		return { k: "lit", c, byte: false, span };
	}

	private parseEscape(): Primitive {
		const start = this.pos;
		if (!this.bump()) this.error({ start, end: this.pos }, "incomplete escape sequence, reached end of pattern prematurely");
		const c = this.ch();
		if (c >= "0" && c <= "9") this.error({ start, end: this.pos + 1 }, "backreferences are not supported");
		if (c === "x" || c === "u" || c === "U") {
			const lit = this.parseHex();
			lit.span.start = start;
			return lit;
		}
		if (c === "p" || c === "P") {
			const prop = this.parseUnicodeClass();
			prop.span.start = start;
			return prop;
		}
		if ("dswDSW".includes(c)) {
			this.bump();
			return { k: "perl", kind: c.toLowerCase() as "d" | "s" | "w", neg: c === c.toUpperCase(), span: { start, end: this.pos } };
		}
		this.bump();
		const span = { start, end: this.pos };
		if (isEscapeable(c)) return { k: "lit", c: c.codePointAt(0)!, byte: false, span };
		const special: Record<string, number> = { a: 7, f: 12, t: 9, n: 10, r: 13, v: 11 };
		if (special[c] !== undefined) return { k: "lit", c: special[c], byte: false, span };
		switch (c) {
			case "A": return { k: "look", kind: "start", span };
			case "z": return { k: "look", kind: "end", span };
			case "B": return { k: "look", kind: "notWord", span };
			case "<": return { k: "look", kind: "wordStart", span };
			case ">": return { k: "look", kind: "wordEnd", span };
			case "b": {
				const kind = !this.eof && this.ch() === "{" ? this.specialWordBoundary(start) : undefined;
				return { k: "look", kind: kind ?? "word", span: { start, end: this.pos } };
			}
		}
		return this.error(span, "unrecognized escape sequence");
	}

	/** `\b{start}` and the others, or nothing when the `{` begins a repetition (`\b{2}`). */
	private specialWordBoundary(wbStart: number): Look | undefined {
		const valid = (c: string) => /^[A-Za-z-]$/.test(c);
		const start = this.pos;
		if (!this.bumpAndBumpSpace()) this.error({ start: wbStart, end: this.pos }, "found either the beginning of a special word boundary or a bounded repetition on a \\b with an opening brace, but no closing brace");
		const contents = this.pos;
		if (!valid(this.ch())) {
			this.pos = start;
			return undefined;
		}
		let name = "";
		while (!this.eof && valid(this.ch())) {
			name += this.ch();
			this.bumpAndBumpSpace();
		}
		if (this.eof || this.ch() !== "}") this.error({ start, end: this.pos }, "special word boundary assertion is either unclosed or contains an invalid character");
		const end = this.pos;
		this.bump();
		const kinds: Record<string, Look> = { start: "wordStart", end: "wordEnd", "start-half": "wordStartHalf", "end-half": "wordEndHalf" };
		return kinds[name] ?? this.error({ start: contents, end }, "unrecognized special word boundary assertion, valid choices are: start, end, start-half or end-half");
	}

	private parseHex(): Lit {
		const digits = this.ch() === "x" ? 2 : this.ch() === "u" ? 4 : 8;
		const byte = this.ch() === "x";
		if (!this.bumpAndBumpSpace()) this.error(this.here(), "incomplete escape sequence, reached end of pattern prematurely");
		let hex = "";
		let start: number, end: number;
		if (this.ch() === "{") {
			const brace = this.pos;
			start = this.pos + 1;
			while (this.bumpAndBumpSpace() && this.ch() !== "}") {
				if (!isHex(this.ch())) this.error(this.charSpan(), "invalid hexadecimal digit");
				hex += this.ch();
			}
			if (this.eof) this.error({ start: brace, end: this.pos }, "incomplete escape sequence, reached end of pattern prematurely");
			end = this.pos;
			this.bumpAndBumpSpace();
			if (hex === "") this.error({ start: brace, end: this.pos }, "hexadecimal literal empty");
		} else {
			start = this.pos;
			for (let i = 0; i < digits; i++) {
				if (i > 0 && !this.bumpAndBumpSpace()) this.error(this.here(), "incomplete escape sequence, reached end of pattern prematurely");
				if (!isHex(this.ch())) this.error(this.charSpan(), "invalid hexadecimal digit");
				hex += this.ch();
			}
			this.bumpAndBumpSpace();
			end = this.pos;
		}
		const c = hex.length > 8 ? Infinity : parseInt(hex, 16);
		if (!(c <= 0x10ffff) || (c >= 0xd800 && c <= 0xdfff)) this.error({ start, end }, "hexadecimal literal is not a Unicode scalar value");
		// `\xE9` is a byte where Unicode is off; `\x{100}` and `\u00E9` are characters.
		return { k: "lit", c, byte: byte && c <= 0xff, span: { start, end: this.pos } };
	}

	private parseUnicodeClass(): Prop {
		const neg = this.ch() === "P";
		if (!this.bumpAndBumpSpace()) this.error(this.here(), "incomplete escape sequence, reached end of pattern prematurely");
		if (this.ch() === "{") {
			const start = this.pos + 1;
			let name = "";
			while (this.bumpAndBumpSpace() && this.ch() !== "}") name += this.ch();
			if (this.eof) this.error(this.here(), "incomplete escape sequence, reached end of pattern prematurely");
			this.bump();
			const span = { start, end: this.pos };
			let at = name.indexOf("!=");
			if (at !== -1) return { k: "prop", neg, name: name.slice(0, at), op: "!=", value: name.slice(at + 2), span };
			at = name.indexOf(":");
			if (at === -1) at = name.indexOf("=");
			if (at !== -1) return { k: "prop", neg, name: name.slice(0, at), op: "=", value: name.slice(at + 1), span };
			return { k: "prop", neg, name, span };
		}
		const start = this.pos;
		const c = this.ch();
		if (c === "\\") this.error(this.charSpan(), "invalid Unicode character class");
		this.bumpAndBumpSpace();
		return { k: "prop", neg, name: c, span: { start, end: this.pos } };
	}

	private parseSetClass(): Bracket {
		let union: Item[] = [];
		for (;;) {
			this.bumpSpace();
			if (this.eof) this.unclosedClass();
			if (this.ch() === "[") {
				if (this.classes.length) {
					const ascii = this.asciiClass();
					if (ascii) {
						union.push(ascii);
						continue;
					}
				}
				union = this.pushClassOpen(union);
			} else if (this.ch() === "]") {
				const done = this.popClass(union);
				if (done.k === "bracket") return done;
				union = done.union;
			} else if (this.ch() === "&" && this.peek() === "&") {
				this.pos += 2;
				union = this.pushClassOp("&&", union);
			} else if (this.ch() === "-" && this.peek() === "-") {
				this.pos += 2;
				union = this.pushClassOp("--", union);
			} else if (this.ch() === "~" && this.peek() === "~") {
				this.pos += 2;
				union = this.pushClassOp("~~", union);
			} else {
				union.push(this.setClassRange());
			}
		}
	}

	private unclosedClass(): never {
		for (let i = this.classes.length - 1; i >= 0; i--) {
			const state = this.classes[i];
			if (state.k === "open") this.error({ start: state.start, end: state.end }, "unclosed character class");
		}
		throw new Error("no open character class");
	}

	private setClassRange(): Item {
		const first = this.setClassItem();
		this.bumpSpace();
		if (this.eof) this.unclosedClass();
		if (this.ch() !== "-" || this.peekSpace() === "]" || this.peekSpace() === "-") {
			if (first.k === "lit" || first.k === "perl" || first.k === "prop") return first;
			return this.error(first.span, "invalid escape sequence found in character class");
		}
		if (!this.bumpAndBumpSpace()) this.unclosedClass();
		const second = this.setClassItem();
		if (first.k !== "lit") this.error(first.span, "invalid range boundary, must be a literal");
		if (second.k !== "lit") this.error(second.span, "invalid range boundary, must be a literal");
		const span = { start: first.span.start, end: second.span.end };
		if (first.c > second.c) this.error(span, "invalid character class range, the start must be <= the end");
		return { k: "range", lo: first, hi: second, span };
	}

	private setClassItem(): Primitive {
		if (this.ch() === "\\") return this.parseEscape();
		const lit: Lit = { k: "lit", c: this.ch().codePointAt(0)!, byte: false, span: this.charSpan() };
		this.bump();
		return lit;
	}

	private pushClassOpen(parent: Item[]): Item[] {
		const start = this.pos;
		const unclosed = () => this.error({ start, end: this.pos }, "unclosed character class");
		if (!this.bumpAndBumpSpace()) unclosed();
		let neg = false;
		if (this.ch() === "^") {
			neg = true;
			if (!this.bumpAndBumpSpace()) unclosed();
		}
		const union: Item[] = [];
		while (this.ch() === "-") {
			union.push({ k: "lit", c: 45, byte: false, span: this.charSpan() });
			if (!this.bumpAndBumpSpace()) this.error({ start, end: start }, "unclosed character class");
		}
		if (union.length === 0 && this.ch() === "]") {
			union.push({ k: "lit", c: 93, byte: false, span: this.charSpan() });
			if (!this.bumpAndBumpSpace()) unclosed();
		}
		this.classes.push({ k: "open", union: parent, neg, start, end: this.pos });
		return union;
	}

	private popClass(union: Item[]): Bracket | { k: "nested"; union: Item[] } {
		const set = this.popClassOp({ k: "union", items: union });
		const state = this.classes.pop();
		if (state?.k !== "open") throw new Error("unexpected character class state");
		this.bump();
		const bracket: Bracket = { k: "bracket", neg: state.neg, set, span: { start: state.start, end: this.pos } };
		if (this.classes.length === 0) return bracket;
		state.union.push(bracket);
		return { k: "nested", union: state.union };
	}

	private pushClassOp(op: "&&" | "--" | "~~", union: Item[]): Item[] {
		const lhs = this.popClassOp({ k: "union", items: union });
		this.classes.push({ k: "op", op, lhs });
		return [];
	}

	private popClassOp(rhs: SetAst): SetAst {
		const top = this.classes[this.classes.length - 1];
		if (top?.k !== "op") return rhs;
		this.classes.pop();
		return { k: "op", op: top.op, lhs: top.lhs, rhs };
	}

	/** `[:alpha:]` inside a class, or nothing (and the parser back where it was) when it isn't one. */
	private asciiClass(): Item | undefined {
		const start = this.pos;
		const back = () => {
			this.pos = start;
			return undefined;
		};
		if (!this.bump() || this.ch() !== ":") return back();
		if (!this.bump()) return back();
		let neg = false;
		if (this.ch() === "^") {
			neg = true;
			if (!this.bump()) return back();
		}
		const nameStart = this.pos;
		while (this.ch() !== ":" && this.bump()) { /* to the colon */ }
		if (this.eof) return back();
		const name = this.cs.slice(nameStart, this.pos).join("");
		if (!this.bumpIf(":]")) return back();
		if (!Object.hasOwn(ASCII_CLASSES, name)) return back();
		return { k: "ascii", name, neg, span: { start, end: this.pos } };
	}
}

function asConcat(asts: Ast[]): Ast {
	if (asts.length === 0) return { k: "empty" };
	return asts.length === 1 ? asts[0] : { k: "concat", asts };
}

/** What `items` set `flag` to, if they mention it. */
function flagState(items: FlagItem[], flag: string): boolean | undefined {
	let on = true;
	for (const item of items) {
		if (item.flag === "-") on = false;
		else if (item.flag === flag) return on;
	}
	return undefined;
}

/** The crate's error: `regex parse error:`, the pattern with carets under `span` (and `aux`), and `error: <message>`. */
function formatError(cs: string[], span: Span, message: string, aux?: Span): string {
	const pattern = cs.join("");
	const position = (index: number) => {
		let line = 1, column = 1;
		for (let i = 0; i < index && i < cs.length; i++) {
			if (cs[i] === "\n") {
				line++;
				column = 1;
			} else column++;
		}
		return { line, column };
	};
	// Rust's `str::lines`: no empty line after a final `\n`, and no `\r` before one.
	const lines = pattern.split("\n");
	if (lines[lines.length - 1] === "") lines.pop();
	for (let i = 0; i < lines.length; i++) if (lines[i].endsWith("\r")) lines[i] = lines[i].slice(0, -1);
	const lineCount = lines.length + (pattern.endsWith("\n") ? 1 : 0);
	const width = lineCount <= 1 ? 0 : String(lineCount).length;
	const byLine: Array<Array<{ start: { line: number; column: number }; end: { line: number; column: number }; offset: number }>> = Array.from({ length: Math.max(lineCount, 1) }, () => []);
	const multi: Array<{ start: { line: number; column: number }; end: { line: number; column: number } }> = [];
	for (const s of aux ? [span, aux] : [span]) {
		const start = position(s.start), end = position(s.end);
		if (start.line === end.line) {
			byLine[start.line - 1]?.push({ start, end, offset: s.start });
			byLine[start.line - 1]?.sort((a, b) => a.offset - b.offset);
		} else multi.push({ start, end });
	}
	let notated = "";
	lines.forEach((line, i) => {
		notated += width > 0 ? `${String(i + 1).padStart(width)}: ` : "    ";
		notated += `${line}\n`;
		const spans = byLine[i];
		if (spans?.length) {
			let notes = " ".repeat(width === 0 ? 4 : 2 + width);
			let pos = 0;
			for (const s of spans) {
				for (; pos < s.start.column - 1; pos++) notes += " ";
				const len = Math.max(1, s.end.column - s.start.column);
				notes += "^".repeat(len);
				pos += len;
			}
			notated += `${notes}\n`;
		}
	});
	if (pattern.includes("\n")) {
		const divider = "~".repeat(79);
		let out = `regex parse error:\n${divider}\n${notated}${divider}\n`;
		if (multi.length) out += `${multi.map((s) => `on line ${s.start.line} (column ${s.start.column}) through line ${s.end.line} (column ${s.end.column - 1})`).join("\n")}\n`;
		return `${out}error: ${message}`;
	}
	return `regex parse error:\n${notated}error: ${message}`;
}

// ---- the translation (regex-syntax's `hir::translate`) -------------------------------------

/** How a character is compared: exactly, by Unicode's simple case folding, or by ASCII's. */
type Case = 0 | 1 | 2;
type CSet = { k: "u"; neg: boolean; items: CItem[] } | { k: "op"; neg: boolean; op: "&&" | "--" | "~~"; a: CSet; b: CSet };
/** A range of characters, a property (JavaScript's `\p{...}` or a class; `folds` when case folding adds to it), or a nested set. */
type CItem = { k: "r"; lo: number; hi: number } | { k: "p"; js: string; folds: boolean; span: Span } | { k: "s"; set: CSet };
type Ir =
	| { k: "lit"; c: number; ci: Case }
	| { k: "set"; set: CSet; ci: Case }
	| { k: "raw"; js: string }
	| { k: "group"; capture: boolean; body: Ir }
	| { k: "alt"; items: Ir[] }
	| { k: "cat"; items: Ir[] }
	| { k: "rep"; body: Ir; min: number; max: number; greedy: boolean };

interface Flags { i: boolean; m: boolean; s: boolean; U: boolean; u: boolean; R: boolean }

/** `\w` with Unicode: Alphabetic, marks, decimal digits, connector punctuation and the joiners. */
const WORD = "[\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\p{Join_Control}]";
const ASCII_WORD = "[0-9A-Za-z_]";

function translate(ast: Ast, parser: Parser): Ir {
	const fail = (span: Span, message: string): never => parser.error(span, message);
	const tr = (ast: Ast, flags: Flags): Ir => {
		switch (ast.k) {
			case "empty": return { k: "cat", items: [] };
			// A branch of an alternation can be flags alone (`(?i)|b`); they last to the end of the group.
			case "flags": apply(flags, ast.items); return { k: "cat", items: [] };
			case "concat": {
				const items: Ir[] = [];
				for (const a of ast.asts) {
					if (a.k === "flags") apply(flags, a.items);
					else items.push(tr(a, flags));
				}
				return { k: "cat", items };
			}
			case "alt": return { k: "alt", items: ast.asts.map((a) => tr(a, flags)) };
			case "group": {
				const inner = { ...flags };
				if (ast.flags) apply(inner, ast.flags);
				return { k: "group", capture: ast.capture, body: tr(ast.ast, inner) };
			}
			case "rep": return { k: "rep", body: tr(ast.ast, flags), min: ast.min, max: ast.max, greedy: ast.greedy !== flags.U };
			case "lit": {
				if (!flags.u && ast.byte && ast.c > 0x7f) fail(ast.span, "pattern can match invalid UTF-8");
				return { k: "lit", c: ast.c, ci: flags.i ? (flags.u ? 1 : 2) : 0 };
			}
			case "dot": {
				if (!flags.u) fail(ast.span, "pattern can match invalid UTF-8");
				return { k: "raw", js: flags.s ? "[\\u{0}-\\u{10ffff}]" : flags.R ? "[^\\n\\r]" : "[^\\n]" };
			}
			case "look": {
				return { k: "raw", js: look(ast.kind, flags) };
			}
			case "perl": {
				if (!flags.u && ast.neg) fail(ast.span, "pattern can match invalid UTF-8");
				return { k: "set", set: { k: "u", neg: false, items: [perl(ast, flags.u)] }, ci: flags.i ? (flags.u ? 1 : 2) : 0 };
			}
			case "prop": {
				if (!flags.u) fail(ast.span, "Unicode not allowed here");
				return { k: "set", set: { k: "u", neg: false, items: [property(ast, fail)] }, ci: flags.i ? 1 : 0 };
			}
			case "bracket": {
				if (!flags.u) return { k: "set", set: byteSet(ast, flags.i, fail), ci: flags.i ? 2 : 0 };
				return { k: "set", set: unicodeSet(ast.set, ast.neg, fail), ci: flags.i ? 1 : 0 };
			}
		}
	};
	return tr(ast, { i: false, m: false, s: false, U: false, u: true, R: false });
}

function apply(flags: Flags, items: FlagItem[]): void {
	let on = true;
	for (const item of items) {
		if (item.flag === "-") on = false;
		else if (item.flag !== "x") flags[item.flag as keyof Flags] = on;
	}
}

/** An assertion as JavaScript, in a group of its own so that it can be repeated as the crate allows (`\b+`). */
function look(kind: Look, flags: Flags): string {
	const w = flags.u ? WORD : ASCII_WORD;
	switch (kind) {
		case "start": return "(?:^)";
		case "end": return "(?:$)";
		// JavaScript's `m` would also break lines at `\r` and U+2028.
		case "startLine": return !flags.m ? "(?:^)" : flags.R ? "(?:^|(?<=\\n)|(?<=\\r)(?!\\n))" : "(?<![^\\n])";
		case "endLine": return !flags.m ? "(?:$)" : flags.R ? "(?:$|(?=\\r)|(?<!\\r)(?=\\n))" : "(?![^\\n])";
		case "word": return `(?:(?<=${w})(?!${w})|(?<!${w})(?=${w}))`;
		case "notWord": return `(?:(?<=${w})(?=${w})|(?<!${w})(?!${w}))`;
		case "wordStart": return `(?:(?<!${w})(?=${w}))`;
		case "wordEnd": return `(?:(?<=${w})(?!${w}))`;
		case "wordStartHalf": return `(?:(?<!${w}))`;
		case "wordEndHalf": return `(?:(?!${w}))`;
	}
}

function perl(p: Perl, unicode: boolean): CItem {
	const sets = unicode ? { d: "\\p{Nd}", s: "\\p{White_Space}", w: WORD } : { d: "[0-9]", s: "[\\t\\n\\v\\f\\r ]", w: ASCII_WORD };
	let js = sets[p.kind];
	if (p.neg) js = js.startsWith("\\p") ? `\\P${js.slice(2)}` : `[^${js.slice(1)}`;
	return { k: "p", js, folds: false, span: p.span };
}

function unicodeSet(set: SetAst, neg: boolean, fail: (span: Span, message: string) => never): CSet {
	if (set.k === "op") return { k: "op", neg, op: set.op, a: unicodeSet(set.lhs, false, fail), b: unicodeSet(set.rhs, false, fail) };
	const items: CItem[] = set.items.map((item): CItem => {
		switch (item.k) {
			case "lit": return { k: "r", lo: item.c, hi: item.c };
			case "range": return { k: "r", lo: item.lo.c, hi: item.hi.c };
			case "ascii": return { k: "s", set: { k: "u", neg: item.neg, items: ASCII_CLASSES[item.name].map(([lo, hi]) => ({ k: "r", lo, hi })) } };
			case "perl": return perl(item, true);
			case "prop": return property(item, fail);
			case "bracket": return { k: "s", set: unicodeSet(item.set, item.neg, fail) };
		}
	});
	return { k: "u", neg, items };
}

/**
 * A class with Unicode off (`(?-u)`): a set of bytes, which a pattern for text can only use if
 * they're all ASCII, as the crate checks. Its case folding (ASCII's) is done here.
 */
function byteSet(bracket: Bracket, fold: boolean, fail: (span: Span, message: string) => never): CSet {
	const evaluate = (set: SetAst): boolean[] => {
		if (set.k === "op") {
			const a = evaluate(set.lhs), b = evaluate(set.rhs);
			return a.map((x, i) => (set.op === "&&" ? x && b[i] : set.op === "--" ? x && !b[i] : x !== b[i]));
		}
		const out = new Array<boolean>(256).fill(false);
		const add = (lo: number, hi: number) => {
			for (let i = lo; i <= hi; i++) out[i] = true;
		};
		const byte = (lit: Lit) => {
			if (lit.byte && lit.c > 0x7f) fail(lit.span, "pattern can match invalid UTF-8");
			return lit.byte || lit.c <= 0x7f ? lit.c : fail(lit.span, "Unicode not allowed here");
		};
		for (const item of set.items) {
			switch (item.k) {
				case "lit": add(byte(item), byte(item)); break;
				case "range": add(byte(item.lo), byte(item.hi)); break;
				case "ascii": {
					const inner = new Array<boolean>(256).fill(false);
					for (const [lo, hi] of ASCII_CLASSES[item.name]) for (let i = lo; i <= hi; i++) inner[i] = true;
					inner.forEach((x, i) => { if (x !== item.neg) out[i] = true; });
					break;
				}
				case "perl": {
					const ranges = { d: [[48, 57]], s: [[9, 13], [32, 32]], w: ASCII_CLASSES.word }[item.kind];
					const inner = new Array<boolean>(256).fill(false);
					for (const [lo, hi] of ranges) for (let i = lo; i <= hi; i++) inner[i] = true;
					inner.forEach((x, i) => { if (x !== item.neg) out[i] = true; });
					break;
				}
				case "prop": fail(item.span, "Unicode not allowed here"); break;
				case "bracket": bracketBytes(item).forEach((x, i) => { if (x) out[i] = true; }); break;
			}
		}
		return out;
	};
	const bracketBytes = (b: Bracket): boolean[] => {
		let bytes = evaluate(b.set);
		if (fold) bytes = bytes.map((x, i) => x || (i >= 65 && i <= 90 && bytes[i + 32]) || (i >= 97 && i <= 122 && bytes[i - 32]));
		if (b.neg) bytes = bytes.map((x) => !x);
		if (bytes.some((x, i) => x && i > 0x7f)) fail(b.span, "pattern can match invalid UTF-8");
		return bytes;
	};
	const bytes = bracketBytes(bracket);
	const items: CItem[] = [];
	for (let i = 0; i < 128; i++) {
		if (!bytes[i]) continue;
		let j = i;
		while (j + 1 < 128 && bytes[j + 1]) j++;
		items.push({ k: "r", lo: i, hi: j });
		i = j;
	}
	return { k: "u", neg: false, items };
}

// ---- Unicode properties -------------------------------------------------------------------

/** The crate's `symbolic_name_normalize`: ASCII letters in lower case, without spaces, `_` and `-` (and an `is` in front). */
function normalize(name: string): string {
	let text = name;
	const is = /^is/i.test(text);
	if (is) text = text.slice(2);
	let out = "";
	for (const ch of text) {
		if (ch === " " || ch === "_" || ch === "-") continue;
		const code = ch.codePointAt(0)!;
		if (code >= 65 && code <= 90) out += ch.toLowerCase();
		else if (code <= 0x7f) out += ch;
	}
	return is && out === "c" ? "isc" : out;
}

/** A table written `Canonical alias alias|...`, by normalized name. */
function table(text: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const entry of text.split("|")) {
		const [canonical, ...aliases] = entry.split(" ");
		out.set(normalize(canonical), canonical);
		for (const alias of aliases) out.set(alias, canonical);
	}
	return out;
}

/** The crate's binary properties (Unicode 16), with their aliases. */
const BINARY = table("ASCII_Hex_Digit ahex|Alphabetic alpha|Bidi_Control bidic|Bidi_Mirrored bidim|Cased|Case_Ignorable ci|Changes_When_Casefolded cwcf|Changes_When_Casemapped cwcm|Changes_When_Lowercased cwl|Changes_When_Titlecased cwt|Changes_When_Uppercased cwu|Dash|Default_Ignorable_Code_Point di|Deprecated dep|Diacritic dia|Emoji_Modifier_Base ebase|Emoji_Component ecomp|Emoji_Modifier emod|Emoji|Emoji_Presentation epres|Extender ext|Extended_Pictographic extpict|Grapheme_Base grbase|Grapheme_Extend grext|Grapheme_Link grlink|Hex_Digit hex|Hyphen|ID_Continue idc|ID_Compat_Math_Continue|ID_Compat_Math_Start|Ideographic ideo|ID_Start ids|IDS_Binary_Operator idsb|IDS_Trinary_Operator idst|IDS_Unary_Operator idsu|Join_Control joinc|Logical_Order_Exception loe|Lowercase lower|Math|Modifier_Combining_Mark mcm|Noncharacter_Code_Point nchar|Other_Alphabetic oalpha|Other_Default_Ignorable_Code_Point odi|Other_Grapheme_Extend ogrext|Other_ID_Continue oidc|Other_ID_Start oids|Other_Lowercase olower|Other_Math omath|Other_Uppercase oupper|Pattern_Syntax patsyn|Pattern_White_Space patws|Prepended_Concatenation_Mark pcm|Quotation_Mark qmark|Radical|Regional_Indicator ri|Soft_Dotted sd|Sentence_Terminal sterm|White_Space space wspace|Terminal_Punctuation term|Unified_Ideograph uideo|Uppercase upper|Variation_Selector vs|XID_Continue xidc|XID_Start xids");
/** The binary properties the crate has and JavaScript doesn't. */
const NOT_IN_JAVASCRIPT = new Set(["Grapheme_Link", "Hyphen", "ID_Compat_Math_Continue", "ID_Compat_Math_Start", "IDS_Unary_Operator", "Modifier_Combining_Mark", "Other_Alphabetic", "Other_Default_Ignorable_Code_Point", "Other_Grapheme_Extend", "Other_ID_Continue", "Other_ID_Start", "Other_Lowercase", "Other_Math", "Other_Uppercase", "Prepended_Concatenation_Mark"]);
/** General categories, with their aliases, and the three the crate keeps with them. */
const CATEGORIES = table("Other c|Cased_Letter lc|Control cc cntrl|Format cf|Close_Punctuation pe|Unassigned cn|Private_Use co|Mark m combiningmark|Connector_Punctuation pc|Surrogate cs|Currency_Symbol sc|Dash_Punctuation pd|Decimal_Number nd digit|Enclosing_Mark me|Final_Punctuation pf|Initial_Punctuation pi|Letter l|Letter_Number nl|Line_Separator zl|Lowercase_Letter ll|Modifier_Letter lm|Other_Letter lo|Titlecase_Letter lt|Uppercase_Letter lu|Math_Symbol sm|Spacing_Mark mc|Nonspacing_Mark mn|Modifier_Symbol sk|Number n|Other_Number no|Open_Punctuation ps|Other_Punctuation po|Other_Symbol so|Punctuation p punct|Paragraph_Separator zp|Symbol s|Separator z|Space_Separator zs");
const SPECIAL: Record<string, string> = { any: "Any", assigned: "Assigned", ascii: "ASCII" };
/** The crate's other properties, by normalized name: it knows them, and has no table for them. */
const OTHER_PROPERTIES = new Set("age bc bidiclass bidimirroringglyph bidipairedbracket bidipairedbrackettype blk block bmg bpb bpt canonicalcombiningclass casefolding ccc ce cf changeswhennfkccasefolded cjkaccountingnumeric cjkcompatibilityvariant cjkiicore cjkirggsource cjkirghsource cjkirgjsource cjkirgkpsource cjkirgksource cjkirgmsource cjkirgssource cjkirgtsource cjkirguksource cjkirgusource cjkirgvsource cjkothernumeric cjkprimarynumeric cjkrsunicode compex compositionexclusion cwkcf decompositionmapping decompositiontype dm dt ea eastasianwidth equideo equivalentunifiedideograph expandsonnfc expandsonnfd expandsonnfkc expandsonnfkd fcnfkc fcnfkcclosure fullcompositionexclusion gc gcb generalcategory graphemeclusterbreak hangulsyllabletype hst incb indicconjunctbreak indicpositionalcategory indicsyllabiccategory inpc insc isc jamoshortname jg joininggroup joiningtype jsn jt kaccountingnumeric kcompatibilityvariant kehcat kehdesc kehhg kehifao kehjsesh kehnomirror kehnorotate kiicore kirggsource kirghsource kirgjsource kirgkpsource kirgksource kirgmsource kirgssource kirgtsource kirguksource kirgusource kirgvsource kothernumeric kprimarynumeric krsunicode lb lc linebreak lowercasemapping na na1 name namealias nfcqc nfcquickcheck nfdqc nfdquickcheck nfkccasefold nfkccf nfkcqc nfkcquickcheck nfkcscf nfkcsimplecasefold nfkdqc nfkdquickcheck nt numerictype numericvalue nv ocomment sb sc scf script scriptextensions scx sentencebreak sfc simplecasefolding simplelowercasemapping simpletitlecasemapping simpleuppercasemapping slc stc suc tc titlecasemapping uc unicode1name unicoderadicalstroke uppercasemapping urs verticalorientation vo wb wordbreak xonfc xonfd xonfkc xonfkd".split(" "));
/** Scripts whose names have more than one word, by normalized name, so that `olditalic` finds `Old_Italic` as the crate does. */
const SCRIPTS = new Map("Caucasian_Albanian Anatolian_Hieroglyphs Imperial_Aramaic Bassa_Vah Canadian_Aboriginal Cypro_Minoan Dives_Akuru Egyptian_Hieroglyphs Gunjala_Gondi Masaram_Gondi Gurung_Khema Hanifi_Rohingya Pahawh_Hmong Nyiakeng_Puachue_Hmong Katakana_Or_Hiragana Old_Hungarian Inscriptional_Pahlavi Inscriptional_Parthian Old_Italic Kayah_Li Khitan_Small_Script Kirat_Rai Tai_Tham Linear_A Linear_B Meetei_Mayek Mende_Kikakui Meroitic_Cursive Meroitic_Hieroglyphs Nag_Mundari Old_North_Arabian New_Tai_Lue Ol_Chiki Old_Permic Old_Persian Old_Sogdian Old_South_Arabian Old_Turkic Old_Uyghur Ol_Onal Pau_Cin_Hau Phags_Pa Psalter_Pahlavi SignWriting Sora_Sompeng Syloti_Nagri Tai_Le Tai_Viet Tulu_Tigalari Warang_Citi Zanabazar_Square".split(" ").map((name) => [normalize(name), name]));
/** Properties with values the crate has and JavaScript doesn't. */
const VALUED: Record<string, string> = { age: "Age", gcb: "Grapheme_Cluster_Break", graphemeclusterbreak: "Grapheme_Cluster_Break", wb: "Word_Break", wordbreak: "Word_Break", sb: "Sentence_Break", sentencebreak: "Sentence_Break" };

const valid = (js: string) => {
	try {
		new RegExp(js, "v");
		return true;
	} catch {
		return false;
	}
};

/** A script's name as JavaScript writes it, from how the pattern wrote it (`greek`, `Old_Italic`, `old italic`, `Grek`). */
function script(name: string, property: string): string | undefined {
	// The crate knows the Unknown script (unassigned code points) by name, but has no table for it.
	const words = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1_$2").split(/[\s_-]+/).filter((w) => w !== "").map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("_");
	const bare = name.replace(/^is[\s_-]?/i, "");
	for (const candidate of [SCRIPTS.get(normalize(name)) ?? name, words(name), bare, words(bare)]) {
		if (candidate === "Unknown" || candidate === "Zzzz") return "Unknown";
		if (candidate !== "" && /^[A-Za-z_]+$/.test(candidate) && valid(`\\p{${property}=${candidate}}`)) return candidate;
	}
	return undefined;
}

/** `\p{...}` as JavaScript's, or the crate's error for a name it doesn't know, or one for a property JavaScript lacks. */
function property(p: Prop, fail: (span: Span, message: string) => never): CItem {
	const missing = (name: string) => fail(p.span, `Unicode property ${name} isn't in JavaScript's regular expressions`);
	const category = (n: string) => (SPECIAL[n] ? SPECIAL[n] : CATEGORIES.has(n) ? `General_Category=${CATEGORIES.get(n)}` : undefined);
	let js: string | undefined;
	let neg = p.neg;
	if (p.value === undefined) {
		const n = normalize(p.name);
		const reserved = n === "cf" || n === "sc" || n === "lc";
		const binary = reserved ? undefined : BINARY.get(n);
		if (binary === undefined && !reserved && OTHER_PROPERTIES.has(n)) fail(p.span, "Unicode property not found");
		if (binary !== undefined) {
			if (NOT_IN_JAVASCRIPT.has(binary)) missing(binary);
			js = binary;
		} else {
			js = category(n);
			const sc = js === undefined ? script(p.name, "Script") : undefined;
			if (sc === "Unknown") fail(p.span, "Unicode property value not found");
			if (sc !== undefined) js = `Script=${sc}`;
		}
		if (js === undefined) fail(p.span, "Unicode property not found");
	} else {
		if (p.op === "!=") neg = !neg;
		const name = normalize(p.name);
		const value = normalize(p.value);
		const extensions = name === "scx" || name === "scriptextensions";
		if (name === "gc" || name === "generalcategory") js = category(value);
		else if (extensions || name === "sc" || name === "script") {
			const property = extensions ? "Script_Extensions" : "Script";
			const sc = script(p.value.trim(), property);
			if (sc !== undefined && sc !== "Unknown") js = `${property}=${sc}`;
		} else if (VALUED[name]) missing(VALUED[name]);
		else if (!BINARY.has(name) && !OTHER_PROPERTIES.has(name)) fail(p.span, "Unicode property not found");
		if (js === undefined) fail(p.span, "Unicode property value not found");
	}
	const text = `\\${neg ? "P" : "p"}{${js}}`;
	return { k: "p", js: text, folds: true, span: p.span };
}

// ---- writing the JavaScript -----------------------------------------------------------------

/** Whether this Node has flag groups, `(?i:...)` (V8 12.5, Node 23). */
const MODIFIERS = valid("(?i:a)");

/**
 * The RegExp for `ir`. Case-insensitive parts are matched with JavaScript's `i` flag when the
 * whole pattern is, with flag groups where only some is, and on a Node without flag groups by
 * spelling out the characters each one folds to.
 */
function emit(ir: Ir, parser: Parser, extra: string, flagGroups: boolean): RegExp {
	const atoms: Case[] = [];
	const collect = (n: Ir) => {
		if (n.k === "lit" || n.k === "set") atoms.push(n.ci);
		else if (n.k === "group" || n.k === "rep") collect(n.body);
		else if (n.k === "alt" || n.k === "cat") n.items.forEach(collect);
	};
	collect(ir);
	const mode = atoms.length > 0 && atoms.every((ci) => ci === 1) ? "flag" : flagGroups ? "groups" : "spell";
	const fail = (span: Span, message: string): never => parser.error(span, message);
	const write = (n: Ir): string => {
		switch (n.k) {
			case "lit":
				if (n.ci === 2) return asciiFolded(n.c);
				if (n.ci === 0 || mode === "flag") return esc(n.c);
				return mode === "groups" ? `(?i:${esc(n.c)})` : folded(n.c);
			case "set":
				if (n.ci === 1 && mode === "groups") return `(?i:${setText(n.set, false, fail)})`;
				return setText(n.set, n.ci === 1 && mode === "spell", fail);
			case "raw": return n.js;
			case "group": return `(${n.capture ? "" : "?:"}${write(n.body)})`;
			case "alt": return n.items.map(write).join("|");
			case "cat": return n.items.map(write).join("");
			case "rep": {
				const body = n.body.k === "lit" || n.body.k === "set" || n.body.k === "group" ? write(n.body) : `(?:${write(n.body)})`;
				const quantifier = n.min === 0 && n.max === Infinity ? "*" : n.min === 1 && n.max === Infinity ? "+" : n.min === 0 && n.max === 1 ? "?" : n.max === Infinity ? `{${n.min},}` : n.min === n.max ? `{${n.min}}` : `{${n.min},${n.max}}`;
				return `${body}${quantifier}${n.greedy ? "" : "?"}`;
			}
		}
	};
	const source = write(ir);
	try {
		return new RegExp(source, `v${mode === "flag" ? "i" : ""}${extra}`);
	} catch (e) {
		return parser.error({ start: 0, end: parser.cs.length }, (e as Error).message);
	}
}

/** A character in a pattern: letters and digits as they are, the rest as `\u{...}`, which reads the same inside a class and out. */
function esc(c: number): string {
	return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) ? String.fromCodePoint(c) : `\\u{${c.toString(16)}}`;
}

function setText(set: CSet, fold: boolean, fail: (span: Span, message: string) => never): string {
	if (set.k === "op") {
		const a = setText(set.a, fold, fail), b = setText(set.b, fold, fail);
		return `[${set.neg ? "^" : ""}${set.op === "~~" ? `[${a}--${b}][${b}--${a}]` : `${a}${set.op}${b}`}]`;
	}
	let body = "";
	for (const item of set.items) {
		if (item.k === "s") body += setText(item.set, fold, fail);
		else if (item.k === "p") {
			if (fold && item.folds) fail(item.span, "matching a Unicode property without regard to case in only part of a pattern needs Node 23 or newer; put (?i) at the start of the pattern instead");
			body += item.js;
		} else {
			body += item.lo === item.hi ? esc(item.lo) : `${esc(item.lo)}-${esc(item.hi)}`;
			if (fold) {
				const extra = new Set<number>();
				for (let c = item.lo; c <= item.hi; c++) for (const o of orbit(c)) if (o < item.lo || o > item.hi) extra.add(o);
				for (const o of [...extra].sort((x, y) => x - y)) body += esc(o);
			}
		}
	}
	return `[${set.neg ? "^" : ""}${body}]`;
}

/** Code points whose simple case folding lower- and upper-casing don't reach (the Kelvin sign from `k`, long s from `s`, final sigma, titlecase digraphs). */
const UNREACHED = [0xb5, 0x17f, 0x1c5, 0x1c8, 0x1cb, 0x1f2, 0x345, 0x390, 0x3b0, 0x3c2, 0x3d0, 0x3d1, 0x3d5, 0x3d6, 0x3f0, 0x3f1, 0x3f4, 0x3f5, 0x1c80, 0x1c81, 0x1c82, 0x1c83, 0x1c84, 0x1c85, 0x1c86, 0x1c87, 0x1c88, 0x1e9b, 0x1e9e, 0x1f88, 0x1f89, 0x1f8a, 0x1f8b, 0x1f8c, 0x1f8d, 0x1f8e, 0x1f8f, 0x1f98, 0x1f99, 0x1f9a, 0x1f9b, 0x1f9c, 0x1f9d, 0x1f9e, 0x1f9f, 0x1fa8, 0x1fa9, 0x1faa, 0x1fab, 0x1fac, 0x1fad, 0x1fae, 0x1faf, 0x1fbc, 0x1fbe, 0x1fcc, 0x1fd3, 0x1fe3, 0x1ffc, 0x2126, 0x212a, 0x212b, 0xfb05, 0xfb06];
const UNREACHED_SET = new Set(UNREACHED);

/** The characters that match `c` without regard to case, as V8's `i` flag decides it (Unicode's simple case folding, which the crate uses too). */
function orbit(c: number): number[] {
	const ch = String.fromCodePoint(c);
	if (ch.toLowerCase() === ch && ch.toUpperCase() === ch && !UNREACHED_SET.has(c)) return [c];
	const seen = new Set([c]);
	const queue = [ch];
	while (queue.length) {
		const x = queue.pop()!;
		for (const y of [x.toLowerCase(), x.toUpperCase()]) {
			const cp = y.codePointAt(0)!;
			if (y === String.fromCodePoint(cp) && !seen.has(cp)) {
				seen.add(cp);
				queue.push(y);
			}
		}
	}
	for (const u of UNREACHED) seen.add(u);
	const same = new RegExp(`^${esc(c)}$`, "iv");
	return [...seen].filter((x) => x === c || same.test(String.fromCodePoint(x))).sort((a, b) => a - b);
}

function folded(c: number): string {
	const all = orbit(c);
	return all.length === 1 ? esc(c) : `[${all.map(esc).join("")}]`;
}

function asciiFolded(c: number): string {
	if (c >= 65 && c <= 90) return `[${esc(c)}${esc(c + 32)}]`;
	if (c >= 97 && c <= 122) return `[${esc(c - 32)}${esc(c)}]`;
	return esc(c);
}
