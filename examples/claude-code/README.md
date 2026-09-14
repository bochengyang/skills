# Claude Code integration

Two skills and one hook. Copy `skills/` into `~/.claude/skills/` (or a project's `.claude/skills/`)
and merge `settings.hooks.json` into your `settings.json`. Configure the target once:

```sh
# ~/.zshrc or a project .envrc
export HUNKBOARD_REMOTE=review-box                        # ssh host alias
export HUNKBOARD_ROOT=/srv/hunkboard                      # directory on that host
export HUNKBOARD_URL=https://review.example.com/hunkboard # public base, prefix included
export HUNKBOARD_BIN=$HOME/repos/hunkboard/bin
```

| Piece | What it does |
|---|---|
| `skills/hunkboard-publish` | `/hunkboard-publish` — publish the working tree and print the review URL |
| `skills/hunkboard-comments` | `/hunkboard-comments` — read open threads, act on them, write `resolutions.json`, republish |
| `settings.hooks.json` | Stop hook: republish automatically after every agent turn, if a board already exists for this repo/branch |

The hook is optional. Without it, run `/hunkboard-publish` when you want a fresh round.
