// 악보 보기 + 하단 연습 플레이어 (alphaTab). index.html 과 hub.html 이 같은 id 의 요소를 둔다:
// #parts #views #zoom-* #viewer #sheet-loading #sheet-empty #part-note #player #play #bar* #time #player-title #speed* #metro #loop #rewind
import { $, esc, store, I, toast, mmss, EMOJI } from './common.js';

const AT_VER = '1.8.4';
const AT_BASE = `https://cdn.jsdelivr.net/npm/@coderline/alphatab@${AT_VER}/dist/`;
let alphaTab = null; // 첫 화면을 막지 않도록 악보를 열 때 불러온다
const loadAlphaTab = () => alphaTab ? Promise.resolve(alphaTab) : import(AT_BASE + 'alphaTab.min.mjs').then((m) => (alphaTab = m));

let at = null;
let parts = [];
let current = null;     // 보고 있는 파트
let view = null;        // both | tab | score
let getBytes = null;    // (part, 파일키값) => Promise<ArrayBuffer>
let onSelect = () => {};

/**
 * 파트 탭을 그리고 첫 파트를 연다.
 * parts: [{label, category, note_count, musicxml, tab_musicxml, ...}]
 * opts.getBytes(part, file): 파일 내용을 ArrayBuffer 로 (로컬 서버 또는 허브 저장소)
 * opts.onSelect(part): 파트가 바뀔 때 (내려받기 목록 갱신 등)
 */
export function showParts(list, opts) {
  parts = list;
  getBytes = opts.getBytes;
  onSelect = opts.onSelect || (() => {});
  $('parts').innerHTML = parts.map((p, i) =>
    `<button type="button" class="part" data-i="${i}" aria-pressed="false"><span class="emo">${EMOJI[p.category] || '🎵'}</span>
      <span><div class="nm">${esc(p.label)}</div><div class="ct">${(p.note_count || 0).toLocaleString()}음</div></span></button>`).join('');
  $('parts').onclick = (e) => { const b = e.target.closest('.part'); if (b) { view = null; selectPart(parts[+b.dataset.i]); } };
  view = null;
  const first = parts.find((p) => p.musicxml) || parts[0];
  if (first) selectPart(first); else hideViewer();
}
export const currentPart = () => current;
export function hideViewer() {
  current = null;
  at?.stop();
  $('player').classList.add('hidden');
  document.documentElement.style.setProperty('--player-h', '0px');
}
export const printScore = () => at?.print(undefined, { notation: { elements: { scoreTitle: true } } });

function viewsFor(p) {
  const S = alphaTab.StaveProfile;
  return [['both', '오선보+타브', p.tab_musicxml, S.ScoreTab], ['tab', '타브', p.tab_musicxml, S.Tab],
          ['score', '오선보', p.musicxml, S.Default]].filter(([, , f]) => f);
}

async function selectPart(p) {
  current = p;
  $('parts').querySelectorAll('.part').forEach((b) => b.setAttribute('aria-pressed', parts[+b.dataset.i] === p));
  $('parts').querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  onSelect(p);
  sheetLoading(true);
  await loadAlphaTab();
  if (current !== p) return; // 그사이 다른 파트를 눌렀으면 무시
  const views = viewsFor(p);
  if (!views.find(([k]) => k === view)) view = views[0]?.[0] || null;
  $('views').innerHTML = views.length > 1
    ? views.map(([k, t]) => `<button type="button" data-k="${k}" aria-pressed="${k === view}">${t}</button>`).join('') : '';
  $('views').classList.toggle('hidden', views.length < 2);
  $('views').onclick = (e) => { const b = e.target.closest('button'); if (b && b.dataset.k !== view) { view = b.dataset.k; selectPart(p); } };

  const [, , src, profile] = views.find(([k]) => k === view) || [];
  $('sheet-empty').classList.toggle('hidden', !!src);
  $('viewer').classList.toggle('hidden', !src);
  $('part-note').textContent = src ? 'AI 자동 채보라 틀린 음이 있을 수 있어요. MusicXML 을 MuseScore 에서 열면 고칠 수 있어요.' : '';
  if (!src) { sheetLoading(false); hidePlayerOnly(); return; }

  try {
    const buf = await getBytes(p, src);
    if (current !== p) return;
    const api = ensureAlphaTab();
    api.stop();
    setPlayable(false);
    const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(buf), api.settings);
    if (view === 'both') showScoreWithTab(score, p.category);
    fixDrumNoteheads(score);
    api.settings.display.staveProfile = profile;
    api.updateSettings();
    api.renderScore(score);
    showPlayer(p);
  } catch (err) {
    sheetLoading(false);
    toast('악보를 불러오지 못했어요: ' + err.message);
  }
}

