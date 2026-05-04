# Project Structure & Setup Guide

Use this as a reference to recreate a similar monorepo setup.

---

## Overview

Bun-based TypeScript monorepo with four packages:

| Package | Purpose | Runtime | Framework |
|---|---|---|---|
| `packages/core` | Shared types, schemas, DB, business logic | Bun | Zod |
| `packages/server` | HTTP API + WebSocket | Bun | Hono |
| `packages/dashboard` | Frontend SPA | Browser | React 19 + Vite + Tailwind 4 |
| `packages/cli` | CLI entry point & daemon | Bun | (none) |

**Dependency graph:**

```
cli ──> core
server ──> core
dashboard ──> core
```

`core` is the leaf package with no internal dependencies. All internal references use `workspace:*`.

---

## Root Configuration

### package.json

```json
{
  "workspaces": ["packages/*"],
  "scripts": {
    "dev:server": "bun --hot packages/server/src/index.ts",
    "dev:dashboard": "bun run --cwd packages/dashboard dev",
    "build": "bun run build:dashboard && bun run build:server",
    "build:dashboard": "bun run --cwd packages/dashboard build",
    "build:server": "bun run --cwd packages/server build",
    "test": "bun test packages/core && cd packages/cli && bun test && cd ../dashboard && bunx vitest run",
    "format": "prettier --write \"packages/*/src/**/*.{ts,tsx}\"",
    "prepare": "husky"
  },
  "devDependencies": {
    "bun-types": "^1.3.11",
    "husky": "^9.1.7",
    "prettier": "3.8.1",
    "typescript": "^5.8.3",
    "vitest": "^3.1.1"
  }
}
```

### tsconfig.json (root)

Project references model — root only points to packages:

```json
{
  "files": [],
  "references": [
    { "path": "packages/core" },
    { "path": "packages/server" },
    { "path": "packages/dashboard" },
    { "path": "packages/cli" }
  ]
}
```

### tsconfig.base.json (shared compiler options)

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "strictNullChecks": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true
  }
}
```

### vitest.workspace.ts

```ts
export default ["packages/core", "packages/server", "packages/dashboard"];
```

### .prettierrc

```json
{
  "tabWidth": 2,
  "trailingComma": "none",
  "arrowParens": "avoid",
  "printWidth": 160
}
```

No ESLint — Prettier only.

---

## packages/core

**Role:** Shared library — schemas (Zod), database (SQLite), executor logic, types, utilities.

### Key Dependencies

| Dependency | Version | Purpose |
|---|---|---|
| zod | ^3.24.4 | Schema validation |
| bun:sqlite | (built-in) | SQLite database (WAL mode) |

### tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["bun-types"]
  },
  "include": ["src/**/*.ts"]
}
```

### package.json exports

```json
{
  "name": "@glue-paste-dev/core",
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./browser": "./src/browser.ts"
  }
}
```

Two entry points: full `index.ts` for Bun consumers (server, cli) and a `browser.ts` export for the dashboard (excludes Node/Bun-only APIs like SQLite).

### Directory layout

```
src/
  config/       # Config manager
  db/           # SQLite layer (boards, cards, comments, executions, commits)
  executor/     # Execution engine (queue, runner, prompt builder, stream parser)
  schemas/      # Zod schemas (board, card, comment, execution, config, etc.)
  types/        # TypeScript type definitions
  utils/        # Utilities
  browser.ts    # Browser-safe exports (no bun:sqlite)
  index.ts      # Full exports
  logger.ts     # Logging
  __tests__/    # Bun tests
```

### Testing

- Runner: `bun test`
- Command: `cd packages/core && bun test`

---

## packages/server

**Role:** HTTP API + WebSocket server, serves the built dashboard as static files.

### Key Dependencies

| Dependency | Version | Purpose |
|---|---|---|
| hono | ^4.7.6 | HTTP framework |
| @glue-paste-dev/core | workspace:* | Shared logic |

### tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["bun-types"]
  },
  "references": [{ "path": "../core" }]
}
```

### Build

```bash
bun build src/index.ts --outdir dist --target bun
```

Produces a single bundled JS file for distribution.

### Server features

- **Port:** 4242
- **WebSocket:** Real-time events via Hono's `createBunWebSocket`
- **Static files:** Serves built dashboard from `packages/server/public/`
- **CORS:** Restricted to localhost origins only
- **Security headers:** CSP, X-Content-Type-Options, X-Frame-Options

### Directory layout

```
src/
  routes/       # API route handlers (auth, boards, cards, chat, comments,
                #   commits, config, executions, files, queue, stats,
                #   tags, system, update, ai, caffeinate)
  index.ts      # Main server entry point
  caffeinate.ts # macOS caffeinate integration
  callbacks.ts  # Webhook/callback handlers
  __tests__/    # Tests
