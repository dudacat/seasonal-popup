require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const { generalLimiter } = require('./middleware/rateLimiter');

const popupsRouter         = require('./routes/popups');
const recommendationsRouter = require('./routes/recommendations');
const uploadRouter          = require('./routes/upload');
const authRouter            = require('./routes/auth');
const congestionRouter      = require('./routes/congestion');
const tipsRouter            = require('./routes/tips');
const visitorPhotosRouter   = require('./routes/visitorPhotos');
const seoulImportRouter     = require('./routes/seoulImport');
const naverCrawlRouter      = require('./routes/naverCrawl');
const seedIfEmpty           = require('./seed');
const admin                 = require('./firebaseAdmin');

admin.storage().bucket().setMetadata({
  cors: [{ origin: ['*'], method: ['GET', 'PUT'], maxAgeSeconds: 3600, responseHeader: ['Content-Type'] }],
}).catch(e => console.warn('Storage CORS 설정 실패:', e.message));

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
app.use('/uploads', express.static('/tmp'));

app.use('/api', generalLimiter);

app.use('/api/popups',          popupsRouter);
app.use('/api/recommendations', recommendationsRouter);
app.use('/api/upload',          uploadRouter);
app.use('/api/auth',            authRouter);
app.use('/api/congestion',      congestionRouter);
app.use('/api/tips',            tipsRouter);
app.use('/api/visitor-photos',  visitorPhotosRouter);
app.use('/api/seoul-import',    seoulImportRouter);
app.use('/api/naver-popup-crawl', naverCrawlRouter);

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

const startServer = process.env.NODE_ENV === 'development'
  ? seedIfEmpty()
  : Promise.resolve();

startServer
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🌸 제철코어 서버: http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('🔥 Firebase 초기화 실패:', err.message);
    process.exit(1);
  });

module.exports = app;
