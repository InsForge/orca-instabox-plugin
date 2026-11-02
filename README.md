# Instabox for Orca

Run each Orca workspace on its own [Instabox](https://instabox.sh) cloud machine. The plugin adds an
**Instabox** environment recipe to the new-workspace "Run on" picker. Machines use your account's
default Instabox template.

What each workspace does:

- **Create**: makes a machine named `orca-<workspace>-<id>`, clones the repository's `origin`
  remote into the machine's home over HTTPS, checks out the workspace's branch at the start commit
  you picked, and hands Orca an SSH connection. That clone is the workspace itself
  (`checkoutMode: provisioned-root`), so each machine shows one workspace and no second worktree.
  The start commit has to be pushed, because the machine fetches it from the Git host. Orca
  installs its server on the machine.
- **Sleep / wake**: suspends and resumes the machine; the workspace reconnects with the same token.
- **Delete**: deletes the machine, which also revokes its SSH tokens.

If any create step fails, the machine is deleted again.

## Before you start

The plugin drives the `instabox` CLI on your computer and does not install it. Run this once in a
terminal; it signs you in and puts the CLI on your `PATH`:

```sh
npx instabox@latest
```

It also installs Instabox's agent skills for Claude Code, Codex and others; add `--no-skills` to
skip them. Restart Orca afterwards so it sees the new `PATH`. On Windows, add the folder the
command prints to your `PATH` first.

Then turn on Orca's per-workspace environments: Settings → Experimental → Cloud VM
(`experimentalEphemeralVms`). Until then the recipe does not show in "Run on".

## Requirements

- Orca 1.4.228 or later. Earlier releases connect the machine without Orca's server on it, and newer
  Orca cannot delete such a workspace later.
- The `instabox` CLI on `PATH`, signed in (see above).
- `node` on `PATH`: the recipe commands run `node -e`.
- A repository with an `origin` remote. SSH remotes (`git@github.com:org/repo.git`) are cloned as
  HTTPS, because the machine has no SSH key for your Git host.
- For a private repository, a GitHub token saved as an Instabox Secret named `GH_TOKEN`. Each new
  machine selects it, and Instabox's proxy adds the real token only to requests to GitHub:

  ```sh
  gh auth token | instabox secrets set GH_TOKEN --host github.com --host api.github.com
  ```

  A fine-grained token with read access to just the repositories you use works too.

## Signing in agents on the machine

New machines also select these Instabox Secrets when you have saved them, so agents on the machine
are signed in without copying a real credential there:

| Secret | Signs in | Save it with |
| --- | --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude Code, on your Claude subscription | `claude setup-token`, then `instabox secrets set CLAUDE_CODE_OAUTH_TOKEN --ai anthropic` |
| `OPENAI_API_KEY` | Codex, billed to the API key (not yet verified with a real key) | `instabox secrets set OPENAI_API_KEY --ai openai` |

Codex's ChatGPT sign-in cannot travel this way, because its tokens rotate; run
`codex login --device-auth` on the machine instead.

## How it connects

Each workspace gets an Instabox SSH token (`instabox ssh-token`) and Orca dials
`ssh.instabox.sh:2222` with the token as the user name and no key. The token is a bearer secret
that Orca stores with the workspace's SSH target, and it does not expire: Orca keeps dialing the
target it saved at create and never takes a new one on wake. It dies with the machine.

## Verified

- `e2e/instabox-recipe.spec.ts` drives a real Orca build against real Instabox: create from the
  "Run on" picker, Orca installs its server on the machine, sleep suspends the machine, wake
  resumes it and reconnects, delete removes the machine. Copy it into an Orca checkout's
  `tests/e2e` and see its header for the environment it needs.
- Running the recipe command directly against real Instabox, outside Orca: a private repository
  clones with the `GH_TOKEN` Secret, and `claude -p` answers on the machine with the
  `CLAUDE_CODE_OAUTH_TOKEN` Secret.
- Not verified: Codex with a real `OPENAI_API_KEY`, and Windows.

## Develop

The recipe files can only hold commands, so `scripts/build-recipes.mjs` inlines
`src/lifecycle.js` into `node -e "..."` for all four phases. Edit `src/lifecycle.js`, then run:

```sh
node scripts/build-recipes.mjs
```

Check it the way Orca loads it (Orca 1.4.246 or later ships this command):

```sh
orca plugin validate .
```

To load your copy in Orca, add this folder under Settings → Plugins → Development, then refresh the
plugin list after each build.

`src/lifecycle.js` must avoid `"`, `$`, backticks, backslashes and `%`, because the same command
runs under `sh` and `cmd.exe`, and needs a semicolon after every statement. The build checks both.
