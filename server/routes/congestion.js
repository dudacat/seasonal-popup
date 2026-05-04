const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { congestionLimiter } = require('../middleware/rateLimiter');

// 혼잡도 보고 (IP당 1분에 10번 제한)
router.post('/:popupId', congestionLimiter, async (req, res) => {
  try {
    const { wait_time, note } = req.body;
    const { popupId } = req.params;
    const userIp = req.ip || req.connection.remoteAddress;

    if (!await db.getById('popups', popupId)) {
      return res.status(404).json({ error: '팝업을 찾을 수 없습니다.' });
    }
    if (wait_time === undefined && !note) {
      return res.status(400).json({ error: '대기 시간 또는 메모를 입력해주세요.' });
    }

    const log = await db.insert('congestion_logs', {
      popup_id:  popupId,
      wait_time: wait_time !== undefined && wait_time !== '' ? +wait_time : null,
      note:      note || null,
      user_ip:   userIp,
    });
    res.status(201).json(log);
  } catch (err) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 혼잡도 기록 조회 (최근 10건)
router.get('/:popupId', async (req, res) => {
  try {
    const { popupId } = req.params;
    const logs = (await db.filter('congestion_logs', c => c.popup_id === popupId))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 10);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;
