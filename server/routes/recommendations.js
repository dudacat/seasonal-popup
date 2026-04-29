const express = require('express');
const router  = express.Router();
const db      = require('../db');

// 계절별 추천 코스 조회
router.get('/:season', (req, res) => {
  const { season } = req.params;
  const valid = ['spring', 'summer', 'fall', 'winter'];
  if (!valid.includes(season)) {
    return res.status(400).json({ error: '유효한 계절을 입력해주세요.' });
  }
  const recs = db.filter('recommendations', r => r.season === season);
  res.json(recs);
});

// 추천 코스 등록 (어드민)
router.post('/', (req, res) => {
  const { adminPassword, season, title, description, places } = req.body;
  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  }
  if (!season || !title) {
    return res.status(400).json({ error: '계절과 제목은 필수입니다.' });
  }
  const rec = db.insert('recommendations', { season, title, description: description || '', places: places || '' });
  res.status(201).json(rec);
});

module.exports = router;
