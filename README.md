# KB Labs Product Template (@kb-labs/product-template)

> **Baseline template for products under the @kb-labs namespace.** Fast bootstrap, unified quality rules, simple publishing, and reusable core.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18.18.0+-green.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-9.0.0+-orange.svg)](https://pnpm.io/)

## 🎯 Vision

KB Labs Product Template is the baseline template for products under the **@kb-labs** namespace. It provides fast bootstrap, unified quality rules, simple publishing, and reusable core utilities.

The project solves the problem of inconsistent project structure and configurations across multiple KB Labs products by providing a unified template with shared configurations, quality rules, and development workflows. Instead of each new project starting from scratch, developers can use this template for consistent structure and tooling.

This project is part of the **@kb-labs** ecosystem and serves as the foundation for all new KB Labs products.

## 🚀 Quick Start

### Installation

```bash
# Clone repository
git clone https://github.com/kirill-baranov/kb-labs-product-template.git
cd kb-labs-product-template

# Install dependencies
pnpm install
```

### Development

```bash
# Start development mode for all packages
pnpm dev

# Build all packages
pnpm build

# Run tests
pnpm test

# Lint code
pnpm lint
```

### Creating a New Package

```bash
# Using the CLI tool (recommended)
pnpm dlx @kb-labs/create-pkg my-new-pkg

# Or manually copy and modify
cp -r packages/package-name packages/<new-package-name>
# Then update metadata and imports
```

## ✨ Features

- **Fast Bootstrap**: Quick project setup with unified configurations
- **Unified Quality Rules**: ESLint, Prettier, TypeScript, Vitest, and TSUP configs
- **Simple Publishing**: Automated releases through Changesets
- **Reusable Core**: Shared utilities via `@kb-labs/core`
- **DevKit Integration**: Zero-maintenance configurations via `@kb-labs/devkit`
- **Multi-Package Support**: pnpm workspaces for monorepo structure

## 📖 Documentation

- 📦 [Naming Convention](./docs/naming-convention.md) - The Pyramid Rule (mandatory!)
- 📚 [Documentation Guide](./docs/DOCUMENTATION.md) - How to document your product
- 🏛️ [ADRs](./docs/adr/) - Architecture Decision Records

## 📁 Repository Structure

```
kb-labs-product-template/
├── apps/                    # Demo applications
│   └── demo/                # Example app / playground
├── packages/                # Core packages
│   └── package-name/        # Example package (lib/cli/adapter)
├── fixtures/                # Fixtures for snapshot/integration testing
├── docs/                    # Documentation
│   ├── naming-convention.md # The Pyramid Rule (NEW!)
│   ├── DOCUMENTATION.md     # Documentation guide
│   └── adr/                 # Architecture Decision Records (ADRs)
└── scripts/                 # Utility scripts
```

### Directory Descriptions

- **`apps/`** - Demo applications demonstrating product usage
- **`packages/`** - Core packages (lib, CLI, adapters)
- **`fixtures/`** - Test fixtures for snapshot and integration testing
- **`docs/`** - Documentation including ADRs and guides

## 📦 Packages

| Package | Description |
|---------|-------------|
| [@kb-labs/package-name](./packages/package-name/) | Example package (replace with your package) |

### Package Details

This template includes a single example package that can be customized for your needs:
- TypeScript library structure
- Vitest test setup
- TSUP build configuration
- Example source code and tests

## 🛠️ Available Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start development mode for all packages |
| `pnpm build` | Build all packages |
| `pnpm build:clean` | Clean and build all packages |
| `pnpm test` | Run all tests |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm lint` | Lint all code |
| `pnpm lint:fix` | Fix linting issues |
| `pnpm type-check` | TypeScript type checking |
| `pnpm check` | Run lint, type-check, and tests |
| `pnpm ci` | Full CI pipeline (clean, build, check) |
| `pnpm clean` | Clean build artifacts |
| `pnpm clean:all` | Clean all node_modules and build artifacts |

### DevKit Commands

| Script | Description |
|--------|-------------|
| `pnpm devkit:sync` | Sync DevKit configurations to workspace |
| `pnpm devkit:check` | Check if DevKit sync is needed |
| `pnpm devkit:force` | Force DevKit sync (overwrite existing) |
| `pnpm devkit:help` | Show DevKit sync help |

## 🔧 DevKit Integration

This template uses `@kb-labs/devkit` for shared tooling and configurations. DevKit provides:

- **Unified Configurations**: ESLint, Prettier, TypeScript, Vitest, and TSUP configs
- **Automatic Sync**: Keeps workspace configs in sync with latest DevKit versions
- **Zero Maintenance**: No need to manually update config files

### DevKit Commands Usage

- **`pnpm devkit:sync`** - Syncs DevKit configurations to your workspace (runs automatically on `pnpm install`)
- **`pnpm devkit:check`** - Checks if your workspace configs are up-to-date with DevKit
- **`pnpm devkit:force`** - Forces sync even if local files exist (overwrites local changes)
- **`pnpm devkit:help`** - Shows detailed help and available options

For more details, see [ADR-0005: Use DevKit for Shared Tooling](docs/adr/0005-use-devkit-for-shared-tooling.md).

## 📋 Development Policies

- **Code Style**: ESLint + Prettier, TypeScript strict mode
- **Testing**: Vitest with fixtures for integration testing
- **Versioning**: SemVer with automated releases through Changesets
- **Architecture**: Document decisions in ADRs (see `docs/adr/`)
- **Tooling**: Shared configurations via `@kb-labs/devkit`

## 🔧 Requirements

- **Node.js**: >= 18.18.0
- **pnpm**: >= 9.0.0

## 📚 Documentation

- [Documentation Standard](./docs/DOCUMENTATION.md) - Full documentation guidelines
- [Contributing Guide](./CONTRIBUTING.md) - How to contribute
- [Architecture Decisions](./docs/adr/) - ADRs for this project

## 🔗 Related Packages

### Dependencies

- [@kb-labs/devkit](https://github.com/KirillBaranov/kb-labs-devkit) - DevKit presets and configurations

### Used By

- All KB Labs projects as a starting template

### Ecosystem

- [KB Labs](https://github.com/KirillBaranov/kb-labs) - Main ecosystem repository

## 🤝 Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines and contribution process.

## 📄 License

MIT © KB Labs

---

**See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines and contribution process.**


## License

MIT License - see [LICENSE](LICENSE) for details.
