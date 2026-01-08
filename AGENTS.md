# Agent Instructions

Instructions for AI agents working on this repository.

## Release Process

When publishing a new version:

1. Run `npm version patch|minor|major` to bump the version
2. Push commits: `git push origin master`
3. Create and push tag **without the 'v' prefix**: `git tag X.Y.Z && git push origin X.Y.Z`

**IMPORTANT**:
- Use `1.1.1` NOT `v1.1.1` for tags. The release workflow expects tags without the 'v' prefix.
- **NEVER re-release the same version number**. If a release fails, bump to the next version (e.g., if 1.1.1 fails, release as 1.1.2).

## Code Style

- Use single quotes for strings
- Use ESLint with the obsidianmd plugin
- Follow conventional commits format (e.g., `feat:`, `fix:`, `refactor:`, `chore:`)
