# Instabox for Orca

Run each Orca workspace on its own [Instabox](https://instabox.sh) cloud machine. The plugin adds an
**Instabox** environment recipe to the new-workspace "Run on" picker. Machines use your account's
default Instabox template.

What each workspace does:

- **Create**: makes a machine named `orca-<workspace>-<id>`, clones the repository's `origin`
  remote into the machine's home over HTTPS, and hands Orca an SSH connection. Orca installs its
  server on the machine and creates the workspace's worktree there.
- **Sleep / wake**: suspends and resumes the machine; the workspace reconnects with the same token.
- **Delete**: deletes the machine, which also revokes its SSH tokens.

If any create step fails, the machine is deleted again.

## Requirements

- Orca's per-workspace environments turned on: Settings → Experimental → per-workspace
  environments (`experimentalEphemeralVms`). Until then the recipes do not show in "Run on".
- The `instabox` CLI on `PATH`, signed in (`instabox login`).
- `node` on `PATH`: the recipe commands run `node -e`.
- A repository with an `origin` remote. SSH remotes (`git@github.com:org/repo.git`) are cloned as
  HTTPS, because the machine has no SSH key for your Git host.
- For a private repository, a GitHub token saved as an Instabox Secret named `GH_TOKEN`. Each new
  machine selects it, and Instabox's proxy adds the real token only to requests to GitHub:

  ```sh
  gh auth token | instabox secrets set GH_TOKEN --host github.com --host api.github.com
  ```

  A fine-grained token with read access to just the repositories you use works too.

## How it connects

Each workspace gets an Instabox SSH token (`instabox ssh-token`) and Orca dials
`ssh.instabox.sh:2222` with the token as the user name and no key. The token is a bearer secret
that Orca stores with the workspace's SSH target, and it does not expire: Orca keeps dialing the
target it saved at create and never takes a new one on wake. It dies with the machine.

## Verified

`e2e/instabox-recipe.spec.ts` drives a real Orca build against real Instabox: create from the
"Run on" picker, Orca installs its server on the machine, sleep suspends the machine, wake resumes
it and reconnects, delete removes the machine. Copy it into an Orca checkout's `tests/e2e` and see
its header for the environment it needs.

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
