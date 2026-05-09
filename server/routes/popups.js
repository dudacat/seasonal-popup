const express = require('express');
const router  = express.Router();
const db      = require('../db');

// 팝업 목록 (필터: season)
router.get('/', async (req, res) => {
  try {
    const { season } = req.query;
    let list = await db.filter('popups', p => p.is_active === 1);

    if (season && season !== 'all') {
      list = list.filter(p => p.season === season || p.season === 'all');
    }

    list.sort((a, b) => {
      if (!a.end_date) return 1;
      if (!b.end_date) return -1;
      return new Date(a.end_date) - new Date(b.end_date);
    });
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 팝업 단건 조회
router.get('/:id', async (req, res) => {
  try {
    const popup = await db.getById('popups', req.params.id);
    if (!popup) return res.status(404).json({ error: '팝업을 찾을 수 없습니다.' });
    res.json(popup);
  } catch (err) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 팝업 등록 (어드민)
router.post('/', async (req, res) => {
  try {
    const { adminPassword, name, description, lat, lng, address, venue,
      start_date, end_date, is_permanent, season, category, media_path, website_url,
      opening_hours, closed_days, admission_fee, keywords, info, nearby_station } = req.body;

    if (adminPassword !== process.env.ADMIN_PASSWORD) {
      return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
    }

    // 같은 venue에 최대 3개 제한
    if (venue && venue.trim()) {
      const sameVenue = await db.filter('popups', p =>
        p.is_active === 1 &&
        p.venue &&
        p.venue.toLowerCase().trim() === venue.toLowerCase().trim()
      );
      if (sameVenue.length >= 3) {
        return res.status(400).json({ error: '한 장소에 최대 3개의 팝업만 등록할 수 있습니다.' });
      }
    }

    const popup = await db.insert('popups', {
      name: name || '',
      description: description || '',
      lat: lat ? parseFloat(lat) : 37.5665,
      lng: lng ? parseFloat(lng) : 126.9780,
      info: info || null, venue: venue || null, address: address || '',
      is_permanent: is_permanent ? 1 : 0,
      start_date: is_permanent ? null : (start_date || null),
      end_date:   is_permanent ? null : (end_date   || null),
      season:   season   || 'all',
      category: category || 'other',
      media_path: media_path || null, website_url: website_url || '',
      opening_hours: opening_hours || null, closed_days: closed_days || null,
      admission_fee: admission_fee || null, keywords: keywords || null,
      nearby_station: nearby_station || null,
      media_items: [],
      is_active: 1,
    });
    res.status(201).json(popup);
  } catch (err) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 팝업 수정
router.put('/:id', async (req, res) => {
  try {
    const { adminPassword, ...fields } = req.body;
    if (adminPassword !== process.env.ADMIN_PASSWORD) {
      return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
    }

    if (!await db.getById('popups', req.params.id)) {
      return res.status(404).json({ error: '팝업을 찾을 수 없습니다.' });
    }

    const allowed = ['name','description','lat','lng','address','start_date','end_date',
                     'is_permanent','season','category','media_path','website_url','is_active',
                     'opening_hours','closed_days','admission_fee','keywords','venue','info','nearby_station'];
    const updates = {};
    allowed.forEach(k => { if (fields[k] !== undefined) updates[k] = fields[k]; });

    res.json(await db.update('popups', req.params.id, updates));
  } catch (err) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 갤러리 미디어 추가
router.post('/:id/media', async (req, res) => {
  try {
    const { filename, type } = req.body;
    if (!filename) return res.status(400).json({ error: '파일명이 필요합니다.' });

    const popup = await db.getById('popups', req.params.id);
    if (!popup) return res.status(404).json({ error: '팝업을 찾을 수 없습니다.' });

    const items = [...(popup.media_items || [])];
    items.push({ filename, type: type || 'image' });
    await db.update('popups', req.params.id, { media_items: items });
    res.json({ success: true, filename, type });
  } catch (err) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 갤러리 미디어 삭제 (어드민)
router.delete('/:id/media/:index', async (req, res) => {
  try {
    const { adminPassword } = req.body;
    if (adminPassword !== process.env.ADMIN_PASSWORD) {
      return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
    }
    const popup = await db.getById('popups', req.params.id);
    if (!popup) return res.status(404).json({ error: '팝업을 찾을 수 없습니다.' });

    const items = [...(popup.media_items || [])];
    const idx   = parseInt(req.params.index);
    if (isNaN(idx) || idx < 0 || idx >= items.length) {
      return res.status(400).json({ error: '유효하지 않은 인덱스입니다.' });
    }
    items.splice(idx, 1);
    await db.update('popups', req.params.id, { media_items: items });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 팝업 삭제
router.delete('/:id', async (req, res) => {
  try {
    const { adminPassword } = req.body;
    if (adminPassword !== process.env.ADMIN_PASSWORD) {
      return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
    }
    await db.delete('popups', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;
