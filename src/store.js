/**
 * store.js -- user data.
 *
 * Deliberately behind a narrow interface. Today it's localStorage; swapping in
 * IndexedDB or a synced backend later means rewriting this file and nothing
 * else. Callers never touch a storage key directly.
 */

const PREFIX = 'workout-companion/v1/';
const KEYS = {
  sessions: `${PREFIX}sessions`,
  draft: `${PREFIX}draft`,
  live: `${PREFIX}live`,
  log: `${PREFIX}log`,
  oneRm: `${PREFIX}one-rm`,
  prefs: `${PREFIX}prefs`,
  customExercises: `${PREFIX}custom-exercises`,
  timer: `${PREFIX}timer`,
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    // Corrupt or unavailable storage shouldn't take the app down -- the user
    // can still build a session, they just won't keep it.
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const store = {
  getSessions: () => read(KEYS.sessions, []),
  setSessions: (v) => write(KEYS.sessions, v),

  /**
   * The session currently being built, saved or not. Kept separately from
   * `sessions` so a reload mid-workout -- which is exactly what a phone does
   * when it reclaims memory -- doesn't lose what you were doing.
   */
  getDraft: () => read(KEYS.draft, null),
  setDraft: (v) => write(KEYS.draft, v),

  /**
   * The session in progress: which sets are ticked and what was actually
   * lifted. Separate from the draft because it is transient work-in-progress
   * that gets consumed into the log at "Finish", and because losing it to a
   * reload halfway through a workout would be the worst possible moment.
   */
  getLive: () => read(KEYS.live, null),
  setLive: (v) => write(KEYS.live, v),
  clearLive: () => localStorage.removeItem(KEYS.live),

  /**
   * A conditioning workout being run: which step, how much of it is left, and
   * what has been counted so far. Separate from `live` because the two run
   * completely different machinery -- one ticks off sets, the other walks a
   * clock -- and because a session can hold both, with the finisher's timer
   * outliving the lifting it followed.
   *
   * Written on every step change rather than every tick: the clock is derived
   * from an end timestamp, so a reload mid-round resumes at the right second
   * without storing the seconds.
   */
  getTimer: () => read(KEYS.timer, null),
  setTimer: (v) => write(KEYS.timer, v),
  clearTimer: () => localStorage.removeItem(KEYS.timer),

  getLog: () => read(KEYS.log, []),
  setLog: (v) => write(KEYS.log, v),

  /** { [exerciseId]: kg } -- your one-rep maxes, keyed by catalog id. */
  getOneRm: () => read(KEYS.oneRm, {}),
  setOneRm: (v) => write(KEYS.oneRm, v),

  getPrefs: () => read(KEYS.prefs, {}),
  setPrefs: (v) => write(KEYS.prefs, v),

  /**
   * Exercises the user wrote themselves, in the same shape as a catalog row
   * but with a string id ('u3') so it can never collide with the workbook's
   * numeric ones. Kept out of the shipped catalog entirely -- re-running the
   * extractor rewrites data/exercises.json and would take these with it.
   */
  getCustomExercises: () => read(KEYS.customExercises, []),
  setCustomExercises: (v) => write(KEYS.customExercises, v),

  /** Everything the user owns, for backup or moving to another device. */
  exportAll() {
    return {
      format: 'workout-companion/v1',
      exported: new Date().toISOString(),
      sessions: this.getSessions(),
      draft: this.getDraft(),
      live: this.getLive(),
      timer: this.getTimer(),
      log: this.getLog(),
      oneRm: this.getOneRm(),
      prefs: this.getPrefs(),
      customExercises: this.getCustomExercises(),
    };
  },

  importAll(payload) {
    if (!payload || payload.format !== 'workout-companion/v1') {
      throw new Error('Not a Workout Companion backup file.');
    }
    if (payload.sessions) this.setSessions(payload.sessions);
    if (payload.draft) this.setDraft(payload.draft);
    if (payload.live) this.setLive(payload.live);
    if (payload.timer) this.setTimer(payload.timer);
    if (payload.log) this.setLog(payload.log);
    if (payload.oneRm) this.setOneRm(payload.oneRm);
    if (payload.prefs) this.setPrefs(payload.prefs);
    // Absent from any backup taken before custom exercises existed, which is
    // fine -- those files simply restore a library with none in it.
    if (payload.customExercises) this.setCustomExercises(payload.customExercises);
  },

  clearAll() {
    for (const key of Object.values(KEYS)) localStorage.removeItem(key);
  },
};

export function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
