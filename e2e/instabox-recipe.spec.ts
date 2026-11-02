// Real-Instabox end-to-end check: copy into an Orca checkout's tests/e2e and run with
// ORCA_E2E_INSTABOX_PLUGIN=<this repo> ORCA_E2E_ORCAD_TEMPLATE=<linux-x64 orcad template> and a
// signed-in instabox CLI. It creates, sleeps, wakes and deletes one real machine.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { enableDevPlugins } from './helpers/plugin-smoke'
import { openSidebarWorkspaceComposer } from './helpers/sidebar-project-dialog'
import { activateWorkspaceByClick, sleepWorkspaceViaSidebar } from './helpers/slept-workspace-probe'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'

const PLUGIN_ROOT = process.env.ORCA_E2E_INSTABOX_PLUGIN
const ORCAD_TEMPLATE = process.env.ORCA_E2E_ORCAD_TEMPLATE

// The app runs with an isolated HOME; expose only the real instabox sign-in to the recipe.
const INSTABOX_CONFIG_HOME = mkdtempSync(path.join(tmpdir(), 'orca-instabox-config-'))
symlinkSync(path.join(homedir(), '.config', 'instabox'), path.join(INSTABOX_CONFIG_HOME, 'instabox'))

test.skip(!PLUGIN_ROOT || !ORCAD_TEMPLATE, 'Needs the plugin folder, an orcad template and instabox')
test.use({
  seedTestRepo: false,
  orcaAppExtraEnv: {
    ORCA_ORCAD_TEMPLATE_PATH: ORCAD_TEMPLATE ?? '',
    XDG_CONFIG_HOME: INSTABOX_CONFIG_HOME
  }
})

type Machine = { id: string; name: string; state: string }

function machinesNamed(prefix: string): Machine[] {
  const list: Machine[] = JSON.parse(execFileSync('instabox', ['ls', '--json'], { encoding: 'utf8' }))
  return list.filter((machine) => machine.name.startsWith(prefix))
}

function machineState(prefix: string): string {
  const [machine] = machinesNamed(prefix)
  return machine ? machine.state : 'gone'
}

function remoteGit(machineId: string, command: string): string {
  return execFileSync('instabox', ['exec', machineId, '--', command], { encoding: 'utf8' }).trim()
}

async function runtimeStatus(page: Page, workspaceId: string): Promise<string | null> {
  return page.evaluate(async (id) => {
    const runtime = (await window.api.ephemeralVm.listRuntimes()).find(
      (entry) => entry.workspaceId === id
    )
    return runtime ? `${runtime.status}/${runtime.cleanupStatus}` : null
  }, workspaceId)
}

async function findWorkspace(page: Page, name: string) {
  return page.evaluate(
    (workspaceName) =>
      Object.values(window.__store!.getState().worktreesByRepo)
        .flat()
        .find((worktree) => worktree.displayName === workspaceName) ?? null,
    name
  )
}

