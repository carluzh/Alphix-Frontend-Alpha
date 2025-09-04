// Shared cache version management using file persistence for serverless
import { promises as fs } from 'fs';
import path from 'path';

const VERSION_FILE = path.join(process.cwd(), '.cache-version');
let memoryCacheVersion: number | null = null;
let versionInitialized = false;

async function initializeVersion(): Promise<void> {
  if (!versionInitialized) {
    try {
      const content = await fs.readFile(VERSION_FILE, 'utf-8');
      memoryCacheVersion = parseInt(content.trim(), 10) || Date.now();
    } catch {
      memoryCacheVersion = Date.now();
    }
    versionInitialized = true;
  }
}

async function readVersionFromFile(): Promise<number> {
  if (!versionInitialized) {
    await initializeVersion();
  }
  return memoryCacheVersion!;
}

async function writeVersionToFile(version: number): Promise<void> {
  try {
    await fs.writeFile(VERSION_FILE, version.toString(), 'utf-8');
  } catch (error) {
    console.warn('Failed to write cache version to file:', error);
  }
}

export async function getGlobalCacheVersion(): Promise<number> {
  return await readVersionFromFile();
}

export async function bumpGlobalCacheVersion(): Promise<number> {
  const newVersion = Date.now();
  memoryCacheVersion = newVersion;
  await writeVersionToFile(newVersion);
  versionInitialized = true;
  return newVersion;
}

export async function getCacheKeyWithVersion(baseKey: string): Promise<string[]> {
  const version = await getGlobalCacheVersion();
  return [`${baseKey}-v${version}`];
}

// Synchronous version for unstable_cache (initializes if needed)
export function getCacheKeyWithVersionSync(baseKey: string): string[] {
  if (!versionInitialized) {
    // For sync usage, use a default or try to read synchronously
    try {
      const fsSync = require('fs');
      const content = fsSync.readFileSync(VERSION_FILE, 'utf-8');
      memoryCacheVersion = parseInt(content.trim(), 10) || Date.now();
      versionInitialized = true;
    } catch {
      memoryCacheVersion = Date.now();
      versionInitialized = true;
    }
  }
  return [`${baseKey}-v${memoryCacheVersion!}`];
}
