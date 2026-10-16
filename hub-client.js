// 허브(Supabase) 통신: 로그인·가입(초대 코드), 악보 올리기·목록·검색·좋아요·삭제, 초대 코드 만들기.
// 표 구조와 권한은 hub/migrations/001_hub_schema.sql 참고.
import { HUB_URL, HUB_KEY, HUB_SITE_URL } from './hub-config.js';

const SB_VER = '2.117.1';
const BUCKET = 'scores';
export const hubConfigured = !!(HUB_URL && HUB_KEY);
/** 친구에게 보낼 링크: 공개 허브 주소가 있으면 그 주소로 (이 PC 의 localhost 링크는 남이 못 연다) */
export const shareUrl = (hash) => (HUB_SITE_URL || location.href.split('#')[0]) + hash;

let sb = null;
export async function client() {
  if (!hubConfigured) throw new Error('허브가 아직 설정되지 않았어요.');
  if (!sb) {
    const { createClient } = await import(`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${SB_VER}/+esm`);
    sb = createClient(HUB_URL, HUB_KEY);
  }
  return sb;
}

function koError(e) {
  const m = String(e?.message || e || '');
  if (/Invalid login credentials/i.test(m)) return '이메일 또는 비밀번호가 맞지 않아요.';
  if (/already registered|already been registered/i.test(m)) return '이미 가입된 이메일이에요. 로그인해 주세요.';
  if (/Password should be at least/i.test(m)) return '비밀번호는 6자 이상이어야 해요.';
  if (/Database error saving new user|invalid_invite_code/i.test(m)) return '초대 코드가 맞지 않거나 이미 다 쓰였어요.';
  if (/Email not confirmed/i.test(m)) return '이메일 인증이 켜져 있어요. 허브 관리자에게 알려 주세요.';
  if (/rate limit/i.test(m)) return '잠시 후 다시 시도해 주세요.';
  if (/mime type|invalid_mime/i.test(m)) return '허브가 받지 않는 파일 형식이에요. (악보·PDF·MIDI 만 올릴 수 있어요)';
  if (/exceeded the maximum allowed size|Payload too large/i.test(m)) return '파일이 너무 커요 (한 파일 20MB 까지).';
  if (/row-level security|Unauthorized|403/i.test(m)) return '권한이 없어요. 허브에 다시 로그인해 주세요.';
  if (/only_admin/i.test(m)) return '관리자만 할 수 있어요.';
  if (/cannot_ban_self/i.test(m)) return '자기 자신은 정지할 수 없어요.';
  if (/profiles_username_key|duplicate key.*username/i.test(m)) return '이미 쓰는 이름이에요. 다른 이름을 골라 주세요.';
  if (/profiles_username_check/i.test(m)) return '이름은 2~20자 한글·영문·숫자·_.- 만 쓸 수 있어요.';
  if (/reports_score_id_reporter_id_key/i.test(m)) return '이미 신고한 악보예요.';
  if (/Failed to fetch|NetworkError/i.test(m)) return '허브 서버에 연결할 수 없어요.';
  return m;
}
const check = ({ data, error }) => { if (error) throw new Error(koError(error)); return data; };

// ---------- 로그인 ----------
let meCache = null;
/** 로그인한 사람 {user, profile} 또는 null */
export async function me(force = false) {
  if (!hubConfigured) return null;
  if (meCache && !force) return meCache;
  const c = await client();
  const { data: { session } } = await c.auth.getSession();
  if (!session) return (meCache = null);
  const profile = check(await c.from('profiles').select('id, username, role, banned_at').eq('id', session.user.id).maybeSingle());
  return (meCache = { user: session.user, profile });
}
export async function signIn(email, password) {
  const c = await client();
  check(await c.auth.signInWithPassword({ email: email.trim(), password }));
  return me(true);
}
export const USERNAME_RE = /^[A-Za-z0-9가-힣_.-]{2,20}$/;
export async function signUp({ email, password, username, invite }) {
  const c = await client();
  username = username.trim();
  invite = invite.trim().toUpperCase();
  if (!USERNAME_RE.test(username)) throw new Error('이름은 2~20자 한글·영문·숫자·_.- 만 쓸 수 있어요.');
  if (!check(await c.rpc('check_invite', { invite_code: invite }))) throw new Error('초대 코드가 맞지 않거나 이미 다 쓰였어요.');
  if (!check(await c.rpc('username_available', { name: username }))) throw new Error('이미 쓰는 이름이에요. 다른 이름을 골라 주세요.');
  const data = check(await c.auth.signUp({ email: email.trim(), password, options: { data: { username, invite_code: invite } } }));
  if (!data.session) throw new Error('가입은 됐지만 이메일 인증이 켜져 있어요. 허브 관리자에게 알려 주세요.');
  return me(true);
}
export async function signOut() {
  const c = await client();
  await c.auth.signOut();
  meCache = null;
}
export async function rename(username) {
  username = username.trim();
  if (!USERNAME_RE.test(username)) throw new Error('이름은 2~20자 한글·영문·숫자·_.- 만 쓸 수 있어요.');
  const c = await client();
  const m = await me();
  if (username.toLowerCase() !== m.profile.username.toLowerCase() && !check(await c.rpc('username_available', { name: username }))) {
    throw new Error('이미 쓰는 이름이에요. 다른 이름을 골라 주세요.');
  }
  check(await c.from('profiles').update({ username }).eq('id', m.user.id));
  return me(true);
}
export async function profileByName(username) {
  const c = await client();
  return check(await c.from('profiles').select('id, username, role, created_at').eq('username', username).maybeSingle());
}

