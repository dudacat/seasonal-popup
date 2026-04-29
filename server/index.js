require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const { generalLimiter } = require('./middleware/rateLimiter');

const popupsRouter = require('./routes/popups');
const recommendationsRouter = require('./routes/recommendations');
const uploadRouter = require('./routes/upload');
const authRouter = require('./routes/auth');
const seoulImportRouter = require('./routes/seoulImport');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? process.env.ALLOWED_ORIGIN : '*',
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// 모든 API에 일반 Rate Limit 적용
app.use('/api', generalLimiter);

app.use('/api/popups', popupsRouter);
app.use('/api/recommendations', recommendationsRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/auth', authRouter);
app.use('/api/seoul-import', seoulImportRouter);

// 프론트엔드에 Naver Map 클라이언트 ID 전달 (서버사이드 보관)
app.get('/api/config', (req, res) => {
  res.json({
    naverMapClientId: process.env.NAVER_MAP_CLIENT_ID || '',
    kakaoJsKey:       process.env.KAKAO_JS_KEY       || '',
  });
});

app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || '서버 오류가 발생했습니다.' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`🌸 제철코어 서버: http://localhost:${PORT}`);
});

module.exports = app;
