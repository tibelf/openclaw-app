import { app } from 'electron';
import path from 'path';
import fs from 'node:fs';

const STORE_FILE = 'auth.json';

interface AuthData {
  accessToken?: string;
  userId?: number;
  username?: string;
  apiKey?: string;
}

function getStorePath(): string {
  return path.join(app.getPath('userData'), STORE_FILE);
}

function readStore(): AuthData {
  try {
    const content = fs.readFileSync(getStorePath(), 'utf-8');
    return JSON.parse(content) as AuthData;
  } catch {
    return {};
  }
}

function writeStore(data: AuthData): void {
  const storePath = getStorePath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function getStoredAuth(): AuthData {
  return readStore();
}

export function saveAuth(data: Partial<AuthData>): void {
  const current = readStore();
  writeStore({ ...current, ...data });
}

export function clearAuth(): void {
  writeStore({});
}
