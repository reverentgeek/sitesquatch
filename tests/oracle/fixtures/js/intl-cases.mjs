// en-US date and number formatting cases checked against Node. Regenerate the
// expected output with:
//   node crates/sitesquatch-js/tests/fixtures/intl-cases.mjs > crates/sitesquatch-js/tests/fixtures/intl-expected.json
const dates = [Date.UTC(2026, 2, 14), Date.UTC(2026, 2, 14, 13, 5, 9), Date.UTC(1999, 11, 31, 23, 59, 59), Date.UTC(2024, 0, 1, 0, 0, 0), Date.UTC(2025, 6, 4, 12, 30, 0), Date.UTC(2003, 8, 9, 7, 8, 0)].map((t) => new Date(t));
const U = { timeZone: "UTC" };
const optionSets = [
  {},
  { year: "numeric", month: "long", day: "numeric" },
  { year: "numeric", month: "short", day: "numeric" },
  { year: "numeric", month: "narrow", day: "numeric" },
  { year: "numeric", month: "2-digit", day: "2-digit" },
  { year: "2-digit", month: "numeric", day: "numeric" },
  { month: "long", day: "numeric" },
  { month: "long", year: "numeric" },
  { month: "short" },
  { year: "numeric" },
  { day: "numeric" },
  { month: "numeric", day: "numeric" },
  { month: "numeric", year: "numeric" },
  { weekday: "long" },
  { weekday: "short", year: "numeric", month: "short", day: "numeric" },
  { weekday: "long", year: "numeric", month: "long", day: "numeric" },
  { weekday: "long", month: "long", day: "numeric" },
  { weekday: "short", month: "numeric", day: "numeric", year: "numeric" },
  { dateStyle: "full" }, { dateStyle: "long" }, { dateStyle: "medium" }, { dateStyle: "short" },
  { timeStyle: "short" }, { timeStyle: "medium" },
  { dateStyle: "long", timeStyle: "short" }, { dateStyle: "medium", timeStyle: "short" }, { dateStyle: "short", timeStyle: "short" }, { dateStyle: "full", timeStyle: "medium" },
  { hour: "numeric" }, { hour: "numeric", minute: "2-digit" }, { hour: "2-digit", minute: "2-digit" }, { hour: "numeric", minute: "2-digit", second: "2-digit" },
  { hour: "numeric", minute: "2-digit", hour12: false },
  { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" },
  { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" },
];
const out = { toLocaleDateString: [], toLocaleTimeString: [], toLocaleString: [], DateTimeFormat: [] };
for (const d of dates) {
  for (const o of optionSets) {
    const opts = { ...o, ...U };
    const run = (fn) => { try { return fn(); } catch (e) { return `${e.name}`; } };
    out.toLocaleDateString.push(run(() => d.toLocaleDateString("en-US", opts)));
    out.toLocaleTimeString.push(run(() => d.toLocaleTimeString("en-US", opts)));
    out.toLocaleString.push(run(() => d.toLocaleString("en-US", opts)));
    out.DateTimeFormat.push(run(() => new Intl.DateTimeFormat("en-US", opts).format(d)));
  }
}
out.noLocale = dates.map((d) => d.toLocaleDateString(undefined, { ...U, month: "long", day: "numeric", year: "numeric" }));
const numbers = [0, 1, -1, 12, 999, 1000, 1234.5, 1234567.891, -9876543.21, 0.1 + 0.2, 1e21 / 1e6, 0.0005, -0.0004, 42.125];
out.numbers = numbers.map((n) => n.toLocaleString("en-US"));
out.numbersMin2 = numbers.map((n) => n.toLocaleString("en-US", { minimumFractionDigits: 2 }));
out.numbersMax0 = numbers.map((n) => n.toLocaleString("en-US", { maximumFractionDigits: 0 }));
out.numbersNoGroup = numbers.map((n) => new Intl.NumberFormat("en-US", { useGrouping: false }).format(n));
export default out;
if (process.argv?.[1]?.endsWith("intl-cases.mjs")) console.log(JSON.stringify(out));
