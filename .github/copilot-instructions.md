# Copilot Instructions

## Commit Message Convention

All commits must follow the [Conventional Commits](https://www.conventionalcommits.org/) specification. This project uses [release-please](https://github.com/googleapis/release-please) to automate versioning and changelog generation based on commit messages.

### Format

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types and Their Release Impact

| Type       | Description                                              | Release bump          |
| ---------- | -------------------------------------------------------- | --------------------- |
| `feat`     | A new feature                                            | minor (patch pre-1.0) |
| `fix`      | A bug fix                                                | patch                 |
| `feat!`    | A breaking change feature (or `BREAKING CHANGE:` footer) | major                 |
| `fix!`     | A breaking change fix                                    | major                 |
| `chore`    | Maintenance tasks, dependency updates                    | none                  |
| `docs`     | Documentation changes only                               | none                  |
| `style`    | Formatting, whitespace (no logic change)                 | none                  |
| `refactor` | Code change that neither fixes a bug nor adds a feature  | none                  |
| `perf`     | Performance improvements                                 | none                  |
| `test`     | Adding or updating tests                                 | none                  |
| `build`    | Changes to the build system or external dependencies     | none                  |
| `ci`       | Changes to CI/CD configuration                           | none                  |

### Examples

```
feat(cli): add --timeout flag to connect command
fix(mrp): handle empty heartbeat response correctly
chore(deps): update @noble/ciphers to v1.4.0
docs: update README with new CLI usage examples
refactor(core): extract pairing logic into PairingService
test(unit): add coverage for SRP handshake edge cases
ci: add --ignore-scripts to bun install
feat!: rename connect() return type (BREAKING CHANGE)
```

### Breaking Changes

Append `!` after the type/scope, or include a `BREAKING CHANGE:` footer:

```
feat!: drop support for Node.js < 18

feat(api): redesign DeviceManager interface

BREAKING CHANGE: DeviceManager.connect() now returns a Promise<Session> instead of void
```

> **Note:** Because this package is pre-1.0, `bump-minor-pre-major` is enabled — `feat` commits bump the **patch** version rather than minor until v1.0.0 is reached.
