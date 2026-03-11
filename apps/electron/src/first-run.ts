import path from 'path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { spawn } from 'child_process';
import type firstRunDefaults from '../config/first-run-defaults.json';

/**
 * Execute a command and wait for it to complete.
 */
async function spawnAndAwait(
  nodePath: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(nodePath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
      env: env || process.env,
    });

    let output = '';
    let errorOutput = '';

    proc.stdout?.on('data', (data) => {
      output += data.toString();
      console.log('[FirstRun]', data.toString().trim());
    });
    proc.stderr?.on('data', (data) => {
      errorOutput += data.toString();
      console.error('[FirstRun]', data.toString().trim());
    });

    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}: ${errorOutput}`));
      }
    });
  });
}

/**
 * Run first-time setup for Desktop App.
 */
export async function runFirstTimeSetup(opts: {
  nodePath: string;
  clawCommand: string[];
  resourcesPath: string;
  monorepoRoot: string;
  defaults: typeof firstRunDefaults;
}): Promise<void> {
  console.log('[FirstRun] Starting first-time setup...');

  const {
    nodePath,
    clawCommand,
    resourcesPath,
    monorepoRoot,
    defaults,
  } = opts;

  const workspaceDir = defaults.workspace.dir || path.join(os.homedir(), 'openclaw-workspace');
  const apiKey = process.env.OPENCLAW_BUNDLED_API_KEY || defaults.ai.apiKey || '';

  console.log(`[FirstRun] Workspace directory: ${workspaceDir}`);
  console.log(`[FirstRun] Provider: ${defaults.ai.provider}`);
  console.log(`[FirstRun] Model: ${defaults.ai.model}`);

  // Derive the Node.js bin directory for PATH augmentation
  const nodeBinDir = path.dirname(nodePath);
  const augmentedPath = [
    nodeBinDir,
    '/usr/local/bin',
    '/opt/homebrew/bin',
    process.env.PATH || '',
  ]
    .filter(Boolean)
    .join(':');

  // 1. Run non-interactive onboarding
  console.log('[FirstRun] Running non-interactive onboarding...');
  const onboardArgs = [
    ...clawCommand,
    'onboard',
    '--non-interactive',
    '--accept-risk',
    '--workspace',
    workspaceDir,
    '--skip-health',
  ];

  if (defaults.ai.provider === 'anthropic') {
    onboardArgs.push('--anthropic-api-key', apiKey);
  } else if (defaults.ai.provider === 'custom' && defaults.ai.baseUrl) {
    // 第三方自定义服务：映射到 --auth-choice custom-api-key + 相关 flags
    onboardArgs.push(
      '--auth-choice', 'custom-api-key',
      '--custom-base-url', defaults.ai.baseUrl,
      '--custom-model-id', defaults.ai.model,
    );
    if (apiKey) {
      onboardArgs.push('--custom-api-key', apiKey);
    }
    if (defaults.ai.compatibility) {
      onboardArgs.push('--custom-compatibility', defaults.ai.compatibility);
    }
  } else if (defaults.ai.provider && defaults.ai.provider !== 'anthropic') {
    // 其他内置 provider（openrouter、ollama 等）
    if (defaults.ai.provider === 'openrouter') {
      onboardArgs.push('--openrouter-api-key', apiKey);
    }
  }

  try {
    await spawnAndAwait(nodePath, onboardArgs, monorepoRoot, {
      ...process.env,
      PATH: augmentedPath,
    });
    console.log('[FirstRun] Onboarding completed successfully');
  } catch (err) {
    console.error('[FirstRun] Onboarding failed:', err);
    throw err;
  }

  // 2. Copy default skills from bundled resources to workspace
  if (defaults.skills.enabled && defaults.skills.enabled.length > 0) {
    console.log('[FirstRun] Installing default skills:', defaults.skills.enabled);
    const skillsSrcDir = path.join(resourcesPath, 'default-workspace', 'skills');
    const workspaceSkillsDir = path.join(workspaceDir, 'skills');

    // Ensure skills directory exists
    await fs.mkdir(workspaceSkillsDir, { recursive: true });

    for (const skillName of defaults.skills.enabled as string[]) {
      const srcPath = path.join(skillsSrcDir, skillName);
      const destPath = path.join(workspaceSkillsDir, skillName);

      try {
        // Check if source skill exists
        const stats = await fs.stat(srcPath).catch(() => null);
        if (!stats) {
          console.warn(`[FirstRun] Skill not found: ${skillName}`);
          continue;
        }

        // Copy skill directory
        await fs.cp(srcPath, destPath, { recursive: true, force: true });
        console.log(`[FirstRun] Installed skill: ${skillName}`);
      } catch (err) {
        console.error(`[FirstRun] Failed to install skill ${skillName}:`, err);
      }
    }
  }

  // 3. Install default hooks from bundled resources
  if (defaults.hooks.enabled && defaults.hooks.enabled.length > 0) {
    console.log('[FirstRun] Installing default hooks:', defaults.hooks.enabled);
    const hooksSrcDir = path.join(resourcesPath, 'default-hooks');
    const hooksDestDir = path.join(os.homedir(), '.openclaw', 'hooks');

    // Ensure hooks directory exists
    await fs.mkdir(hooksDestDir, { recursive: true });

    for (const hookName of defaults.hooks.enabled) {
      const srcPath = path.join(hooksSrcDir, hookName);
      const destPath = path.join(hooksDestDir, hookName);

      try {
        // Check if source hook exists
        const stats = await fs.stat(srcPath).catch(() => null);
        if (!stats) {
          console.warn(`[FirstRun] Hook not found: ${hookName}`);
          continue;
        }

        // Copy hook directory
        await fs.cp(srcPath, destPath, { recursive: true, force: true });
        console.log(`[FirstRun] Installed hook: ${hookName}`);
      } catch (err) {
        console.error(`[FirstRun] Failed to install hook ${hookName}:`, err);
      }
    }
  }

  // 4. Enable internal hooks if requested
  if (defaults.hooks.enableInternal) {
    console.log('[FirstRun] Enabling internal hooks...');
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');

    try {
      const configContent = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent);

      // Enable internal hooks
      config.hooks = config.hooks || {};
      config.hooks.internal = config.hooks.internal || {};
      config.hooks.internal.enabled = true;

      await fs.writeFile(configPath, JSON.stringify(config, null, 2));
      console.log('[FirstRun] Internal hooks enabled');
    } catch (err) {
      console.error('[FirstRun] Failed to enable internal hooks:', err);
      // Not critical, continue
    }
  }

  console.log('[FirstRun] First-time setup completed successfully');
}
