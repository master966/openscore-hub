// 화면 공통 도구 — 내 악보(app.js)와 허브(hub.js)가 함께 쓴다.
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

// ---------- 아이콘 (stroke = currentColor) ----------
const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
export const I = {
  music: svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
  video: svg('<rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/>'),
  play: svg('<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor" stroke="none"/>'),
  pause: svg('<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>'),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>'),
  print: svg('<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>'),
  heart: svg('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>'),
  heartFill: svg('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" fill="currentColor"/>'),
  share: svg('<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/>'),
  user: svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
};

export const EMOJI = { piano: '🎹', guitar: '🎸', bass: '🎸', drums: '🥁', vocals: '🎤', strings: '🎻', brass: '🎺', winds: '🎷', synth: '🎛️', other: '🎵' };
export const CATEGORY_NAMES = { piano: '피아노', guitar: '기타', bass: '베이스', drums: '드럼', vocals: '보컬', strings: '현악기', brass: '금관', winds: '목관', synth: '신스', other: '그 외' };

const KEY_NAMES = { C: 'C', Db: 'D♭', D: 'D', Eb: 'E♭', E: 'E', F: 'F', 'F#': 'F♯', G: 'G', Ab: 'A♭', A: 'A', Bb: 'B♭', B: 'B' };
/** "a minor" → "A단조" */
export function koKey(k) {
  if (!k) return '';
  const [tonic, mode] = k.split(' ');
  const t = tonic[0].toUpperCase() + tonic.slice(1);
  return `${KEY_NAMES[t] || t}${mode === 'minor' ? '단조' : '장조'}`;
}
/** 유닉스 초 또는 ISO 문자열 → "3분 전" */
export function ago(t) {
  const sec = typeof t === 'string' ? Date.parse(t) / 1000 : t;
  const d = Date.now() / 1000 - sec;
  if (d < 60) return '방금';
  if (d < 3600) return `${Math.floor(d / 60)}분 전`;
  if (d < 86400) return `${Math.floor(d / 3600)}시간 전`;
  if (d < 172800) return '어제';
  return new Date(sec * 1000).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}
export const mmss = (ms) => { const s = Math.max(0, Math.floor((ms || 0) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

let toastTimer;
export function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// 상단 바 그림자
window.addEventListener('scroll', () => $('topbar')?.classList.toggle('scrolled', window.scrollY > 4), { passive: true });
