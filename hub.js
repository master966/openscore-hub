// OpenScore 허브 화면: 초대제 로그인, 피드·검색, 악보 보기, 좋아요, 초대 코드(관리자).
// 이 파일과 hub.html 은 로컬 서버 없이도 돌아간다 (정적 호스팅에 그대로 올릴 수 있음).
import { $, esc, I, toast, koKey, ago, EMOJI, CATEGORY_NAMES } from './common.js';
import { showParts, currentPart, hideViewer, printScore } from './viewer.js';
import * as hub from './hub-client.js';

const VIEWS = ['v-off', 'v-auth', 'v-feed', 'v-score', 'v-invites'];
function show(id) {
  for (const v of VIEWS) $(v).classList.toggle('hidden', v !== id);
  $('back').classList.toggle('hidden', id === 'v-feed' || id === 'v-auth' || id === 'v-off');
  if (id !== 'v-score') hideViewer();
}
const params = () => new URLSearchParams(location.hash.split('?')[1] || '');

// 로컬 OpenScore 서버에서 열었으면 '내 악보' 링크를 보여 준다 (정적 호스팅에서는 /api 가 없다)
if (/^(localhost|127\.|\[::1\])/.test(location.hostname)) {
  fetch('api/health').then((r) => r.ok && r.json()).then((h) => { if (h?.ok) $('local-link').classList.remove('hidden'); }).catch(() => {});
}

// ---------- 사용자 메뉴 ----------
async function renderUser() {
  const m = await hub.me().catch(() => null);
  $('user-btn').classList.toggle('hidden', !m?.profile);
  if (m?.profile) $('user-btn').innerHTML = `${I.user}${esc(m.profile.username)}`;
  $('menu-invites').classList.toggle('hidden', m?.profile?.role !== 'admin');
  return m;
}
$('user-btn').onclick = (e) => { e.stopPropagation(); $('user-menu').classList.toggle('hidden'); };
document.addEventListener('click', () => $('user-menu').classList.add('hidden'));
$('logout').onclick = async () => { await hub.signOut(); toast('로그아웃했어요.'); location.hash = '#/login'; renderUser(); };

// ---------- 로그인 / 가입 ----------
let authMode = 'login';
function setAuthMode(mode) {
  authMode = mode;
  $('auth-tabs').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.t === mode));
  document.querySelectorAll('.signup-only').forEach((el) => el.classList.toggle('hidden', mode !== 'signup'));
  $('a-submit').textContent = mode === 'signup' ? '가입하기' : '로그인';
  $('a-pw').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
}
$('auth-tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) setAuthMode(b.dataset.t); };
$('auth-form').onsubmit = async (e) => {
  e.preventDefault();
  const btn = $('a-submit');
  btn.disabled = true;
  try {
    if (authMode === 'signup') {
      await hub.signUp({ email: $('a-email').value, password: $('a-pw').value, username: $('a-name').value, invite: $('a-invite').value });
      toast('가입했어요! 환영해요.');
    } else {
      await hub.signIn($('a-email').value, $('a-pw').value);
    }
    $('a-pw').value = '';
    await renderUser();
    const back = params().get('back');
    if (back !== null) location.href = './' + back; // 내 악보에서 '로그인' 하러 왔으면 되돌아간다
    else location.hash = '#/';
  } catch (err) { toast(err.message); }
  finally { btn.disabled = false; }
};

// ---------- 피드 ----------
const feed = { q: '', sort: 'new', instrument: '', page: 0 };
const INSTRUMENTS = ['piano', 'guitar', 'bass', 'drums', 'vocals', 'strings', 'synth', 'brass', 'winds'];
$('inst-chips').innerHTML = [['', '전체'], ...INSTRUMENTS.map((k) => [k, `${EMOJI[k]} ${CATEGORY_NAMES[k]}`])]
  .map(([k, t]) => `<button type="button" class="chip" data-k="${k}" aria-pressed="${k === ''}">${t}</button>`).join('');
$('inst-chips').onclick = (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  feed.instrument = b.dataset.k;
  $('inst-chips').querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', c === b));
  loadFeed();
};
$('sort-seg').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  location.hash = b.dataset.s === 'mine' ? '#/?mine=1' : b.dataset.s === 'popular' ? '#/?sort=popular' : '#/';
};
let qTimer;
$('q').oninput = () => { clearTimeout(qTimer); qTimer = setTimeout(() => { feed.q = $('q').value; loadFeed(); }, 300); };
$('more').onclick = () => { feed.page += 1; loadFeed(true); };

