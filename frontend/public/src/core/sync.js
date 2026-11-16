// Client-side retry queue for collection entries (A3.5). If the desktop server can't be reached
// (Wi-Fi blip), the entry, with its client UUID, is kept on the phone and resent later.
// Resending is safe because the server treats the same UUID as the same entry.
import { api } from '../api/index.js';

const KEY = 'arag.pending.v1';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const write = (q) => { try { localStorage.setItem(KEY, JSON.stringify(q)); } catch { /* ignore */ } };

export const pendingCount = () => read().length;
export const pendingEntries = () => read();

const isNetworkError = (err) => err?.code === 'network' || err instanceof TypeError;

/** Save now, or queue on network failure. Business errors (duplicate, rate…) are thrown to the caller. */
export async function saveCollection(entry) {
  try { return { saved: await api.addCollection(entry), queued: false }; } catch (err) {
    if (!isNetworkError(err)) throw err;
    write([...read().filter((e) => e.id !== entry.id), entry]);
    return { saved: null, queued: true };
  }
}

/** Try to send everything queued. Returns { sent, failed: [{entry, err}] }. */
export async function flush() {
  const q = read(); const keep = []; const failed = []; let sent = 0;
  for (const e of q) {
    try { await api.addCollection(e); sent++; } catch (err) {
      if (isNetworkError(err)) keep.push(e); else failed.push({ entry: e, err });
    }
  }
  write(keep);
  return { sent, failed };
}

window.addEventListener('online', () => { flush(); });
