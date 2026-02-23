# Release

Create a versioned release for both `@saanuregh/trigger` and `@saanuregh/trigger-sdk`.

Argument: version bump type — `patch`, `minor`, or `major`. Defaults to `patch` if omitted.

## Steps

1. **Determine version**: Read current version from `package.json`. Compute the next version based on the bump type ($ARGUMENTS or `patch`).

2. **Ensure clean state**: Verify you're on `main` with no uncommitted changes. Pull latest.

3. **Bump versions**: Update `version` in both `package.json` and `packages/trigger-sdk/package.json` to the new version.

4. **Branch, commit, push**: Create branch `v{version}`, commit with message `Bump to {version}`, push with `-u`.

5. **PR and merge**: Create a PR titled `v{version}` with a summary body. Merge with `gh pr merge --rebase`.

6. **Tag**: Checkout `main`, pull, create tag `{version}`, push tag.

7. **Generate release notes**: Run `git log {previous_tag}..{version} --oneline` to list changes since the last tag. Write concise release notes categorizing changes (Fixes, Features, etc.).

8. **Create GitHub release**: Run `gh release create {version} --title "{version}" --notes "{notes}"`.

## Rules

- Always rebase-merge PRs, never merge commits.
- Both packages must have the same version.
- Wait for each step to succeed before proceeding.
- If any step fails, stop and report the error.
