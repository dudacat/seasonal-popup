const fs   = require('fs');
const path = require('path');

// ── 순수 JS JSON 파일 기반 경량 DB ──────────────────────────────
class JsonDB {
  constructor(filePath, initial = {}) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.data = this._load(initial);
    this._counters = {};
    for (const key of Object.keys(this.data)) {
      const ids = (this.data[key] || []).map(r => r.id).filter(Boolean);
      this._counters[key] = ids.length ? Math.max(...ids) : 0;
    }
  }

  _load(initial) {
    try {
      if (fs.existsSync(this.filePath)) {
        return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      }
    } catch {}
    return JSON.parse(JSON.stringify(initial));
  }

  _save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  _nextId(table) {
    this._counters[table] = (this._counters[table] || 0) + 1;
    return this._counters[table];
  }

  _now() {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  }

  insert(table, record) {
    if (!this.data[table]) this.data[table] = [];
    const row = { ...record, id: this._nextId(table), created_at: this._now() };
    this.data[table].push(row);
    this._save();
    return row;
  }

  filter(table, predicate = () => true) {
    return (this.data[table] || []).filter(predicate);
  }

  getById(table, id) {
    return (this.data[table] || []).find(r => r.id === +id) || null;
  }

  update(table, id, updates) {
    const idx = (this.data[table] || []).findIndex(r => r.id === +id);
    if (idx === -1) return null;
    this.data[table][idx] = { ...this.data[table][idx], ...updates };
    this._save();
    return this.data[table][idx];
  }

  delete(table, id) {
    const before = (this.data[table] || []).length;
    this.data[table] = (this.data[table] || []).filter(r => r.id !== +id);
    this._save();
    return (this.data[table] || []).length < before;
  }
}

// ── DB 인스턴스 생성 ─────────────────────────────────────────────
const db = new JsonDB(
  path.join(__dirname, '../data/db.json'),
  { popups: [], congestion_logs: [], recommendations: [] }
);

// ── 디렉토리 생성 ────────────────────────────────────────────────
fs.mkdirSync(path.join(__dirname, '../uploads'), { recursive: true });

// ── 초기 데이터 시드 ─────────────────────────────────────────────
// 기존 팝업에 media_items 마이그레이션
let _migrated = false;
db.data.popups = db.data.popups.map(p => {
  if (!Array.isArray(p.media_items)) { _migrated = true; return { ...p, media_items: [] }; }
  return p;
});
if (_migrated) db._save();

