#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { opencliExec } from './lib/opencli-command.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OPENCLI_REPO = 'jackwener/opencli';
const DEFAULT_URL = 'https://chat.deepseek.com/';
const DEFAULT_DEBUG_PORT = 9230;
const home = os.homedir();
const extensionRoot = path.join(home, '.opencli', 'extensions');
const winProgramFiles = process.env.ProgramFiles || '';
const winProgramFilesX86 = process.env['ProgramFiles(x86)'] || '';
const winLocalAppData = process.env.LOCALAPPDATA || '';
const browserCandidates = {
  edge: {
    name: 'Microsoft Edge',
    paths: [
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      path.join(winProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(winProgramFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(winLocalAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ],
    profileDir: path.join(home, '.opencli', 'edge-deepseek-profile'),
  },
  chrome: {
    name: 'Google Chrome',
    paths: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(winProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(winProgramFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(winLocalAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ],
    profileDir: path.join(home, '.opencli', 'chrome-deepseek-profile'),
  },
};

function printHelp() {
  console.log(`Usage:
  node scripts/setup_deepseek_bridge.mjs [options]

Options:
  --browser <edge|chrome>     Browser to launch. Default: first installed browser.
  --url <url>                 Page to open after Bridge loads. Default: ${DEFAULT_URL}
  --profile-dir <dir>         Browser user-data-dir. Default: ~/.opencli/<browser>-deepseek-profile
  --debug-port <port>         Remote debugging port. Default: ${DEFAULT_DEBUG_PORT}
  --no-daemon-restart         Do not restart the OpenCLI daemon first.
  --force                     Launch a new dedicated profile even if connected profiles exist.
  --dry-run                   Print the launch plan without opening a browser.
  -h, --help                  Show help.
`);
}

function parseArgs(argv) {
  const args = {
    browser: '',
    url: DEFAULT_URL,
    profileDir: '',
    debugPort: DEFAULT_DEBUG_PORT,
    restartDaemon: true,
    force: false,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--browser') args.browser = takeArgValue(argv, ++i, arg);
    else if (arg === '--url') args.url = takeArgValue(argv, ++i, arg);
    else if (arg === '--profile-dir') args.profileDir = path.resolve(takeArgValue(argv, ++i, arg));
    else if (arg === '--debug-port') args.debugPort = Number(takeArgValue(argv, ++i, arg));
    else if (arg === '--no-daemon-restart') args.restartDaemon = false;
    else if (arg === '--force') args.force = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '-h' || arg === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(args.debugPort) || args.debugPort < 1024 || args.debugPort > 65535) {
    throw new Error('--debug-port must be an integer between 1024 and 65535');
  }
  if (!isAllowedDeepSeekUrl(args.url)) {
    throw new Error('--url must point to https://chat.deepseek.com/ for this skill setup');
  }
  return args;
}

function takeArgValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function isAllowedDeepSeekUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'chat.deepseek.com';
  } catch {
    return false;
  }
}

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function safeRun(cmd, args) {
  try {
    return run(cmd, args);
  } catch (error) {
    return `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
  }
}

function currentOpenCliVersion() {
  return run(...opencliExec(['--version']));
}

function chooseBrowser(name) {
  if (name) {
    const browser = browserCandidates[name];
    if (!browser) throw new Error(`Unsupported browser: ${name}. Use edge or chrome.`);
    const found = browser.paths.find((candidate) => fs.existsSync(candidate));
    if (!found) throw new Error(`${browser.name} not found in known install paths.`);
    return { ...browser, path: found };
  }
  for (const browser of Object.values(browserCandidates)) {
    const found = browser.paths.find((candidate) => fs.existsSync(candidate));
    if (found) return { ...browser, path: found };
  }
  throw new Error('Neither Microsoft Edge nor Google Chrome was found.');
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'deepseek-crawler-web-setup',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function downloadFile(url, targetPath, tagName, assetName) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'deepseek-crawler-web-setup' },
    });
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${await response.text()}`);
    }
    fs.writeFileSync(targetPath, Buffer.from(await response.arrayBuffer()));
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`Node download failed (${message}); trying curl...`);
  }

  try {
    run('curl', ['-L', '--fail', '--silent', '--show-error', '-o', targetPath, url]);
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`curl download failed (${message}); trying gh release download...`);
  }

  fs.rmSync(targetPath, { force: true });
  run('gh', ['release', 'download', tagName, '-R', OPENCLI_REPO, '-p', assetName, '--dir', path.dirname(targetPath), '--clobber']);
}

function findManifestDir(root) {
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const manifest = path.join(current, 'manifest.json');
    if (fs.existsSync(manifest)) return current;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) stack.push(path.join(current, entry.name));
    }
  }
  return null;
}

function patchExtensionHost(manifestDir) {
  const backgroundPath = path.join(manifestDir, 'dist', 'background.js');
  if (!fs.existsSync(backgroundPath)) return false;
  const original = fs.readFileSync(backgroundPath, 'utf8');
  const patched = original.replace('const DAEMON_HOST = "localhost";', 'const DAEMON_HOST = "127.0.0.1";');
  if (patched === original) return false;
  fs.writeFileSync(backgroundPath, patched);
  return true;
}

