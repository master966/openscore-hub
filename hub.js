// OpenScore 허브 화면: 초대제 로그인, 피드·검색, 악보 보기·수정·신고, 좋아요, 회원 페이지, 관리(회원·신고·초대 코드).
// 이 파일과 hub.html 은 로컬 서버 없이도 돌아간다 (정적 호스팅에 그대로 올릴 수 있음).
import { $, esc, I, toast, koKey, ago, EMOJI, CATEGORY_NAMES } from './common.js';
import { showParts, currentPart, hideViewer, printScore } from './viewer.js';
import * as hub from './hub-client.js';

const VIEWS = ['v-off', 'v-auth', 'v-banned', 'v-feed', 'v-score', 'v-admin'];
function show(id) {
  for (const v of VIEWS) $(v).classList.toggle('hidden', v !== id);
  $('back').classList.toggle('hidden', !['v-score', 'v-admin'].includes(id) && !(id === 'v-feed' && feed.ownerName));
  if (id !== 'v-score') hideViewer();
}
const params = () => new URLSearchParams(location.hash.split('?')[1] || '');

// 로컬 OpenScore 서버에서 열었으면 '내 악보' 링크를 보여 준다 (정적 호스팅에서는 /api 가 없다)
if (/^(localhost|127\.|\[::1\])/.test(location.hostname)) {
  fetch('api/health').then((r) => r.ok && r.json()).then((h) => { if (h?.ok) $('local-link').classList.remove('hidden'); }).catch(() => {});
}

// ---------- 대화상자 공통 ----------
document.querySelectorAll('dialog [data-close]').forEach((b) => { b.onclick = () => b.closest('dialog').close(); });
async function busy(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (err) { toast(err.message); } finally { btn.disabled = false; }
}

// ---------- 사용자 메뉴 ----------
let me = null;
async function renderUser(force = false) {
  me = await hub.me(force).catch(() => null);
  const ok = me?.profile && !me.profile.banned_at;
  $('user-btn').classList.toggle('hidden', !ok);
  if (ok) $('user-btn').innerHTML = `${I.user}${esc(me.profile.username)}`;
  $('menu-admin').classList.toggle('hidden', me?.profile?.role !== 'admin');
  return me;
}
const isAdmin = () => me?.profile?.role === 'admin';
$('user-btn').onclick = (e) => { e.stopPropagation(); $('user-menu').classList.toggle('hidden'); };
document.addEventListener('click', () => $('user-menu').classList.add('hidden'));
async function logout() { await hub.signOut(); toast('로그아웃했어요.'); location.hash = '#/login'; renderUser(); }
$('logout').onclick = logout;
$('banned-logout').onclick = logout;
$('menu-rename').onclick = () => { $('n-name').value = me?.profile?.username || ''; $('rename-dialog').showModal(); };
$('rename-form').onsubmit = (e) => {
  e.preventDefault();
  busy(e.submitter || $('rename-form').querySelector('.primary'), async () => {
    await hub.rename($('n-name').value);
    await renderUser(true);
    $('rename-dialog').close();
    toast('이름을 바꿨어요.');
  });
};

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
    await renderUser(true);
    const back = params().get('back');
    if (back !== null) location.href = './' + back; // 내 악보에서 '로그인' 하러 왔으면 되돌아간다
    else location.hash = '#/';
  } catch (err) { toast(err.message); }
  finally { btn.disabled = false; }
};

// ---------- 피드 ----------
const feed = { q: '', sort: 'new', instrument: '', page: 0, ownerId: '', ownerName: '' };
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
  location.hash = { mine: '#/?mine=1', liked: '#/?liked=1', popular: '#/?sort=popular' }[b.dataset.s] || '#/';
};
let qTimer;
$('q').oninput = () => { clearTimeout(qTimer); qTimer = setTimeout(() => { feed.q = $('q').value; loadFeed(); }, 300); };
$('more').onclick = () => { feed.page += 1; loadFeed(true); };