if (db.data.popups.length === 0) {
  [
    { name: '덕수궁 돌담길 봄 사진전',      description: '봄꽃과 함께하는 감성 사진 전시. 아티스트 12인의 봄 연작 작품 100점 전시. 야외 포토존 운영.',          lat: 37.5656, lng: 126.9752, address: '서울 중구 정동길 99',           start_date: '2026-03-15', end_date: '2026-05-31', season: 'spring', category: 'exhibition',  website_url: '', is_active: 1 },
    { name: '홍대 봄 플리마켓',              description: '봄맞이 인디 브랜드 팝업 마켓. 의류·액세서리·소품 50개 브랜드 참여. 주말 라이브 공연.',                lat: 37.5563, lng: 126.9248, address: '서울 마포구 홍대입구역 6번 출구', start_date: '2026-04-01', end_date: '2026-05-15', season: 'spring', category: 'popup_store', website_url: '', is_active: 1 },
    { name: '한강 여름 무비 페스티벌',       description: '한강공원 야외 영화제. 매주 금토일 상영. 돗자리 피크닉과 함께하는 영화 감상.',                         lat: 37.5216, lng: 126.9242, address: '서울 영등포구 여의도한강공원',    start_date: '2026-06-01', end_date: '2026-08-31', season: 'summer', category: 'festival',    website_url: '', is_active: 1 },
    { name: '성수동 여름 아트페어',           description: '힙한 성수동의 여름 아트페어. 국내외 신진 작가 80인 참여. 작품 구매 가능.',                            lat: 37.5446, lng: 127.0558, address: '서울 성동구 성수이로 77',          start_date: '2026-07-01', end_date: '2026-08-15', season: 'summer', category: 'exhibition',  website_url: '', is_active: 1 },
    { name: '안국동 가을 은행나무 팝업',      description: '노랗게 물든 은행나무 아래 펼쳐지는 가을 팝업 스토어. 계절 한정 굿즈·먹거리.',                        lat: 37.5769, lng: 126.9853, address: '서울 종로구 안국동 은행나무길',    start_date: '2026-10-01', end_date: '2026-11-30', season: 'fall',   category: 'popup_store', website_url: '', is_active: 1 },
    { name: '북촌 가을 도자기 전시',         description: '한옥마을에서 즐기는 전통 도자기 전시. 작가와의 대화 매주 토요일 2시.',                                lat: 37.5797, lng: 126.9853, address: '서울 종로구 북촌로 71',            start_date: '2026-09-15', end_date: '2026-11-15', season: 'fall',   category: 'exhibition',  website_url: '', is_active: 1 },
    { name: '광화문 크리스마스 마켓',         description: '유럽식 크리스마스 마켓. 핫초코·수제 소품·푸드트럭 40여 개. 대형 미디어아트 설치.',                    lat: 37.5759, lng: 126.9769, address: '서울 종로구 세종대로 172',          start_date: '2026-12-01', end_date: '2027-01-05', season: 'winter', category: 'market',      website_url: '', is_active: 1 },
    { name: '잠실 겨울 빛 축제',             description: '롯데월드타워 대형 미디어파사드 & 빛 조형물. 국내 최대 규모 겨울 조명 축제.',                           lat: 37.5130, lng: 127.0987, address: '서울 송파구 올림픽로 300',          start_date: '2026-11-25', end_date: '2027-02-28', season: 'winter', category: 'festival',    website_url: '', is_active: 1 },
    { name: '명동 사계절 뷰티 팝업',          description: '글로벌 뷰티 브랜드 팝업 존. 무료 메이크오버 체험 가능. 1층 전체 운영.',                               lat: 37.5636, lng: 126.9850, address: '서울 중구 명동길 74',              start_date: '2026-01-01', end_date: '2026-12-31', season: 'all',    category: 'popup_store', website_url: '', is_active: 1 },
  ].forEach(p => db.insert('popups', p));

  [
    { season: 'spring', title: '덕수궁 돌담길 봄 산책 코스',  description: '정동길 벚꽃을 감상하며 근처 갤러리까지 이어지는 봄의 정수 코스. 소요 시간 약 3시간.', places: '덕수궁 → 돌담길 → 정동극장 → 봄 사진전 → 카페' },
    { season: 'spring', title: '홍대 봄꽃 팝업 투어',          description: '홍대 주변 봄 팝업 스토어를 한 번에 돌아보는 코스. 인디 브랜드와 맛집 함께.',        places: '홍대입구역 → 플리마켓 → 상상마당 → 인디샵 → 카페' },
    { season: 'summer', title: '한강 여름밤 피크닉 코스',       description: '퇴근 후 즐기는 한강 나들이. 야외 영화와 치맥! 돗자리 필수.',                        places: '여의도한강공원 → 야외영화제 → 분수대 → 치맥' },
    { season: 'summer', title: '성수동 힙스터 아트 코스',       description: '성수동 핫 팝업과 독립 카페를 순례하는 여름 코스.',                                  places: '성수역 → 아트페어 → 독립카페 → 빈티지샵 → 갤러리' },
    { season: 'fall',   title: '안국동 가을 단풍 코스',         description: '은행나무 단풍을 배경으로 한 가을 팝업 투어. 인스타 성지 코스!',                     places: '안국역 → 은행나무길 팝업 → 북촌한옥마을 → 인사동' },
    { season: 'fall',   title: '북촌 가을 문화 산책',           description: '가을 정취 가득한 북촌에서 전통과 현대 예술을 함께 만끽하세요.',                      places: '경복궁역 → 국립민속박물관 → 북촌 → 도자기 전시 → 삼청동' },
    { season: 'winter', title: '광화문 크리스마스 야경 코스',   description: '광화문·청계천·명동까지 이어지는 크리스마스 야경 투어.',                             places: '광화문광장 → 크리스마스마켓 → 청계천 → 명동 → 뷰티팝업' },
    { season: 'winter', title: '잠실 겨울 빛 축제 코스',        description: '롯데타워 빛 축제와 석촌호수를 함께 즐기는 낭만 겨울 코스.',                         places: '잠실역 → 롯데타워 → 석촌호수 → 빛 축제 → 잠실 맛집' },
  ].forEach(r => db.insert('recommendations', r));
}

module.exports = db;