function card(s, liked) {
  const meta = [s.artist, s.owner?.username && `올린 사람 ${s.owner.username}`, ago(s.created_at)].filter(Boolean).join(' · ');
  const info = [koKey(s.key), s.bpm && `♩${s.bpm}`, s.time_signature].filter(Boolean).join(' · ');
  return `<li><a class="card job score-card" href="#/score/${s.id}">
    <span class="src file">${(s.instruments || []).slice(0, 1).map((k) => EMOJI[k] || '🎵').join('') || '🎵'}</span>
    <span style="min-width:0">
      <div class="t">${esc(s.title)}</div>
      <div class="s">${esc(meta)}</div>
      <div class="s">${esc(info)}${info ? ' · ' : ''}${(s.instruments || []).map((k) => EMOJI[k] || '🎵').join(' ')}</div>
    </span>
    <span class="likes ${liked ? 'on' : ''}">${liked ? I.heartFill : I.heart}${s.like_count}</span>
  </a></li>`;
}

let feedSeq = 0;
async function loadFeed(append = false) {
  const seq = ++feedSeq;
  if (!append) feed.page = 0;
  $('more').disabled = true;
  try {
    const { rows, total } = await hub.listScores({ q: feed.q, instrument: feed.instrument, sort: feed.sort === 'popular' ? 'popular' : 'new', mine: feed.sort === 'mine', page: feed.page });
    if (seq !== feedSeq) return;
    const liked = await hub.likedIds(rows.map((r) => r.id));
    const html = rows.map((s) => card(s, liked.has(s.id))).join('');
    if (append) $('feed').insertAdjacentHTML('beforeend', html);
    else $('feed').innerHTML = html || `<li class="card empty"><div class="big">🎼</div>${feed.q || feed.instrument ? '찾는 악보가 없어요.' : feed.sort === 'mine' ? '아직 올린 악보가 없어요.<br>내 악보 화면에서 "허브에 올리기"를 눌러 보세요.' : '아직 올라온 악보가 없어요.<br>첫 악보를 올려 보세요!'}</li>`;
    $('feed-count').textContent = total ? `${total}개의 악보` : '';
    const shown = $('feed').querySelectorAll('.score-card').length;
    $('more').classList.toggle('hidden', shown >= total);
  } catch (err) { toast(err.message); }
  finally { $('more').disabled = false; }
}

// ---------- 악보 보기 ----------
let score = null;
async function loadScore(id) {
  window.scrollTo(0, 0);
  score = await hub.getScore(id);
  if (!score) { toast('없는 악보예요. 지워졌을 수 있어요.'); location.hash = '#/'; return; }
  const m = await hub.me();
  $('s-title').textContent = score.title;
  $('s-sub').textContent = [score.artist, score.owner?.username && `올린 사람 ${score.owner.username}`, ago(score.created_at)].filter(Boolean).join(' · ');
  const metas = [score.bpm && ['빠르기', `♩ ${score.bpm}`], score.time_signature && ['박자', score.time_signature], score.key && ['조', koKey(score.key)],
                 ['출처', score.source_type === 'url' ? '유튜브 링크' : '업로드 파일']].filter(Boolean);
  $('s-metas').innerHTML = metas.map(([k, v]) => `<span class="meta"><b>${k}</b>${esc(v)}</span>`).join('');
  $('s-tags').innerHTML = (score.tags || []).map((t) => `<a class="chip" href="#/?q=${encodeURIComponent(t)}">#${esc(t)}</a>`).join('');
  $('s-desc').textContent = score.description || '';
  $('s-desc').classList.toggle('hidden', !score.description);
  const liked = (await hub.likedIds([score.id])).has(score.id);
  renderLike(liked);
  $('s-delete').classList.toggle('hidden', !(m && (score.owner_id === m.user.id || m.profile?.role === 'admin')));
  showParts(score.parts || [], { getBytes: (p, path) => hub.fileBytes(path), onSelect: renderExports });
  renderExports();
}
function renderLike(on) {
  $('like').setAttribute('aria-pressed', on);
  $('like').innerHTML = `${on ? I.heartFill : I.heart}좋아요 ${score.like_count}`;
}
$('like').onclick = async () => {
  const on = $('like').getAttribute('aria-pressed') !== 'true';
  try {
    await hub.setLike(score.id, on);
    score.like_count += on ? 1 : -1;
    renderLike(on);
  } catch (err) { toast(err.message); }
};
$('copy-link').onclick = async () => {
  const url = hub.shareUrl(`#/score/${score.id}`);
  try { await navigator.clipboard.writeText(url); toast('링크를 복사했어요. 허브에 가입한 사람만 열 수 있어요.'); }
  catch { toast(url); }
};
$('s-delete').onclick = async () => {
  if (!score || !confirm('허브에서 이 악보를 지울까요? 되돌릴 수 없어요.')) return;
  try { await hub.deleteScore(score); toast('지웠어요.'); location.hash = '#/'; }
  catch (err) { toast(err.message); }
};

