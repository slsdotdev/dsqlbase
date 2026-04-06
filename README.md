# tsbase

A minimal, batteries-included monorepo starter template for TypeScript open source projects.

## What's Included

- **TypeScript 5.9** with strict mode and `nodenext` module resolution
- **Turborepo** for fast, cached monorepo task orchestration
- **Vitest** for unit testing with coverage via `@vitest/coverage-v8`
- **ESLint 10** flat config with `typescript-eslint` strict + stylistic rules
- **Prettier** for consistent formatting
- **Changesets** for versioning and changelog management
- **Husky** pre-commit hook to enforce linting

## Getting Started

```bash
# Clone the template
git clone https://github.com/slsdotdev/tsbase.git my-project
cd my-project

# Install dependencies (requires Node >= 18, npm >= 8.19)
npm install

# Start developing
npm run dev
```

## Project Structure

```
tsbase/
├── packages/
│   └── core/          # @tsbase/core — shared utilities and types
├── turbo.json         # Turborepo task pipeline
├── tsconfig.json      # Root TypeScript config
├── eslint.config.mjs  # ESLint flat config
├── vitest.config.ts   # Vitest workspace config
└── .changeset/        # Changesets config
```

Add new packages under `packages/` — they'll be picked up automatically via npm workspaces.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start all packages in watch mode |
| `npm run build` | Build all packages |
| `npm test` | Run tests across all packages |
| `npm run lint` | Lint all packages |
| `npm run changeset` | Create a new changeset for versioning |

## Adding a Package

1. Create a new directory under `packages/`
2. Add a `package.json` with a scoped name (e.g. `@tsbase/my-pkg`)
3. Add a `tsconfig.json` extending the root config
4. Add source files under `src/`

## License

MIT
