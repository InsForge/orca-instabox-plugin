# Instabox for Orca

Run each Orca workspace on its own [Instabox](https://instabox.sh) cloud machine. The plugin adds
two environment recipes to the new-workspace "Run on" picker:

| Recipe | Machine |
| --- | --- |
| **Instabox** | Instabox's default template. Works on every plan. |
| **Instabox (Orca template)** | The `orca` template. Needs a paid plan. |

What each workspace does:

- **Create**: makes a machine named `orca-<workspace>-<id>`, clones the repository's `origin`
  remote into the machine's home over HTTPS, and hands Orca an SSH connection. Orca installs its
  server on the machine and creates the workspace's worktree there.
- **Sleep / wake**: suspends and resumes the machine. Every wake replaces the SSH token.
- **Delete**: deletes the machine, which also revokes its SSH tokens.

If any create step fails, the machine is deleted again.

## Requirements

- The `instabox` CLI on `PATH`, signed in (`instabox login`).
- `node` on `PATH`: the recipe commands run `node -e`.
- A repository with an `origin` remote. SSH remotes (`git@github.com:org/repo.git`) are cloned as
  HTTPS, because the machine has no SSH key for your Git host.
- For a private repository, a GitHub token named `GH_TOKEN` in your Instabox Vault, so new machines
  can clone it (`instabox vault --help`).

## How it connects

Each workspace gets an Instabox SSH token (`instabox ssh-token`) and Orca dials
`ssh.instabox.sh:2222` with the token as the user name and no key. The token is a bearer secret
that Orca stores with the workspace's SSH target; it is revoked when the workspace wakes (a new one
is issued) and when the machine is deleted.

## Develop

The recipe files can only hold commands, so `scripts/build-recipes.mjs` inlines
`src/lifecycle.js` into `node -e "..."` for all four phases. Edit `src/lifecycle.js`, then:

```sh
node scripts/build-recipes.mjs
orca plugin validate .
orca plugin dev load .
```

`src/lifecycle.js` must avoid `"`, `$`, backticks, backslashes and `%`, because the same command
runs under `sh` and `cmd.exe`, and needs a semicolon after every statement. The build checks both.
