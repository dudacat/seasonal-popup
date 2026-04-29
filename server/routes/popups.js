const express = require('express');
const router  = express.Router();
const db      = require('../db');

// 팝업 목록 (필터: season)
router.get('/', (req, res) => {
  const { season } = req.query;
  let list = db.filter('popups', p => p.is_active === 1);

  if (season && season !== 'all') {
    list = list.filter(p => p.season === season || p.season === 'all');
  }

  list.sort((a, b) => {
    if (!a.end_date) return 1;
    if (!b.end_date) return -1;
    return new Date(a.end_date) - new Date(b.end_date);
  });
  res.json(list);
});

// 팝업 단건 조회
router.get('/:id', (req, res) => {
  const popup = db.getById('popups', req.params.id);
  if (!popup) return res.status(404).json({ error: '팝업을 찾을 수 없습니다.' });
  res.json(popup);
});

// 팝업 등록 (어드민)
router.post('/', (req, res) => {
  const { adminPassword, name, description, lat, lng, address, venue,
    start_date, end_date, is_permanent, season, category, media_path, website_url,
    opening_hours, closed_days, admission_fee, keywords, info } = req.body;

  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  }
  const dateOk = is_permanent || (start_date && end_date);
  if (!name || !lat || !lng || !dateOk || !season || !category) {
    return res.status(400).json({ error: '필수 항목을 모두 입력해주세요.' });
  }

  const popup = db.insert('popups', {
    name, description: description || '',
    lat: parseFloat(lat), lng: parseFloat(lng),
    info: info || null, venue: venue || null, address: address || '',
    is_permanent: is_permanent ? 1 : 0,
    start_date: is_permanent ? null : start_date,
    end_date:   is_permanent ? null : end_date,
    season, category,
    media_path: media_path || null, website_url: website_url || '',
    opening_hours: opening_hours || null, closed_days: closed_days || null,
    admission_fee: admission_fee || null, keywords: keywords || null,
    is_active: 1,
  });
  res.status(201).json(popup);
});

// 팝업 수정
router.put('/:id', (req, res) => {
  const { adminPassword, ...fields } = req.body;
  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  }

  if (!db.getById('popups', req.params.id)) {
    return res.status(404).json({ error: '팝업을 찾을 수 없습니다.' });
  }

  const allowed = ['name','description','lat','lng','address','start_date','end_date',
                   'is_permanent','season','category','media_path','website_url','is_active',
                   'opening_hours','closed_days','admission_fee','keywords','venue','info'];
  const updates = {};
  allowed.forEach(k => { if (fields[k] !== undefined) updates[k] = fields[k]; });

  res.json(db.update('popups', req.params.id, updates));
});

// 갤러리 미디어 추가
router.post('/:id/media', (req, res) => {
  const { filename, type } = req.body;
  if (!filename) return res.status(400).json({ error: '파일명이 필요합니다.' });

  const popup = db.getById('popups', req.params.id);
  if (!popup) return res.status(404).json({ error: '팝업을 찾을 수 없습니다.' });

  const items = [...(popup.media_items || [])];
  items.push({ filename, type: type || 'image' });
  db.update('popups', req.params.id, { media_items: items });
  res.json({ success: true, filename, type });
});

// 갤러리 미디어 삭제 (어드민)
router.delete('/:id/media/:index', (req, res) => {
  const { adminPassword } = req.body;
  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  }
  const popup = db.getById('popups', req.params.id);
  if (!popup) return res.status(404).json({ error: '팝업을 찾을 수 없습니다.' });

  const items = [...(popup.media_items || [])];
  const idx   = parseInt(req.params.index);
  if (isNaN(idx) || idx < 0 || idx >= items.length) {
    return res.status(400).json({ error: '유효하지 않은 인덱스입니다.' });
  }
  items.splice(idx, 1);
  db.update('popups', req.params.id, { media_items: items });
  res.json({ success: true });
});

// 팝업 삭제
router.delete('/:id', (req, res) => {
  const { adminPassword } = req.body;
  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  }
  db.delete('popups', req.params.id);
  res.json({ success: true });
});

module.exports = router;