function card(s, liked) {
  const meta = [s.artist, s.owner?.username, ago(s.created_at)].filter(Boolean).join(' · ');
  const info = [koKey(s.key), s.bpm && `♩${s.bpm}`, s.time_signature].filter(Boolean).join(' · ');
  return `<li><a class="card job score-card" href="#/score/${s.id}">
    <span class="src file">${(s.instruments || []).slice(0, 1).map((k) => EMOJI[k] || '🎵').join('') || '🎵'}</span>
    <span style="min-width:0">
      <div class="t">${s.hidden ? '<span class="tag-hidden">숨김</span>' : ''}${esc(s.title)}</div>
      <div class="s">${esc(meta)}</div>
      <div class="s">${esc(info)}${info ? ' · ' : ''}${(s.instruments || []).map((k) => EMOJI[k] || '🎵').join(' ')}</div>
    </span>
    <span class="likes ${liked ? 'on' : ''}">${liked ? I.heartFill : I.heart}${s.like_count}</span>
  </a></li>`;
}

function emptyText() {
  if (feed.q || feed.instrument) return '찾는 악보가 없어요.';
  if (feed.sort === 'liked') return '아직 좋아요한 악보가 없어요.<br>마음에 드는 악보에서 ♡ 를 눌러 보세요.';
  if (feed.ownerId && feed.ownerId === me?.user.id) return '아직 올린 악보가 없어요.<br>내 악보 화면에서 "허브에 올리기"를 눌러 보세요.';
  if (feed.ownerId) return `${esc(feed.ownerName)} 님이 올린 악보가 아직 없어요.`;
  return '아직 올라온 악보가 없어요.<br>첫 악보를 올려 보세요!';
}

