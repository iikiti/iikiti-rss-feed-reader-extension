# JavaScript Tooling Standards
- **Always use `bun`** for all package management and script execution.
- Never use `npm`, `yarn`, or `pnpm`.
- Commands: Use `bun install`, `bun add <package>`, and `bun run <script>`.
- Lockfiles: Prioritize and maintain `bun.lockb`. Ignore `package-lock.json`.