```

### Testing

- Runner: `bun test` or `bunx vitest run`
- Command: `cd packages/server && bun test`

---

## packages/dashboard

**Role:** React 19 SPA frontend.

### Key Dependencies

| Dependency | Version | Purpose |
|---|---|---|
| react | ^19.1.0 | UI framework |
| react-dom | ^19.1.0 | DOM rendering |
| vite | ^6.3.2 | Bundler & dev server |
| tailwindcss | ^4.1.4 | CSS framework (v4) |
| @tailwindcss/vite | ^4.1.4 | Tailwind Vite plugin |
| @vitejs/plugin-react | ^4.4.1 | React Vite plugin |
| wouter | ^3.7.0 | Client-side routing |
| @dnd-kit/core | ^6.3.1 | Drag-and-drop |
| @dnd-kit/sortable | ^10.0.0 | Sortable drag-and-drop |
| lucide-react | ^0.487.0 | Icons |
| react-markdown | ^10.1.0 | Markdown rendering |
| xterm | ^5.3.0 | Terminal emulator |
| clsx | ^2.1.1 | className utility |
| tailwind-merge | ^3.2.0 | Tailwind class merging |

### tsconfig.json (standalone, does NOT extend base)

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}
```

Note: `noEmit: true` because Vite handles transpilation. The `@/*` path alias maps to `./src/*`.

### vite.config.ts

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4242",
      "/ws": { target: "http://localhost:4242", ws: true }
    }
  },
  build: {
    outDir: "../server/public",
    emptyOutDir: true
  }
});
```

Key points:
- Dev server on **5173**, proxies `/api` and `/ws` to the Bun server on **4242**
- Build output goes directly into `packages/server/public/` so the server can serve it

### Tailwind CSS 4

No `tailwind.config.js` — Tailwind v4 is configured entirely via the Vite plugin and CSS imports:

```css
/* src/index.css */
@import "tailwindcss";
```

### Directory layout

```
src/
  components/   # React components
  hooks/        # Custom React hooks
  lib/          # Utilities and helpers
  pages/        # Page components
  App.tsx        # Root component
  main.tsx       # Entry point
  index.css      # Global styles (Tailwind import)
  test-setup.ts  # Vitest setup
  __tests__/     # Tests
```

### Testing

- Runner: Vitest with jsdom
- Libraries: @testing-library/react, @testing-library/jest-dom
- Command: `cd packages/dashboard && bunx vitest run`

### vitest.config.ts

```ts
{
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    coverage: { provider: "v8" }
  }
}
```

---

## packages/cli

**Role:** CLI binary and daemon management. Runs as a Bun script (no bundling needed — Bun executes TS natively).

### Key Dependencies

| Dependency | Version | Purpose |
|---|---|---|
| @glue-paste-dev/core | workspace:* | Shared logic |

No other runtime dependencies.

### tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["bun-types"]
  },
  "references": [{ "path": "../core" }],
  "exclude": ["src/**/*.test.ts"]
}
```

### package.json bin

```json
{
  "bin": {
    "glue-paste-dev": "./src/index.ts"
  }
}
```

### Directory layout

```
src/
  commands/         # CLI command implementations
  index.ts          # Entry point (bin)
  daemon.ts         # Daemon process management
  daemon-wrapper.ts # Daemon wrapper
  __tests__/        # Tests
```

### Testing

- Runner: `bun test`
- Command: `cd packages/cli && bun test`

---

## CI/CD: Auto Tag & Release

**File:** `.github/workflows/auto-tag.yml`

**Trigger:** Push to `main` branch

**What it does:**
1. Reads `version` from root `package.json`
2. Checks if a git tag for that version already exists
3. If new version: builds dashboard, bundles server into single JS file, packages CLI source
4. Creates a GitHub Release with the tar.gz artifact and auto-generated release notes

**To trigger a new release:** bump the `version` in root `package.json` and push to `main`.

---

## Local Development

```bash
# Install dependencies
bun install

# Start server (hot reload)
bun run dev:server        # port 4242

# Start dashboard (Vite dev server)
bun run dev:dashboard     # port 5173 (proxies API to 4242)

# Run all tests
bun run test

# Type check individual packages
cd packages/core && bunx tsc --noEmit
cd packages/server && bunx tsc --noEmit
cd packages/dashboard && bunx tsc -b
cd packages/cli && bunx tsc --noEmit

# Format
bun run format
```

---

## Data Directory

All runtime data lives in `~/.glue-paste-dev/`:
- SQLite database (WAL mode, foreign keys enabled)
- Logs
- PID file (daemon)

---

## To Recreate This Setup

1. `bun init` with `"workspaces": ["packages/*"]`
2. Create `tsconfig.base.json` with shared strict TS config
3. Create root `tsconfig.json` with project references to each package
4. Create each package with its own `package.json` and `tsconfig.json` extending the base
5. Use `workspace:*` for internal cross-references
6. For the frontend: `bun create vite` with React + TypeScript, add `@tailwindcss/vite`, configure proxy to API server, set build output to server's public dir
7. For the server: Hono + Bun, serve static files from public dir
8. For shared logic: plain TypeScript with separate browser/full exports
9. Add `vitest.workspace.ts` at root for coordinated testing
10. Add `.github/workflows/auto-tag.yml` to auto-release on version bump