test('runs a workspace on an Instabox machine through its whole life', async ({ orcaPage }) => {
  test.setTimeout(900_000)
  const workspaceName = `ib-e2e-${Date.now()}`
  const machinePrefix = `orca-${workspaceName}-`
  const repoParent = mkdtempSync(path.join(tmpdir(), 'orca-instabox-e2e-'))
  const repoPath = path.join(repoParent, 'hello-world')
  try {
    execFileSync('git', ['clone', '--quiet', 'https://github.com/octocat/Hello-World.git', repoPath])
    await waitForSessionReady(orcaPage)
    await enableDevPlugins(orcaPage, [PLUGIN_ROOT!])
    const plugin = await orcaPage.evaluate(async () =>
      (await window.api.plugins.list()).find((entry) => entry.pluginKey.endsWith('.instabox'))
    )
    // A plugin without a worker reports idle once approved.
    expect(plugin?.status).toBe('idle')

    await orcaPage.evaluate(async (repo) => {
      // Per-workspace environments are still an experiment the composer hides by default.
      const settings = await window.api.settings.set({ experimentalEphemeralVms: true })
      window.__store?.setState({ settings })
      const result = await window.api.repos.add({ path: repo })
      if ('error' in result) {
        throw new Error(result.error)
      }
    }, repoPath)

    await test.step('create', async () => {
      await openSidebarWorkspaceComposer(orcaPage)
      const dialog = orcaPage.getByRole('dialog', { name: /Create (Workspace|Worktree)/i })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('combobox', { name: 'Run on' }).click()
      await orcaPage.getByRole('option', { name: /Per-Workspace Environment/ }).click()
      await orcaPage
        .getByRole('listbox', { name: 'Per-Workspace Environment' })
        .getByText('Instabox', { exact: true })
        .click()
      await dialog.getByPlaceholder(/Type a name/i).fill(workspaceName)
      await dialog.getByRole('button', { name: /Create (Workspace|Worktree)/i }).click()
      const trustDialog = orcaPage.getByRole('dialog', { name: /Run VM recipe/ })
      if (await trustDialog.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await trustDialog.getByRole('button', { name: 'Run hooks' }).click()
      }
      await expect(dialog).toBeHidden({ timeout: 120_000 })
      await expect
        .poll(() => findWorkspace(orcaPage, workspaceName), {
          timeout: 600_000,
          message: 'the Instabox workspace never appeared'
        })
        .not.toBeNull()
    })

    const workspace = (await findWorkspace(orcaPage, workspaceName))!
    const [machine] = machinesNamed(machinePrefix)
    expect(machine?.state).toBe('running')
    expect(workspace.hostId).toBeTruthy()
    expect(workspace.path.startsWith('/data/home/')).toBe(true)
    // Provisioned root: the machine's clone is the workspace, with no second worktree beside it.
    const machineWorkspaces = await orcaPage.evaluate(
      (repoId) => window.__store!.getState().worktreesByRepo[repoId]?.length ?? 0,
      workspace.repoId
    )
    expect(machineWorkspaces).toBe(1)
    expect(workspace.isMainWorktree).toBe(true)
    expect(remoteGit(machine.id, `git -C ${workspace.path} branch --show-current`)).toBe(
      workspace.branch.replace(/^refs\/heads\//, '')
    )
    await ensureTerminalVisible(orcaPage)

    await test.step('sleep suspends the machine', async () => {
      await sleepWorkspaceViaSidebar(orcaPage, workspace.id)
      await expect
        .poll(() => runtimeStatus(orcaPage, workspace.id), { timeout: 180_000 })
        .toMatch(/^suspended\//)
      expect(machineState(machinePrefix)).toBe('suspended')
    })

    await test.step('wake resumes the machine', async () => {
      // Wake the way a user returns to it: from another workspace, by clicking its row.
      await orcaPage.evaluate(() => window.__store!.getState().setActiveWorktree(null))
      await activateWorkspaceByClick(orcaPage, workspace.id)
      await expect
        .poll(() => runtimeStatus(orcaPage, workspace.id), { timeout: 180_000 })
        .toMatch(/^running\//)
      expect(machineState(machinePrefix)).toBe('running')
      await expect(
        orcaPage.getByText(/Reconnecting to Instabox/).first()
      ).toBeHidden({ timeout: 180_000 })
      await ensureTerminalVisible(orcaPage)
    })

    await test.step('delete removes the machine', async () => {
      // The clone is the project's primary checkout, so the sidebar offers Remove Project from Orca.
      await orcaPage.evaluate(
        ({ repoId, hostId }) => window.__store!.getState().removeProject(repoId, { hostId }),
        { repoId: workspace.repoId, hostId: workspace.hostId! }
      )
      await expect
        .poll(() => machineState(machinePrefix), { timeout: 180_000, intervals: [3_000] })
        .toBe('gone')
    })
  } finally {
    for (const leftover of machinesNamed(machinePrefix)) {
      execFileSync('instabox', ['rm', leftover.id, '--yes'])
    }
    rmSync(repoParent, { recursive: true, force: true })
  }
})
