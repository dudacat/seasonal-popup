const express = require('express');
const router = express.Router();
const { loginLimiter } = require('../middleware/rateLimiter');

// 어드민 비밀번호 확인 (IP당 5분에 5번 제한)
router.post('/verify', loginLimiter, (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: '비밀번호를 입력해주세요.' });

  if (password === process.env.ADMIN_PASSWORD) {
    res.json({ success: true, message: '관리자 인증 성공' });
  } else {
    res.status(401).json({ success: false, error: '비밀번호가 올바르지 않습니다.' });
  }
});

module.exports = router;