async function ensureExtension() {
  fs.mkdirSync(extensionRoot, { recursive: true });
  const opencliVersion = currentOpenCliVersion();
  const tagName = `v${opencliVersion}`;
  const release = await fetchJson(`https://api.github.com/repos/${OPENCLI_REPO}/releases/tags/${tagName}`);
  const asset = (release.assets ?? []).find((item) => /extension.*\.zip$/i.test(item.name));
  if (!asset) {
    throw new Error(`No extension zip found on ${release.html_url}`);
  }

  const assetBase = asset.name.replace(/\.zip$/i, '');
  const targetDir = path.join(extensionRoot, assetBase);
  const manifestDir = fs.existsSync(targetDir) ? findManifestDir(targetDir) : null;
  if (manifestDir) {
    patchExtensionHost(manifestDir);
    return { manifestDir, assetName: asset.name, reused: true };
  }

  const zipPath = path.join(extensionRoot, asset.name);
  console.log(`Downloading ${asset.name}...`);
  await downloadFile(asset.browser_download_url, zipPath, tagName, asset.name);

  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  unzipArchive(zipPath, targetDir);

  const unpackedManifestDir = findManifestDir(targetDir);
  if (!unpackedManifestDir) {
    throw new Error(`Extension manifest.json not found after unpacking ${asset.name}`);
  }
  patchExtensionHost(unpackedManifestDir);
  return { manifestDir: unpackedManifestDir, assetName: asset.name, reused: false };
}

function stopExistingProfile(profileDir) {
  if (process.platform === 'win32') {
    try {
      const escaped = String(profileDir).replace(/'/g, "''");
      const script = 'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like \'*' + escaped + '*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }';
      run('powershell.exe', ['-NoProfile', '-Command', script]);
    } catch {
    }
    return;
  }
  try {
    run('pkill', ['-f', profileDir]);
  } catch {
  }
}

function unzipArchive(zipPath, targetDir) {
  if (process.platform === 'win32') {
    try {
      run('tar', ['-xf', zipPath, '-C', targetDir]);
      return;
    } catch {
    }
    run('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${targetDir}' -Force`]);
    return;
  }
  run('unzip', ['-q', '-o', zipPath, '-d', targetDir]);
}

function launchBrowser({ browser, extensionDir, profileDir, debugPort, url }) {
  fs.mkdirSync(profileDir, { recursive: true });
  stopExistingProfile(profileDir);
  const args = [
    `--user-data-dir=${profileDir}`,
    `--load-extension=${extensionDir}`,
    `--disable-extensions-except=${extensionDir}`,
    `--remote-debugging-port=${debugPort}`,
    '--no-first-run',
    '--new-window',
    url,
  ];
  const child = spawn(browser.path, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const browser = chooseBrowser(options.browser);
  const profileDir = options.profileDir || browser.profileDir;

  if (options.dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      force: options.force,
      browser: browser.name,
      browser_path: browser.path,
      profile_dir: profileDir,
      url: options.url,
      debug_port: options.debugPort,
      opens_deepseek_only: true,
    }, null, 2));
    return;
  }

  if (!options.force) {
    try {
      const listOut = safeRun(...opencliExec(['profile', 'list']));
      if (/connected/i.test(listOut)) {
        console.log('Existing connected profiles found; reusing them instead of launching a new browser.');
        console.log(listOut.trim());
        console.log('Tip: run `opencli profile use <id>` to select the logged-in profile, then `node scripts/preflight.mjs --profile <id>`.');
        console.log('Use --force to launch a new dedicated profile anyway.');
        return;
      }
    } catch {
      // continue to launch
    }
  }

  console.log(`opencli ${currentOpenCliVersion()}`);
  if (options.restartDaemon) {
    console.log(safeRun(...opencliExec(['daemon', 'restart'])));
  }

  const extension = await ensureExtension();
  console.log(`${extension.reused ? 'Using' : 'Installed'} ${extension.assetName}`);
  console.log(`Extension path: ${extension.manifestDir}`);
  console.log(`${browser.name} profile: ${profileDir}`);
  console.log(`Opening: ${options.url}`);

  launchBrowser({
    browser,
    extensionDir: extension.manifestDir,
    profileDir,
    debugPort: options.debugPort,
    url: options.url,
  });
  console.log(`${browser.name} launched. Waiting for Browser Bridge...`);

  await new Promise((resolve) => setTimeout(resolve, 5000));
  console.log('\n=== opencli doctor ===');
  console.log(safeRun(...opencliExec(['doctor'])));
  console.log('\n=== opencli profile list ===');
  console.log(safeRun(...opencliExec(['profile', 'list'])));
  console.log(`\nIf DeepSeek asks for login, finish login in the opened ${browser.name} window and rerun \`opencli deepseek whoami -f json\`.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