// ---------- 악보 목록·보기 ----------
const LIST_COLS = 'id, title, artist, tags, instruments, key, bpm, time_signature, like_count, hidden, created_at, owner_id, owner:profiles!scores_owner_id_fkey(username)';

/** {q, instrument, sort: 'new'|'popular', ownerId, liked, page} → {rows, total} */
export async function listScores({ q = '', instrument = '', sort = 'new', ownerId = '', liked = false, page = 0, size = 20 } = {}) {
  const c = await client();
  // 좋아요한 악보: likes 를 inner join 해서 내 좋아요만 남긴다
  let query = c.from('scores').select(liked ? `${LIST_COLS}, likes!inner(user_id)` : LIST_COLS, { count: 'exact' });
  if (liked) query = query.eq('likes.user_id', (await me())?.user.id);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  for (const w of words) query = query.ilike('search', `%${w.replace(/[%_\\]/g, (m) => '\\' + m)}%`);
  if (instrument) query = query.contains('instruments', [instrument]);
  if (ownerId) query = query.eq('owner_id', ownerId);
  query = sort === 'popular'
    ? query.order('like_count', { ascending: false }).order('created_at', { ascending: false })
    : query.order('created_at', { ascending: false });
  const { data, error, count } = await query.range(page * size, page * size + size - 1);
  if (error) throw new Error(koError(error));
  return { rows: data, total: count ?? data.length };
}
export async function getScore(id) {
  const c = await client();
  return check(await c.from('scores').select('*, owner:profiles!scores_owner_id_fkey(username)').eq('id', id).maybeSingle());
}
export async function likedIds(ids) {
  const m = await me();
  if (!m || !ids.length) return new Set();
  const c = await client();
  const rows = check(await c.from('likes').select('score_id').eq('user_id', m.user.id).in('score_id', ids));
  return new Set(rows.map((r) => r.score_id));
}
export async function setLike(scoreId, on) {
  const c = await client();
  const uid = (await me()).user.id;
  if (on) check(await c.from('likes').insert({ user_id: uid, score_id: scoreId }));
  else check(await c.from('likes').delete().eq('user_id', uid).eq('score_id', scoreId));
}

// ---------- 파일 ----------
export async function fileBytes(path) {
  const c = await client();
  const blob = check(await c.storage.from(BUCKET).download(path));
  return blob.arrayBuffer();
}
export async function fileUrl(path, downloadName) {
  const c = await client();
  const data = check(await c.storage.from(BUCKET).createSignedUrl(path, 3600, downloadName ? { download: downloadName } : undefined));
  return data.signedUrl;
}
function scorePaths(score) {
  const paths = [];
  for (const p of score.parts || []) for (const k of ['musicxml', 'tab_musicxml', 'midi', 'pdf', 'tab_pdf']) if (p[k]) paths.push(p[k]);
  for (const v of Object.values(score.files || {})) if (v) paths.push(v);
  return paths;
}
export async function deleteScore(score) {
  const c = await client();
  const paths = scorePaths(score);
  if (paths.length) check(await c.storage.from(BUCKET).remove(paths));
  check(await c.from('scores').delete().eq('id', score.id));
}
/** 올린 사람이 제목·연주·설명·태그를 고친다 */
export async function updateScore(id, { title, artist, description, tags }) {
  const c = await client();
  check(await c.from('scores').update({ title, artist: artist || null, description: description || null, tags }).eq('id', id));
}
export async function report(scoreId, reason) {
  const c = await client();
  check(await c.from('reports').insert({ score_id: scoreId, reporter_id: (await me()).user.id, reason }));
}