function renderExports() {
  if (!score) return;
  const p = currentPart() || {}, f = score.files || {};
  const base = score.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  const part = [['악보 PDF', p.pdf, 'PDF'], ['타브 PDF', p.tab_pdf, 'PDF'], ['악보 파일', p.musicxml, 'MusicXML'],
                ['타브 파일', p.tab_musicxml, 'MusicXML'], ['MIDI', p.midi, 'MIDI']].filter(([, v]) => v);
  const whole = [['총보 PDF', f.full_pdf, 'PDF'], ['총보 파일', f.full_musicxml, 'MusicXML'], ['전체 MIDI', f.full_midi, 'MIDI']].filter(([, v]) => v);
  const btn = ([t, v, k]) => `<button type="button" class="btn exp" data-path="${esc(v)}" data-name="${esc(`${base} - ${p.label && part.some((x) => x[1] === v) ? p.label + ' ' : ''}${t}.${v.split('.').pop()}`)}">${I.download}<span><b>${t}</b><small>${k}</small></span></button>`;
  $('exports-part-title').textContent = p.label ? `${p.label} 파트` : '이 파트';
  $('exports-part').innerHTML = part.map(btn).join('') + (p.musicxml ? `<button type="button" class="btn exp" id="print-btn">${I.print}<span><b>인쇄</b><small>화면 악보</small></span></button>` : '');
  $('exports-whole').innerHTML = whole.map(btn).join('');
  $('print-btn')?.addEventListener('click', printScore);
}
// 허브 파일은 비공개라 누를 때마다 1시간짜리 서명 링크를 만들어 내려받는다
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-path]');
  if (!b) return;
  try {
    const a = document.createElement('a');
    a.href = await hub.fileUrl(b.dataset.path, b.dataset.name);
    a.rel = 'noopener';
    document.body.append(a);
    a.click();
    a.remove();
  } catch (err) { toast(err.message); }
});

// ---------- 초대 코드 (관리자) ----------
async function loadInvites() {
  try {
    const rows = await hub.listInvites();
    $('inv-list').innerHTML = rows.map((r) => {
      const expired = r.expires_at && Date.parse(r.expires_at) < Date.now();
      const full = r.uses >= r.max_uses;
      return `<li><code>${esc(r.code)}</code><span class="muted small">${r.uses}/${r.max_uses}명 가입 · ${expired ? '만료' : full ? '다 씀' : r.expires_at ? `${new Date(r.expires_at).toLocaleDateString('ko-KR')}까지` : '기한 없음'}</span>
        <button type="button" class="btn small-btn" data-copy="${esc(inviteLink(r.code))}" data-what="초대 링크">링크 복사</button>
        <button type="button" class="btn small-btn" data-copy="${esc(r.code)}" data-what="코드">코드 복사</button></li>`;
    }).join('') || '<li class="muted small">아직 만든 코드가 없어요.</li>';
  } catch (err) { toast(err.message); }
}
// 초대 링크를 열면 가입 화면에 코드가 미리 채워진다
const inviteLink = (code) => hub.shareUrl(`#/?code=${encodeURIComponent(code)}`);
$('inv-create').onclick = async () => {
  try {
    const code = await hub.createInvite(+$('inv-uses').value, +$('inv-days').value);
    await navigator.clipboard?.writeText(inviteLink(code)).catch(() => {});
    toast(`초대 코드 ${code} 를 만들고 초대 링크를 복사했어요. 친구에게 보내 주세요.`);
    loadInvites();
  } catch (err) { toast(err.message); }
};
$('inv-list').onclick = async (e) => {
  const b = e.target.closest('[data-copy]');
  if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copy); toast(`${b.dataset.what}를 복사했어요.`); } catch { toast(b.dataset.copy); }
};

// ---------- 라우팅 ----------
async function route() {
  if (!hub.hubConfigured) return show('v-off');
  const m = await renderUser();
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/';
  if (!m?.profile) {
    show('v-auth');
    setAuthMode(params().get('signup') ? 'signup' : authMode);
    if (params().get('code')) { setAuthMode('signup'); $('a-invite').value = params().get('code'); }
    return;
  }
  if (path === '/login') { location.hash = '#/'; return; }
  const sm = path.match(/^\/score\/([\w-]+)/);
  if (sm) { show('v-score'); return loadScore(sm[1]).catch((err) => toast(err.message)); }
  if (path === '/invites') { show('v-invites'); return loadInvites(); }
  show('v-feed');
  const p = params();
  feed.sort = p.get('mine') ? 'mine' : p.get('sort') === 'popular' ? 'popular' : 'new';
  $('sort-seg').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.s === feed.sort));
  if (p.get('q') !== null) { feed.q = p.get('q'); $('q').value = feed.q; }
  loadFeed();
}
$('back').onclick = () => (history.length > 1 ? history.back() : (location.hash = '#/'));
window.addEventListener('hashchange', route);
route();
