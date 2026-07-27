/**
 * Local cache for GitHub owner avatars.
 *
 * TreeView nodes point their `iconPath` at remote `github.com/{owner}.png` URLs,
 * which re-fetch on every refresh and cause UI jank (especially on slow links).
 * This module downloads each avatar once into `globalStorage/avatar-cache/`,
 * then serves `vscode.Uri.file(...)` paths — zero network after the first hit.
 *
 * First miss returns undefined (caller shows a placeholder icon); the download
 * runs in the background and fires `onReady` so the provider can refresh.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as https from 'https';

const SUBDIR = 'avatar-cache';
const SIZE = 32;
const FETCH_TIMEOUT = 8000;

let cacheDir: string | null = null;
const inflight = new Map<string, Promise<string | null>>();
const readyCallbacks = new Set<(owner: string) => void>();

/** Initialize the cache directory. Call once in activate(). */
export function init(context: vscode.ExtensionContext): void {
  cacheDir = path.join(context.globalStorageUri.fsPath, SUBDIR);
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
  } catch (e) {
    console.warn('[skills-deck] avatar cache dir failed:', e);
    cacheDir = null;
  }
}

/**
 * Return a local file Uri for the owner's avatar if already cached, else
 * undefined (and kick off a background download that notifies `onReady`).
 */
export function getAvatar(owner: string): vscode.Uri | undefined {
  if (!cacheDir) { return undefined; }
  const file = path.join(cacheDir, `${owner}.png`);
  if (fs.existsSync(file)) {
    return vscode.Uri.file(file);
  }
  void ensureDownloaded(owner, file);
  return undefined;
}

/** Subscribe to "an avatar finished downloading" notifications. */
export function onReady(cb: (owner: string) => void): () => void {
  readyCallbacks.add(cb);
  return () => { readyCallbacks.delete(cb); };
}

function ensureDownloaded(owner: string, file: string): Promise<string | null> {
  const existing = inflight.get(owner);
  if (existing) { return existing; }
  const promise = download(owner, file)
    .then(result => {
      if (result) {
        for (const cb of readyCallbacks) { cb(owner); }
      }
      return result;
    })
    .finally(() => { inflight.delete(owner); });
  inflight.set(owner, promise);
  return promise;
}

function download(owner: string, file: string): Promise<string | null> {
  if (!cacheDir) { return Promise.resolve(null); }
  const url = `https://github.com/${encodeURIComponent(owner)}.png?size=${SIZE}`;
  return new Promise(resolve => {
    const req = https.get(url, res => {
      // GitHub redirects (302) to avatars.githubusercontent.com; follow once.
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(followRedirect(res.headers.location, file));
        return;
      }
      if (!res.statusCode || res.statusCode >= 400 || !res.headers['content-type']?.includes('image')) {
        res.resume();
        resolve(null);
        return;
      }
      const stream = fs.createWriteStream(file);
      res.pipe(stream);
      stream.on('finish', () => { stream.close(() => resolve(file)); });
      stream.on('error', () => { cleanup(file); resolve(null); });
    });
    req.setTimeout(FETCH_TIMEOUT, () => { req.destroy(); resolve(null); });
    req.on('error', () => { cleanup(file); resolve(null); });
  });
}

function followRedirect(location: string, file: string): Promise<string | null> {
  return new Promise(resolve => {
    const req = https.get(location, res => {
      if (!res.statusCode || res.statusCode >= 400) { res.resume(); resolve(null); return; }
      const stream = fs.createWriteStream(file);
      res.pipe(stream);
      stream.on('finish', () => { stream.close(() => resolve(file)); });
      stream.on('error', () => { cleanup(file); resolve(null); });
    });
    req.setTimeout(FETCH_TIMEOUT, () => { req.destroy(); resolve(null); });
    req.on('error', () => { cleanup(file); resolve(null); });
  });
}

function cleanup(file: string): void {
  try { fs.unlinkSync(file); } catch { /* ignore */ }
}
