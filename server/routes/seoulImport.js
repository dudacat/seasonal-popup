const express = require('express');
const router  = express.Router();
const db      = require('../db');

const SEOUL_API_KEY = '624e6a525564756436354f5678634a';
const SEOUL_API_URL = 'http://openapi.seoul.go.kr:8088';

const CODENAME_MAP = {
  '전시/미술': 'exhibition',
  '뮤지컬/연극': 'exhibition',
  '영화': 'exhibition',
  '음악/콘서트': 'festival',
  '축제/행사': 'festival',
  '체육': 'festival',
  '독서/글쓰기': 'library',
  '교육/체험': 'other',
  '기타': 'other',
};

function toCategory(codename) {
  return CODENAME_MAP[codename] || 'other';
}

function toSeason(dateStr) {
  if (!dateStr) return 'all';
  const month = parseInt(dateStr.slice(5, 7), 10);
  if (month >= 3 && month <= 5)  return 'spring';
  if (month >= 6 && month <= 8)  return 'summer';
  if (month >= 9 && month <= 11) return 'fall';
  return 'winter';
}

function toDate(dateStr) {
  if (!dateStr) return null;
  return dateStr.split(' ')[0]; // "2026-05-01 00:00:00.0" → "2026-05-01"
}

// POST /api/seoul-import  { adminPassword, start, end }
router.post('/', async (req, res) => {
  const { adminPassword, start = 1, end = 20 } = req.body;

  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  }

  const url = `${SEOUL_API_URL}/${SEOUL_API_KEY}/json/culturalEventInfo/${start}/${end}/`;

  let events;
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    events = data?.culturalEventInfo?.row;
    if (!events) return res.status(502).json({ error: '서울시 API 응답 오류', raw: data });
  } catch (e) {
    return res.status(502).json({ error: '서울시 API 요청 실패', detail: e.message });
  }

  const existing = new Set(db.filter('popups', () => true).map(p => p.name));
  let inserted = 0, skipped = 0;

  for (const ev of events) {
    if (existing.has(ev.TITLE)) { skipped++; continue; }

    const startDate = toDate(ev.STRTDATE);
    const endDate   = toDate(ev.END_DATE);
    const isFree    = ev.IS_FREE === '1' || (ev.USE_FEE && ev.USE_FEE.includes('무료'));

    db.insert('popups', {
      name:          ev.TITLE,
      description:   ev.MAIN_CONTENT || ev.USE_TRGT || '',
      lat:           parseFloat(ev.LAT)  || 37.5665,
      lng:           parseFloat(ev.LOT)  || 126.9780,
      address:       ev.PLACE || '',
      venue:         ev.PLACE || null,
      start_date:    startDate,
      end_date:      endDate,
      is_permanent:  0,
      season:        toSeason(startDate),
      category:      toCategory(ev.CODENAME),
      website_url:   ev.ORG_LINK || '',
      opening_hours: null,
      closed_days:   null,
      admission_fee: isFree ? '무료' : (ev.USE_FEE || null),
      keywords:      ev.CODENAME || null,
      media_path:    null,
      media_items:   [],
      is_active:     1,
    });
    existing.add(ev.TITLE);
    inserted++;
  }

  res.json({ inserted, skipped, total: events.length });
});

module.exports = router;