// ---------- alphaTab ----------
const ZOOMS = [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.4];
let zoom = +store.get('sd-zoom', window.innerWidth < 600 ? 0.8 : 1.0);
function ensureAlphaTab() {
  if (at) return at;
  at = new alphaTab.AlphaTabApi($('viewer'), {
    core: { fontDirectory: AT_BASE + 'font/', useWorkers: false },
    // 두 번째 성부부터는 기본이 회색인데, 피아노 왼손(5번 성부)까지 흐리게 나와서 거의 검정으로
    display: { scale: zoom, resources: { secondaryGlyphColor: '#2b2b2b' } },
    // 자동 스크롤은 재생 중에만 (악보를 열 때마다 화면이 내려가지 않게)
    player: { enablePlayer: true, soundFont: AT_BASE + 'soundfont/sonivox.sf2', scrollElement: document.scrollingElement,
              scrollMode: alphaTab.ScrollMode.Off, scrollOffsetY: -120 },
  });
  // 곡 제목은 페이지 위에 이미 있고, 악보 안 제목은 폰 폭보다 길어 잘리므로 화면에서는 숨긴다 (인쇄 때만 표시)
  const NE = alphaTab.NotationElement;
  for (const e of [NE.ScoreTitle, NE.ScoreSubTitle, NE.ScoreArtist, NE.ScoreAlbum, NE.ScoreWords, NE.ScoreMusic, NE.ScoreWordsAndMusic, NE.ScoreCopyright]) {
    at.settings.notation.elements.set(e, false);
  }
  at.updateSettings();
  at.renderStarted.on(() => sheetLoading(true));
  at.renderFinished.on(() => sheetLoading(false));
  at.playerReady.on(() => setPlayable(true));
  at.playerStateChanged.on((e) => {
    const playing = e.state === alphaTab.synth.PlayerState.Playing;
    $('play').innerHTML = playing ? I.pause : I.play;
    $('play').setAttribute('aria-label', playing ? '일시정지' : '재생');
    at.settings.player.scrollMode = playing ? alphaTab.ScrollMode.OffScreen : alphaTab.ScrollMode.Off;
    at.updateSettings();
  });
  at.playerPositionChanged.on((e) => { if (!seeking) setPosition(e.currentTime, e.endTime); });
  applyPlayerPrefs();
  return at;
}
function sheetLoading(on) { $('sheet-loading').classList.toggle('hidden', !on); }

// alphaTab 1.8.4 의 MusicXML 가져오기는 드럼 소리마다 음표머리를 비워 두어(-1) 드럼 악보가 안 그려진다.
const CYMBALS = new Set([42, 44, 46, 49, 51, 52, 53, 55, 57, 59]);
function fixDrumNoteheads(score) {
  const S = alphaTab.model.MusicFontSymbol;
  for (const track of score.tracks) for (const a of track.percussionArticulations || []) {
    if (a.noteHeadDefault !== -1) continue;
    const x = CYMBALS.has(a.outputMidiNumber);
    a.noteHeadDefault = x ? S.NoteheadXBlack : S.NoteheadBlack;
    a.noteHeadHalf = x ? S.NoteheadXHalf : S.NoteheadHalf;
    a.noteHeadWhole = x ? S.NoteheadXWhole : S.NoteheadWhole;
  }
}
// 타브 파일은 TAB 보표만 켜져 있어서, 오선보를 같이 그리려면 직접 켠다. 기타·베이스는 8vb 음자리표.
function showScoreWithTab(score, category) {
  const { Clef, Ottavia } = alphaTab.model;
  for (const track of score.tracks) for (const staff of track.staves) {
    staff.showStandardNotation = true;
    staff.showTablature = true;
    for (const bar of staff.bars) { bar.clef = category === 'bass' ? Clef.F4 : Clef.G2; bar.clefOttava = Ottavia._8vb; }
  }
}

