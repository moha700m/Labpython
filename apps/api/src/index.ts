import { buildApp } from "./server.ts";

const app = await buildApp();
const { port, host } = app.ctx.config;
await app.listen({ port, host });
app.log.info(`Muhammad C++ Studio API listening on http://${host}:${port}`);

// Periodically fail jobs whose worker vanished.
setInterval(() => app.ctx.jobs.reapStale(), 30_000).unref();

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    process.exit(0);
  });
}
