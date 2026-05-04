const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { tipLimiter } = require('../middleware/rateLimiter');

router.post('/:popupId', tipLimiter, async (req, res) => {
  try {
    const { popupId } = req.params;
    const { text } = req.body;

    if (!text || !text.trim()) return res.status(400).json({ error: '내용을 입력해주세요.' });
    const trimmed = text.trim();
    if (trimmed.length > 100) return res.status(400).json({ error: '100자 이내로 입력해주세요.' });

    if (!await db.getById('popups', popupId)) return res.status(404).json({ error: '팝업을 찾을 수 없습니다.' });

    const userIp = req.ip || req.connection.remoteAddress;
    const tip = await db.insert('tips', { popup_id: popupId, text: trimmed, user_ip: userIp });
    res.status(201).json({ id: tip.id, text: tip.text, created_at: tip.created_at });
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.get('/:popupId', async (req, res) => {
  try {
    const { popupId } = req.params;
    const tips = (await db.filter('tips', t => t.popup_id === popupId))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 30)
      .map(t => ({ id: t.id, text: t.text, created_at: t.created_at }));
    res.json(tips);
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;