let feedSeq = 0;
async function loadFeed(append = false) {
  const seq = ++feedSeq;
  if (!append) feed.page = 0;
  $('more').disabled = true;
  try {
    const { rows, total } = await hub.listScores({
      q: feed.q, instrument: feed.instrument, sort: feed.sort === 'popular' ? 'popular' : 'new',
      ownerId: feed.ownerId, liked: feed.sort === 'liked', page: feed.page,
    });
    if (seq !== feedSeq) return;
    const liked = feed.sort === 'liked' ? new Set(rows.map((r) => r.id)) : await hub.likedIds(rows.map((r) => r.id));
    const html = rows.map((s) => card(s, liked.has(s.id))).join('');
    if (append) $('feed').insertAdjacentHTML('beforeend', html);
    else $('feed').innerHTML = html || `<li class="card empty"><div class="big">🎼</div>${emptyText()}</li>`;
    const who = feed.ownerName && feed.ownerId !== me?.user.id ? `${esc(feed.ownerName)} 님이 올린 ` : '';
    $('feed-count').innerHTML = total ? `${who}${total}개의 악보` : who ? `${who}악보` : '';
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
  if (!score) { toast('없는 악보예요. 지워졌거나 숨겨졌을 수 있어요.'); location.hash = '#/'; return; }
  const mine = score.owner_id === me?.user.id;
  $('s-hidden').classList.toggle('hidden', !score.hidden);
  $('s-title').textContent = score.title;
  const owner = score.owner?.username;
  $('s-sub').innerHTML = [score.artist && esc(score.artist), owner && `올린 사람 <a href="#/u/${encodeURIComponent(owner)}">${esc(owner)}</a>`, esc(ago(score.created_at))].filter(Boolean).join(' · ');
  const metas = [score.bpm && ['빠르기', `♩ ${score.bpm}`], score.time_signature && ['박자', score.time_signature], score.key && ['조', koKey(score.key)],
                 ['출처', score.source_type === 'url' ? '유튜브 링크' : '업로드 파일']].filter(Boolean);
  $('s-metas').innerHTML = metas.map(([k, v]) => `<span class="meta"><b>${k}</b>${esc(v)}</span>`).join('');
  $('s-tags').innerHTML = (score.tags || []).map((t) => `<a class="chip" href="#/?q=${encodeURIComponent(t)}">#${esc(t)}</a>`).join('');
  $('s-desc').textContent = score.description || '';
  $('s-desc').classList.toggle('hidden', !score.description);
  const liked = (await hub.likedIds([score.id])).has(score.id);
  renderLike(liked);
  $('s-edit').classList.toggle('hidden', !mine);
  $('s-report').classList.toggle('hidden', mine);
  $('s-hide').classList.toggle('hidden', !isAdmin());
  $('s-hide').textContent = score.hidden ? '다시 보이기' : '숨기기';
  $('s-delete').classList.toggle('hidden', !(mine || isAdmin()));
  showParts(score.parts || [], { getBytes: (p, path) => hub.fileBytes(path), onSelect: renderExports });
  renderExports();
}
function renderLike(on) {
  $('like').setAttribute('aria-pressed', on);
  $('like').innerHTML = `${on ? I.heartFill : I.heart}좋아요 ${score.like_count}`;
}
$('like').onclick = () => busy($('like'), async () => {
  const on = $('like').getAttribute('aria-pressed') !== 'true';
  await hub.setLike(score.id, on);
  score.like_count += on ? 1 : -1;
  renderLike(on);
});
$('copy-link').onclick = async () => {
  const url = hub.shareUrl(`#/score/${score.id}`);
  try { await navigator.clipboard.writeText(url); toast('링크를 복사했어요. 허브에 가입한 사람만 열 수 있어요.'); }
  catch { toast(url); }
};
$('s-delete').onclick = () => {
  if (!score || !confirm('허브에서 이 악보를 지울까요? 되돌릴 수 없어요.')) return;
  busy($('s-delete'), async () => { await hub.deleteScore(score); toast('지웠어요.'); location.hash = '#/'; });
};
$('s-hide').onclick = () => busy($('s-hide'), async () => {
  await hub.setHidden(score.id, !score.hidden);
  toast(score.hidden ? '다시 보이게 했어요.' : '숨겼어요. 올린 사람과 관리자만 볼 수 있어요.');
  loadScore(score.id);
});

// 수정 (올린 사람)
$('s-edit').onclick = () => {
  $('e-title').value = score.title;
  $('e-artist').value = score.artist || '';
  $('e-desc').value = score.description || '';
  $('e-tags').value = (score.tags || []).join(', ');
  $('edit-dialog').showModal();
};
$('edit-form').onsubmit = (e) => {
  e.preventDefault();
  busy($('edit-form').querySelector('.primary'), async () => {
    await hub.updateScore(score.id, {
      title: $('e-title').value.trim() || score.title, artist: $('e-artist').value.trim(), description: $('e-desc').value.trim(),
      tags: $('e-tags').value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10),
    });
    $('edit-dialog').close();
    toast('고쳤어요.');
    loadScore(score.id);
  });
};

// 신고 (남의 악보)
$('s-report').onclick = () => { $('r-detail').value = ''; $('report-dialog').showModal(); };
$('report-form').onsubmit = (e) => {
  e.preventDefault();
  const kind = $('report-form').querySelector('input[name="r-reason"]:checked')?.value || '기타';
  const detail = $('r-detail').value.trim();
  busy($('report-form').querySelector('.primary'), async () => {
    await hub.report(score.id, detail ? `${kind}: ${detail}` : kind);
    $('report-dialog').close();
    toast('신고했어요. 관리자가 확인할게요.');
  });
};

