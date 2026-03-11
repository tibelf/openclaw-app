/**
 * Prebuild script: stage production node_modules for Electron packaging.
 *
 * Uses npm install --omit=dev to create a flat node_modules layout with all
 * transitive dependencies resolved. This avoids pnpm symlink complexity.
 *
 * electron-builder.yml copies staging-node-modules -> Resources/node_modules/
 * so that node Resources/dist/entry.js can resolve imports upward.
 */
import { execSync } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../');
const tmpDir = path.join(__dirname, '..', 'staging-tmp');
const stagingDir = path.join(__dirname, '..', 'staging-node-modules');

console.log('[prebuild] Staging production node_modules for packaging...');

// Clean and recreate temp install directory
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

// Copy root package.json so npm knows what to install
fs.copyFileSync(
  path.join(repoRoot, 'package.json'),
  path.join(tmpDir, 'package.json'),
);

// Run npm install to get flat node_modules with all transitive deps
console.log('[prebuild] Running npm install --omit=dev...');
execSync('npm install --omit=dev --ignore-scripts', {
  cwd: tmpDir,
  stdio: 'inherit',
});

// Rename the installed node_modules to staging-node-modules
fs.renameSync(path.join(tmpDir, 'node_modules'), stagingDir);
fs.rmSync(tmpDir, { recursive: true, force: true });

const count = fs.readdirSync(stagingDir).length;
console.log(`[prebuild] Staged ${count} top-level packages`);
console.log('[prebuild] Ready for Electron build');
