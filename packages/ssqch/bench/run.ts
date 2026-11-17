// Runs ssqch as `bin/ssqch.ts` does, then says how much memory the process took at its most:
// the benchmark reads that line.
import { main } from "../src/cli.ts";

const code = await main(process.argv.slice(2));
process.stderr.write(`ssqch-bench maxrss ${process.resourceUsage().maxRSS}\n`);
await Promise.all([process.stdout, process.stderr].map((stream) => new Promise((resolve) => stream.write("", resolve))));
process.exit(code);