function renderExports() {
  if (!score) return;
  const p = currentPart() || {}, f = score.files || {};
  const base = score.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  const part = [['악보 PDF', p.pdf, 'PDF'], ['타브 PDF', p.tab_pdf, 'PDF'], ['악보 파일', p.musicxml, 'MusicXML'],
                ['타브 파일', p.tab_musicxml, 'MusicXML'], ['MIDI', p.midi, 'MIDI']].filter(([, v]) => v);
  const whole = [['총보 PDF', f.full_pdf, 'PDF'], ['총보 파일', f.full_musicxml, 'MusicXML'], ['전체 MIDI', f.full_midi, 'MIDI']].filter(([, v]) => v);
  const btn = (isPart) => ([t, v, k]) => `<button type="button" class="btn exp" data-path="${esc(v)}" data-name="${esc(`${base} - ${isPart && p.label ? p.label + ' ' : ''}${t}.${v.split('.').pop()}`)}">${I.download}<span><b>${t}</b><small>${k}</small></span></button>`;
  $('exports-part-title').textContent = p.label ? `${p.label} 파트` : '이 파트';
  $('exports-part').innerHTML = part.map(btn(true)).join('') + (p.musicxml ? `<button type="button" class="btn exp" id="print-btn">${I.print}<span><b>인쇄</b><small>화면 악보</small></span></button>` : '');
  $('exports-whole').innerHTML = whole.map(btn(false)).join('');
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

// ---------- 관리 (관리자) ----------
// 초대 링크를 열면 가입 화면에 코드가 미리 채워진다
const inviteLink = (code) => hub.shareUrl(`#/?code=${encodeURIComponent(code)}`);
const day = (t) => new Date(t).toLocaleDateString('ko-KR');

async function loadAdmin() {
  await Promise.all([loadReports(), loadMembers(), loadInvites()]);
}
async function loadReports() {
  try {
    const rows = await hub.openReports();
    $('rep-list').innerHTML = rows.map((r) => `<li>
      <div class="grow" style="min-width:0"><a href="#/score/${r.score?.id}"><b>${esc(r.score?.title || '(지워진 악보)')}</b></a>${r.score?.hidden ? ' <span class="tag-hidden">숨김</span>' : ''}
        <div class="muted small">${esc(r.reason)} · ${esc(r.reporter?.username || '')} · ${esc(ago(r.created_at))}</div></div>
      ${r.score ? `<button type="button" class="btn small-btn" data-hide="${r.score.id}" data-on="${!r.score.hidden}">${r.score.hidden ? '보이기' : '숨기기'}</button>` : ''}
      <button type="button" class="btn small-btn" data-resolve="${r.id}">처리 완료</button></li>`).join('') || '<li class="muted small">처리할 신고가 없어요.</li>';
  } catch (err) { toast(err.message); }
}
async function loadMembers() {
  try {
    const rows = await hub.adminMembers();
    $('mem-list').innerHTML = rows.map((m) => `<li>
      <div class="grow" style="min-width:0"><a href="#/u/${encodeURIComponent(m.username)}"><b>${esc(m.username)}</b></a>
        ${m.role === 'admin' ? '<span class="tag-admin">관리자</span>' : ''}${m.banned_at ? '<span class="tag-hidden">정지</span>' : ''}
        <div class="muted small">${day(m.created_at)} 가입 · 올린 악보 ${m.score_count}개</div></div>
      ${m.id === me?.user.id ? '' : `<button type="button" class="btn small-btn ${m.banned_at ? '' : 'danger'}" data-ban="${m.id}" data-on="${!m.banned_at}" data-name="${esc(m.username)}">${m.banned_at ? '정지 풀기' : '정지'}</button>`}
      </li>`).join('');
  } catch (err) { toast(err.message); }
}
async function loadInvites() {
  try {
    const rows = await hub.listInvites();
    $('inv-list').innerHTML = rows.map((r) => {
      const expired = r.expires_at && Date.parse(r.expires_at) < Date.now();
      const full = r.uses >= r.max_uses;
      const live = !expired && !full;
      return `<li><code>${esc(r.code)}</code><span class="muted small">${r.uses}/${r.max_uses}명 가입 · ${expired ? '만료' : full ? '다 씀' : r.expires_at ? `${day(r.expires_at)}까지` : '기한 없음'}</span>
        ${live ? `<button type="button" class="btn small-btn" data-copy="${esc(inviteLink(r.code))}" data-what="초대 링크">링크 복사</button>
        <button type="button" class="btn small-btn" data-copy="${esc(r.code)}" data-what="코드">코드 복사</button>
        <button type="button" class="btn small-btn danger" data-revoke="${esc(r.code)}">폐기</button>` : ''}</li>`;
    }).join('') || '<li class="muted small">아직 만든 코드가 없어요.</li>';
  } catch (err) { toast(err.message); }
}
$('inv-create').onclick = () => busy($('inv-create'), async () => {
  const code = await hub.createInvite(+$('inv-uses').value, +$('inv-days').value);
  await navigator.clipboard?.writeText(inviteLink(code)).catch(() => {});
  toast(`초대 코드 ${code} 를 만들고 초대 링크를 복사했어요. 친구에게 보내 주세요.`);
  loadInvites();
});
$('v-admin').onclick = async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.copy) {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast(`${b.dataset.what}를 복사했어요.`); } catch { toast(b.dataset.copy); }
  } else if (b.dataset.revoke) {
    if (!confirm(`초대 코드 ${b.dataset.revoke} 를 폐기할까요? 이 코드로는 더 가입할 수 없어요.`)) return;
    busy(b, async () => { await hub.revokeInvite(b.dataset.revoke); toast('폐기했어요.'); loadInvites(); });
  } else if (b.dataset.ban) {
    const on = b.dataset.on === 'true';
    if (on && !confirm(`${b.dataset.name} 님을 정지할까요? 허브를 볼 수도, 올릴 수도 없게 돼요.`)) return;
    busy(b, async () => { await hub.setBan(b.dataset.ban, on); toast(on ? '정지했어요.' : '정지를 풀었어요.'); loadMembers(); });
  } else if (b.dataset.hide) {
    busy(b, async () => { await hub.setHidden(b.dataset.hide, b.dataset.on === 'true'); loadReports(); });
  } else if (b.dataset.resolve) {
    busy(b, async () => { await hub.resolveReport(+b.dataset.resolve); toast('처리 완료로 표시했어요.'); loadReports(); });
  }
};

