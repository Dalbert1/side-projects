// localStorage save slot. Everything is wrapped because storage can be blocked.
const KEY = 'lightyears918.save.v1';

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data;
  } catch {
    return null;
  }
}

export function hasGame(save) {
  return !!(save && save.starId);
}

export function writeSave(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // storage full or blocked, nothing to do
  }
}

export function clearSave() {
  try {
    const s = loadSave();
    if (s && s.settings) localStorage.setItem(KEY, JSON.stringify({ settings: s.settings }));
    else localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
