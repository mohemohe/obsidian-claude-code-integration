import { cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const src = 'dist';
const pluginName = 'obsidian-claude-code-integration';
const home = homedir();
const basePath = join(home, 'Library/Mobile Documents/iCloud~md~obsidian/Documents/Develop/.obsidian/plugins');
const dest = join(basePath, pluginName);

try {
  await mkdir(basePath, { recursive: true });
  await mkdir(dest, { recursive: true });

  await cp(src, dest, { recursive: true, force: true });
  console.log(`Build files copied successfully as "${pluginName}" to:`);
  console.log(`  ${dest}`);
} catch (error) {
  console.error('Error copying files:', error);
  process.exit(1);
}