// ---------- 라우팅 ----------
async function route() {
  if (!hub.hubConfigured) return show('v-off');
  const m = await renderUser();
  const path = decodeURIComponent(location.hash.replace(/^#/, '').split('?')[0] || '/');
  if (!m?.profile) {
    show('v-auth');
    setAuthMode(params().get('signup') ? 'signup' : authMode);
    if (params().get('code')) { setAuthMode('signup'); $('a-invite').value = params().get('code'); }
    return;
  }
  if (m.profile.banned_at) return show('v-banned');
  if (path === '/login') { location.hash = '#/'; return; }
  const sm = path.match(/^\/score\/([\w-]+)/);
  if (sm) { show('v-score'); return loadScore(sm[1]).catch((err) => toast(err.message)); }
  if (path === '/admin' || path === '/invites') {
    if (!isAdmin()) { location.hash = '#/'; return; }
    show('v-admin');
    return loadAdmin();
  }
  const p = params();
  const um = path.match(/^\/u\/(.+)$/);
  feed.ownerId = '';
  feed.ownerName = '';
  if (um) {
    const prof = await hub.profileByName(um[1]).catch(() => null);
    if (!prof) { toast('없는 회원이에요.'); location.hash = '#/'; return; }
    feed.ownerId = prof.id;
    feed.ownerName = prof.username;
  } else if (p.get('mine')) {
    feed.ownerId = m.user.id;
  }
  show('v-feed');
  feed.sort = p.get('mine') ? 'mine' : p.get('liked') ? 'liked' : p.get('sort') === 'popular' ? 'popular' : um ? '' : 'new';
  $('sort-seg').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.s === feed.sort));
  if (p.get('q') !== null) { feed.q = p.get('q'); $('q').value = feed.q; }
  loadFeed();
}
$('back').onclick = () => (history.length > 1 ? history.back() : (location.hash = '#/'));
window.addEventListener('hashchange', route);
route();