// ---------- 관리자 ----------
export async function adminMembers() {
  return check(await (await client()).rpc('admin_members'));
}
export async function setBan(userId, banned) {
  check(await (await client()).rpc('admin_set_ban', { target: userId, banned }));
}
export async function setHidden(scoreId, hide) {
  check(await (await client()).rpc('admin_set_hidden', { target: scoreId, hide }));
}
export async function revokeInvite(code) {
  check(await (await client()).rpc('revoke_invite', { invite_code: code }));
}
export async function openReports() {
  const c = await client();
  return check(await c.from('reports')
    .select('id, reason, created_at, score:scores!reports_score_id_fkey(id, title, hidden), reporter:profiles!reports_reporter_id_fkey(username)')
    .is('resolved_at', null).order('created_at', { ascending: false }).limit(50));
}
export async function resolveReport(id) {
  check(await (await client()).rpc('resolve_report', { report_id: id }));
}

export async function createInvite(maxUses = 5, days = 30) {
  const c = await client();
  return check(await c.rpc('create_invite', { max_uses: maxUses, valid_days: days }));
}
export async function listInvites() {
  const c = await client();
  return check(await c.from('invites').select('code, max_uses, uses, expires_at, created_at').order('created_at', { ascending: false }).limit(20));
}

// ---------- 올리기 ----------
const MIME = { musicxml: 'application/vnd.recordare.musicxml+xml', pdf: 'application/pdf', mid: 'audio/midi' };
const mimeOf = (name) => MIME[name.split('.').pop().toLowerCase()] || 'application/octet-stream';
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); // http(내부망) 에서는 randomUUID 가 없다
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * 악보를 허브에 올린다. 파일을 모두 올린 뒤 표에 한 줄 넣고, 실패하면 올린 파일을 지운다.
 * meta: {title, artist, description, tags[], source_type, key, bpm, time_signature}
 * parts: [{label, category, note_count, musicxml, tab_musicxml, midi, pdf, tab_pdf}] (값은 로컬 파일 이름)
 * full: {full_pdf, full_midi, full_musicxml} (로컬 파일 이름)
 * fetchLocal(name) → Promise<Blob>, onProgress(0~1)
 */
export async function publish({ meta, parts, full = {}, fetchLocal, onProgress = () => {} }) {
  const m = await me(true);
  if (!m?.profile) throw new Error('허브에 로그인해 주세요.');
  const c = await client();
  const id = uuid();
  const base = `${m.user.id}/${id}`;
  const uploads = [];
  const remote = (name) => { const r = `${base}/${name}`; uploads.push([name, r]); return r; };
  const outParts = parts.map((p) => {
    const o = { label: p.label, category: p.category, note_count: p.note_count };
    for (const k of ['musicxml', 'tab_musicxml', 'midi', 'pdf', 'tab_pdf']) if (p[k]) o[k] = remote(p[k]);
    return o;
  });
  const files = {};
  for (const [k, v] of Object.entries(full)) if (v) files[k] = remote(v);

  const done = [];
  try {
    for (const [i, [name, path]] of uploads.entries()) {
      onProgress(i / (uploads.length + 1));
      // 로컬 서버가 준 Blob 의 type 이 application/octet-stream 일 수 있어서(확장자 미등록) 형식을 다시 붙인다.
      // 저장소는 multipart 안의 파일 type 을 보고 허용 형식을 검사한다.
      const blob = new Blob([await fetchLocal(name)], { type: mimeOf(name) });
      check(await c.storage.from(BUCKET).upload(path, blob, { contentType: mimeOf(name), upsert: false }));
      done.push(path);
    }
    onProgress(uploads.length / (uploads.length + 1));
    check(await c.from('scores').insert({
      id, owner_id: m.user.id, title: meta.title, artist: meta.artist || null, description: meta.description || null,
      tags: meta.tags || [], instruments: [...new Set(outParts.map((p) => p.category))], key: meta.key || null,
      bpm: meta.bpm || null, time_signature: meta.time_signature || null, source_type: meta.source_type,
      rights_confirmed: true, parts: outParts, files,
    }));
    onProgress(1);
    return id;
  } catch (err) {
    if (done.length) await c.storage.from(BUCKET).remove(done).catch(() => {});
    throw err;
  }
}
