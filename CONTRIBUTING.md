# Contributing

## Branch and PR conventions

- Branch off `main` for all changes: `git checkout -b feat/my-feature` or
  `fix/short-description`.
- Keep PRs focused — one logical change per PR. A PR that fixes a bug and refactors
  an unrelated module is harder to review and harder to revert.
- PR description must explain: what changed, why it changed, and how to verify it.
  For bug fixes, include the failure scenario that the change addresses.

---

## Before submitting a PR

- [ ] `npm test` passes locally with no skipped tests.
- [ ] No new `console.log`, `console.error`, or `console.warn` added to production
  code paths (`lib/`, `server.js`, `electron/`). Use `logInfo` / `logError` /
  `logWarn` from `lib/logger.js` instead.
- [ ] `npm audit --audit-level=high` returns no new high or critical findings.
- [ ] If you changed a route in `server.js`, confirm the correct rate limiter is
  applied (see rate limiter conventions in `CLAUDE.md`).

There is no lint script in this project. Follow the style of the surrounding code.

---

## Adding a test

Test files live in `__tests__/` and follow the naming convention `<module>.test.js`.

Run a single test file:

```sh
npx jest __tests__/build.test.js --verbose
```

**Mocking `child_process.spawn`**: `lib/build.js` and `lib/preview.js` destructure
`spawn` at module load time, so `jest.spyOn` alone cannot intercept it. The established
pattern is `jest.mock('child_process')` at the file's top level (Jest hoists it before
any `require`), then control the mock per-test via the module reference:

```js
jest.mock('child_process');
const childProcess = require('child_process');
const { EventEmitter } = require('events');

const mockChild = new EventEmitter();
mockChild.stdout = new EventEmitter();
mockChild.stderr = new EventEmitter();
mockChild.kill = jest.fn();
childProcess.spawn.mockReturnValue(mockChild);
```

See `__tests__/build.test.js` for complete examples including the fake-timer pattern
used for the SIGTERM timeout test.

**Fake timers**: Use `jest.useFakeTimers()` only inside the specific test that needs
it, and restore immediately with `jest.useRealTimers()` before the test exits. Do not
apply fake timers globally — they interfere with Promise microtask resolution in other
tests.

---

## Dependency changes

Any PR that adds, removes, or upgrades a dependency must include a justification in
the PR description: what problem does the dependency solve, why an existing dependency
cannot solve it, and what the maintenance/security surface-area cost is.

Run `npm audit --audit-level=high` after any `package.json` change and resolve any
high or critical findings before submitting.
