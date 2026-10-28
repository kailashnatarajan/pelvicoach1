import { NormalizedSession } from './sessionSchema';
import * as SF from './signalFeedback';

/**
 * Bridge between the Case Generator & Replay tab (which owns the playhead) and the
 * Biofeedback & Simulator tab (which reads the replayed signal as its squeeze source).
 * Both tabs stay mounted, so replay keeps running while the other tab is in view.
 */

interface ReplaySnapshot {
  session: NormalizedSession | null;
  summary: SF.SessionSummary | null;
  cfg: SF.FeedbackConfig;
  pos: number;
  playing: boolean;
}

type Listener = () => void;

let snap: ReplaySnapshot = {
  session: null,
  summary: null,
  cfg: { ...SF.DEFAULTS },
  pos: 0,
  playing: false,
};

// Low (5th percentile) envelope level of the loaded session, used as the "relaxed" floor.
let floor = 0;
let floorFor: NormalizedSession | null = null;

const playListeners = new Set<Listener>();
const modeListeners = new Set<Listener>();

export const ReplayBridge = {
  /** True while the Biofeedback tab is using the replay as its signal source (replay loops). */
  loop: false,

  publish(next: ReplaySnapshot) {
    snap = next;
    if (next.session && next.session !== floorFor) {
      floorFor = next.session;
      const sorted = Float64Array.from(next.session.envelope).sort();
      floor = sorted[Math.floor(0.05 * next.session.t.length)] ?? 0;
    }
  },

  ready(): boolean {
    return !!snap.session && !!snap.summary;
  },

  isPlaying(): boolean {
    return snap.playing;
  },

  /** Current replay value in the Biofeedback tab's feature format. */
  feature(cal: boolean): { pf: number; pct: number; mr: number } {
    const s = snap.session;
    const sum = snap.summary;
    if (!s || !sum) return { pf: 4, pct: 0, mr: 0.03 };
    const i = SF.indexAt(s, snap.pos);
    const pk = sum.envelopePeak;
    const fb = SF.feedbackAt(s, snap.pos, snap.cfg, sum.refLevel);
    const nrm = Math.max(0, Math.min(1.3, pk > floor ? (s.envelope[i] - floor) / (pk - floor) : 0));
    let pf = cal ? 100 : 4 + 96 * nrm;
    if (fb.quality === 'flat') pf = 0.4;
    return {
      pf,
      pct: Math.round(Math.min(100, cal ? 100 : nrm * 100)),
      mr: fb.quality === 'line_interference' ? 0.6 : 0.03,
    };
  },

  /** Biofeedback tab asks the Case Generator to start playing. */
  requestPlay() {
    playListeners.forEach((fn) => fn());
  },
  onPlayRequest(fn: Listener) {
    playListeners.add(fn);
    return () => {
      playListeners.delete(fn);
    };
  },

  /** Case Generator asks the Biofeedback tab to switch its source to the replay. */
  requestReplayMode() {
    modeListeners.forEach((fn) => fn());
  },
  onReplayModeRequest(fn: Listener) {
    modeListeners.add(fn);
    return () => {
      modeListeners.delete(fn);
    };
  },
};
