# Issue tracker: GitHub

Issues and PRDs for this repository live as GitHub issues. Use the `gh` CLI for all operations and infer the repository from `git remote -v`.

## Conventions

- Create an issue with `gh issue create --title "..." --body-file <path>`.
- Read an issue with `gh issue view <number> --comments` and include its labels.
- List issues with `gh issue list`, requesting JSON when filtering or scripting.
- Comment with `gh issue comment <number> --body "..."`.
- Add or remove labels with `gh issue edit`.
- Close an issue with `gh issue close`.

## Pull requests as a triage surface

**PRs as a request surface: no.** External pull requests are not included in normal issue-triage discovery.

GitHub shares one number space across issues and pull requests. Resolve an ambiguous number by checking the pull request first and falling back to the issue.

## Publishing

When an engineering skill says to publish to the issue tracker, create a GitHub issue in `cesarecaoduro/OctoMeta`.
