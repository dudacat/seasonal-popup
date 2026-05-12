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

router.put('/:tipId', async (req, res) => {
  try {
    const { tipId } = req.params;
    const { text } = req.body;

    if (!text || !text.trim()) return res.status(400).json({ error: '내용을 입력해주세요.' });
    const trimmed = text.trim();
    if (trimmed.length > 100) return res.status(400).json({ error: '100자 이내로 입력해주세요.' });

    const tip = await db.getById('tips', tipId);
    if (!tip) return res.status(404).json({ error: '리뷰를 찾을 수 없습니다.' });

    const userIp = req.ip || req.connection.remoteAddress;
    if (tip.user_ip !== userIp) return res.status(403).json({ error: '수정 권한이 없습니다.' });

    const updated = await db.update('tips', tipId, { text: trimmed });
    res.json({ id: updated.id, text: updated.text, created_at: updated.created_at });
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.delete('/:tipId', async (req, res) => {
  try {
    const { tipId } = req.params;
    const { adminPassword } = req.body;

    const tip = await db.getById('tips', tipId);
    if (!tip) return res.status(404).json({ error: '리뷰를 찾을 수 없습니다.' });

    const userIp = req.ip || req.connection.remoteAddress;
    const isAdmin = adminPassword && adminPassword === process.env.ADMIN_PASSWORD;
    const isOwner = tip.user_ip === userIp;

    if (!isAdmin && !isOwner) return res.status(403).json({ error: '삭제 권한이 없습니다.' });

    await db.delete('tips', tipId);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;
