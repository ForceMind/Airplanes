const KEY = 'airplanes.preferences.v1';
const SCORE_KEY = 'airplanes.records.v1';
export const DEFAULT_SELECTION = Object.freeze({ faction: 'raf', mission: 'channel', difficulty: 'rookie', skins: { raf: 'raf-classic', luftwaffe: 'luftwaffe-grey' } });
export function readSelection(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(KEY) || 'null') || {};
    return {
      faction: value.faction === 'luftwaffe' ? 'luftwaffe' : 'raf',
      mission: ['channel', 'intercept', 'survival'].includes(value.mission) ? value.mission : 'channel',
      difficulty: value.difficulty === 'ace' ? 'ace' : 'rookie',
      skins: { raf: typeof value.skins?.raf === 'string' ? value.skins.raf : 'raf-classic', luftwaffe: typeof value.skins?.luftwaffe === 'string' ? value.skins.luftwaffe : 'luftwaffe-grey' },
    };
  } catch { return { ...DEFAULT_SELECTION, skins: { ...DEFAULT_SELECTION.skins } }; }
}
export function saveSelection(value, storage = globalThis.localStorage) {
  try { storage?.setItem(KEY, JSON.stringify(value)); return true; } catch { return false; }
}
export function saveRecord(selection, score, storage = globalThis.localStorage) {
  const key = `${selection.faction}:${selection.mission}:${selection.difficulty}`;
  const normalized = Math.max(0, Math.floor(Number(score) || 0));
  try {
    const records = JSON.parse(storage?.getItem(SCORE_KEY) || '{}');
    const previous = Number(records[key]) || 0;
    const best = Math.max(previous, normalized);
    records[key] = best;
    storage?.setItem(SCORE_KEY, JSON.stringify(records));
    return { best, isNew: normalized > previous, saved: true };
  } catch { return { best: normalized, isNew: false, saved: false }; }
}
