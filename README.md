# Skills

Plugins and skills for coding agents. Each one lives in its own folder under
[`plugins/`](plugins/) with its own README.

| Plugin | What it does |
|---|---|
| [hunkboard](plugins/hunkboard/) | Review what your coding agent changed like a pull request, before you open one, on your laptop or your phone, and hand your comments back to it. |

## Installation

<details>
<summary><strong>Claude Code</strong></summary>

```
/plugin marketplace add bochengyang/skills
/plugin install hunkboard
```

</details>

<details>
<summary><strong>Codex, Gemini CLI, Cursor and other agents</strong></summary>

```
npx skills@latest add bochengyang/skills
```

This lists every skill in the collection so you can pick the ones you want.

</details>

## License

MIT. See [`LICENSE`](LICENSE); third-party code bundled by a plugin is listed in that plugin's folder.
