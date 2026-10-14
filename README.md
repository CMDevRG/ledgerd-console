# ledgerd console

A web console for [ledgerd](https://github.com/CMDevRG/ledgerd), a double-entry
accounting ledger: explore accounts and balances, move money, provoke the failure
cases on purpose (overdraft, duplicate request, unbalanced transaction), and watch
the ledger prove itself with reconciliation.

> **Status: toolchain scaffold.** Today it shows one live indicator (is the API
> ready?). The product is being specified next (requirements → design → tasks), the
> same way ledgerd was.

## Requirements

- Node.js 22.12 or newer (`.nvmrc` says 22.22.1) and npm 11 or newer
- A running ledgerd for the live parts: `make up` in the ledgerd repository
  (API on `http://127.0.0.1:8085`)

## Commands

```bash
npm install            # exact versions from package-lock.json
npm run dev            # http://localhost:5173, forwards API paths to ledgerd
npm run verify         # typecheck + generated-types check + lint + format check + tests + build
npm test               # unit and component tests (no API needed: it is mocked)
npm run coverage
npm run generate:api   # regenerate src/api/schema.d.ts from ledgerd's OpenAPI file
npm run check:api      # fail if that file is out of date
```

`LEDGERD_URL` points the dev server at another API (default `http://127.0.0.1:8085`);
`LEDGERD_OPENAPI` points `generate:api` at another copy of `openapi.yaml`
(default `../ledgerd/docs/openapi.yaml`).

## Toolchain, and why

| Piece                | Choice                                                                                                       | Why                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Build and dev server | **Vite 8**                                                                                                   | Fast feedback, ES modules, a dev proxy that avoids CORS                                                         |
| UI                   | **React 19** + **TypeScript 6** (`strict`, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`) | Types catch the shape mistakes that matter with money                                                           |
| Server state         | **TanStack Query**                                                                                           | Caching, polling and error states without hand-written effects                                                  |
| Runtime validation   | **Zod**                                                                                                      | API answers are _parsed_, not trusted; a wrong shape throws                                                     |
| API types            | **openapi-typescript**, generated from ledgerd's `docs/openapi.yaml`                                         | The contract is the single source of truth; a stale file fails `check:api`                                      |
| Styling              | **Tailwind CSS 4**                                                                                           | Utility classes next to the markup; dark mode through `dark:`                                                   |
| Tests                | **Vitest** + **Testing Library** + **MSW**                                                                   | Components are tested like a user would use them; the network is mocked and any unmocked request fails the test |
| Lint                 | **ESLint 9** with `typescript-eslint` (strict, type-aware), `react-hooks`, `jsx-a11y`                        | Accessibility problems and hook mistakes are build errors                                                       |
| Format               | **Prettier**                                                                                                 | No style debates                                                                                                |

Versions are pinned exactly (`.npmrc` has `save-exact`), and `engine-strict` refuses
unsupported Node versions.

### Version choices worth knowing

- **TypeScript is 6.0.3, not 7.** `typescript-eslint` supports TypeScript below 6.1.
- **ESLint is 9, not 10.** `eslint-plugin-jsx-a11y` does not yet declare support for 10.
- **jsdom is 29, not 30**, because 30 needs Node 22.22.2 or newer.
- `openapi-typescript` declares `typescript@^5`; an `overrides` entry in
  `package.json` lets it use 6, and `npm run check:api-types` compiles the generated file with
  TypeScript 6 (library checking on) to prove it works.

## Money

ledgerd sends amounts as **strings** because integers above 2^53 do not survive a
JSON number. This project follows the same rule: money is parsed into `BigInt` and
never into `number`. `parseFloat` is forbidden by a lint rule.
