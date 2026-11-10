// Sorting with localeCompare and Intl.Collator. collation-expected.txt is
// Node 26's output for these (node -e "import(...)" joining with newlines).
const lists = [
  ["API Changes", "Announcements", "Release Notes", "Tutorials", "api", "Zed", "apple", "Äpfel", "zebra", "_x", "1st", "10th", "2nd", "a b", "ab", "résumé", "resume", "Resume"],
];
const out = [];
for (const l of lists) {
  out.push([...l].sort((a, b) => a.localeCompare(b)).join("|"));
  out.push([...l].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })).join("|"));
  out.push([...l].sort(new Intl.Collator("en", { numeric: true }).compare).join("|"));
  out.push(["a", "A", "á", "b"].map(x => "a".localeCompare(x, "en", { sensitivity: "base" })).join(","));
  out.push(["a", "A", "á", "b"].map(x => "a".localeCompare(x, "en", { sensitivity: "accent" })).join(","));
}
export default out;
