// 허브(Supabase) 접속 정보. publishable 키는 원래 브라우저에 넣는 공개용 키라 저장소에 둬도 된다.
// 누가 무엇을 읽고 쓸 수 있는지는 DB 의 RLS 정책(hub/migrations)이 지킨다.
export const HUB_URL = 'https://ifccfgkqeohregncevaq.supabase.co';
export const HUB_KEY = 'sb_publishable_EmbIoJ9hRi-Dh7VTYCkR3A_fuGoGe4V';
// 친구들이 여는 공개 허브 주소 (GitHub Pages). 링크 복사·초대 링크는 이 주소로 만든다.
export const HUB_SITE_URL = 'https://master966.github.io/openscore-hub/';
