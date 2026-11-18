#!/usr/bin/env node
// ssqch: TypeScript that Node 22.18 and newer runs as it is.
import module from "node:module";
import os from "node:os";

// sharp encodes images on libuv's thread pool, one encode per core (`src/image/processor.ts`),
// and page writes go there too: a pool of four would leave pages waiting behind photos. Libuv
// reads this when the pool first starts, so it's set before anything uses it.
process.env.UV_THREADPOOL_SIZE ??= String(os.availableParallelism() + 4);
// Node keeps compiled code for ssqch and its libraries on disk, so the next start skips compiling them.
module.enableCompileCache?.();
const { main, crashed } = await import("../src/cli.ts");
// Something a site's code left behind failed later (a stream's error nobody listens for, a
// promise nobody awaits): said as an error of the build, not as Node's dump of it.
process.on("uncaughtException", crashed);
process.on("unhandledRejection", crashed);
const code = await main(process.argv.slice(2));
// What the site's code left running (a timer, a server) doesn't keep the build alive: the
// output is flushed, and that's the end.
process.exitCode = code;
await Promise.all([process.stdout, process.stderr].map((stream) => new Promise((resolve) => stream.write("", resolve))));
process.exit(code);
