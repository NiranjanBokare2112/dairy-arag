// Short, human-readable device label from a browser user-agent string, e.g. "Android फोन · Chrome".
// Only for the owner's login history; never used for security decisions.
export function deviceLabel(ua = '') {
  const s = String(ua);
  const os = /Android/i.test(s) ? 'android' : /iPhone|iPad|iPod/i.test(s) ? 'ios' : /Windows/i.test(s) ? 'windows'
    : /Mac OS X|Macintosh/i.test(s) ? 'mac' : /Linux/i.test(s) ? 'linux' : 'other';
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /SamsungBrowser/.test(s) ? 'Samsung Internet'
    : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : '';
  const mobile = /Mobi|Android|iPhone/i.test(s);
  return { os, browser, mobile };
}
