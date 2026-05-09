const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { uploadLimiter } = require('../middleware/rateLimiter');

router.get('/:popupId', async (req, res) => {
  try {
    const { popupId } = req.params;
    const photos = (await db.filter('visitor_photos', p => p.popup_id === popupId))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 50)
      .map(p => ({ id: p.id, url: p.url, type: p.type, created_at: p.created_at }));
    res.json(photos);
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.post('/:popupId', uploadLimiter, async (req, res) => {
  try {
    const { popupId } = req.params;
    const { url, type } = req.body;
    if (!url) return res.status(400).json({ error: 'URL이 필요합니다.' });
    if (!await db.getById('popups', popupId)) return res.status(404).json({ error: '팝업을 찾을 수 없습니다.' });
    const photo = await db.insert('visitor_photos', {
      popup_id: popupId,
      url,
      type: type || 'image',
      user_ip: req.ip || req.connection.remoteAddress,
    });
    res.status(201).json({ id: photo.id, url: photo.url, type: photo.type, created_at: photo.created_at });
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: '관리자 권한이 필요합니다.' });
    }
    const { id } = req.params;
    const photo = await db.getById('visitor_photos', id);
    if (!photo) return res.status(404).json({ error: '사진을 찾을 수 없습니다.' });
    await db.delete('visitor_photos', id);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;
