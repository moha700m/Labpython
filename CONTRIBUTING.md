# Contributing

1. Branch from `main` (`feature/...`, `fix/...`). `main` is for stable releases.
2. Keep the rules of the product: never present an unimplemented feature as working, never run
   user code outside a worker sandbox, never commit secrets.
3. Before opening a PR: `pnpm lint && pnpm typecheck && pnpm test:unit` and, when you touch the
   build/run path, `pnpm test:security && pnpm test:integration`.
4. UI text is Arabic (RTL, logical CSS properties); code and identifiers are English.
5. Update `PROJECT_STATE.md` and `CHANGELOG.md` when a phase or feature changes status.
6. Commits: short imperative subject (`feat: …`, `fix: …`, `docs: …`, `test: …`).
