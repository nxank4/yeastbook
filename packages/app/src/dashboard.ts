import { join } from "node:path";
import { homedir } from "node:os";
import { readdir, stat, mkdir } from "node:fs/promises";

const RECENTS_FILE = join(homedir(), ".yeastbook", "recents.json");

interface RecentEntry {
  path: string;
  lastOpened: string;
}

export async function getRecents(): Promise<RecentEntry[]> {
  try {
    const file = Bun.file(RECENTS_FILE);
    if (await file.exists()) return await file.json();
  } catch {}
  return [];
}

export async function addRecent(path: string): Promise<void> {
  const recents = await getRecents();
  const filtered = recents.filter((r) => r.path !== path);
  filtered.unshift({ path, lastOpened: new Date().toISOString() });
  const trimmed = filtered.slice(0, 10);
  await mkdir(join(homedir(), ".yeastbook"), { recursive: true });
  await Bun.write(RECENTS_FILE, JSON.stringify(trimmed, null, 2));
}

export async function listNotebooks(dir: string): Promise<{ name: string; path: string; size: number; modified: string }[]> {
  const results: { name: string; path: string; size: number; modified: string }[] = [];
  try {
    const files = await readdir(dir);
    for (const f of files) {
      if (!f.endsWith(".ybk") && !f.endsWith(".ipynb")) continue;
      const fullPath = join(dir, f);
      try {
        const s = await stat(fullPath);
        results.push({ name: f, path: fullPath, size: s.size, modified: s.mtime.toISOString() });
      } catch {}
    }
  } catch {}
  return results.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
}