// ---------- 확대/축소 ----------
function setZoom(z) {
  zoom = z;
  store.set('sd-zoom', z);
  $('zoom-val').textContent = `${Math.round(z * 100)}%`;
  if (at) { at.settings.display.scale = z; at.updateSettings(); at.render(); }
}
$('zoom-out').onclick = () => setZoom(ZOOMS[Math.max(0, ZOOMS.findIndex((z) => z >= zoom) - 1)] ?? ZOOMS[0]);
$('zoom-in').onclick = () => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.findIndex((z) => z > zoom))] ?? ZOOMS.at(-1));
$('zoom-val').textContent = `${Math.round(zoom * 100)}%`;

// ---------- 하단 플레이어 ----------
let seeking = false, endTime = 0;
const prefs = { speed: +store.get('sd-speed', 1), metro: store.get('sd-metro', '0') === '1', loop: store.get('sd-loop', '0') === '1' };
function applyPlayerPrefs() {
  if (!at) return;
  at.playbackSpeed = prefs.speed;
  at.metronomeVolume = prefs.metro ? 1 : 0;
  at.countInVolume = prefs.metro ? 1 : 0;
  at.isLooping = prefs.loop;
}
function renderTools() {
  $('speed-val').textContent = `${Math.round(prefs.speed * 100)}%`;
  $('speed').value = String(prefs.speed);
  $('metro').setAttribute('aria-pressed', prefs.metro);
  $('loop').setAttribute('aria-pressed', prefs.loop);
}
$('speed').onchange = () => { prefs.speed = +$('speed').value; store.set('sd-speed', prefs.speed); renderTools(); applyPlayerPrefs(); toast(`재생 속도 ${Math.round(prefs.speed * 100)}%`); };
$('metro').onclick = () => { prefs.metro = !prefs.metro; store.set('sd-metro', prefs.metro ? '1' : '0'); renderTools(); applyPlayerPrefs(); toast(prefs.metro ? '메트로놈 켬 (시작 전 한 마디 예비박)' : '메트로놈 끔'); };
$('loop').onclick = () => { prefs.loop = !prefs.loop; store.set('sd-loop', prefs.loop ? '1' : '0'); renderTools(); applyPlayerPrefs(); toast(prefs.loop ? '반복 재생 켬 · 악보에서 마디를 끌어 구간을 고를 수 있어요' : '반복 재생 끔'); };
$('rewind').onclick = () => at?.stop();
$('play').onclick = () => at?.playPause();
renderTools();

function setPlayable(ok) { $('play').disabled = !ok; }
function setPosition(cur, end) {
  endTime = end || endTime;
  const ratio = endTime ? Math.min(1, cur / endTime) : 0;
  $('bar-fill').style.width = `${ratio * 100}%`;
  $('bar-knob').style.left = `${ratio * 100}%`;
  $('time').textContent = `${mmss(cur)} / ${mmss(endTime)}`;
}
function seekFrom(e) {
  const rect = $('bar').getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  setPosition(ratio * endTime, endTime);
  return ratio;
}
$('bar').addEventListener('pointerdown', (e) => { if (!endTime) return; seeking = true; $('bar').setPointerCapture(e.pointerId); seekFrom(e); });
$('bar').addEventListener('pointermove', (e) => { if (seeking) seekFrom(e); });
$('bar').addEventListener('pointerup', (e) => { if (!seeking) return; seeking = false; const r = seekFrom(e); if (at) at.timePosition = r * endTime; });

const playerVisible = () => !$('player').classList.contains('hidden');
function showPlayer(p) {
  $('player-title').textContent = p.label;
  setPosition(0, 0);
  $('player').classList.remove('hidden');
  document.documentElement.style.setProperty('--player-h', `${$('player').offsetHeight}px`);
}
function hidePlayerOnly() {
  at?.stop();
  $('player').classList.add('hidden');
  document.documentElement.style.setProperty('--player-h', '0px');
}
window.addEventListener('resize', () => { if (playerVisible()) document.documentElement.style.setProperty('--player-h', `${$('player').offsetHeight}px`); });
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || !playerVisible() || $('play').disabled) return;
  if (e.target.closest('input, textarea, select, button, [contenteditable], dialog')) return;
  e.preventDefault();
  at?.playPause();
});
