const rateLimit = require('express-rate-limit');

// 일반 API: IP당 1분에 60번
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '요청이 너무 많습니다. 1분 후 다시 시도해주세요.', retryAfter: '1분' },
  handler: (req, res, _next, options) => {
    res.status(429).json(options.message);
  },
});

// AI 기능: IP당 1분에 5번
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'AI 요청이 너무 많습니다. 1분 후 다시 시도해주세요.', retryAfter: '1분' },
  handler: (req, res, _next, options) => {
    res.status(429).json(options.message);
  },
});

// 로그인 시도: IP당 5분에 5번
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: '로그인 시도가 너무 많습니다. 5분 후 다시 시도해주세요.', retryAfter: '5분' },
  handler: (req, res, _next, options) => {
    res.status(429).json(options.message);
  },
});

// 업로드: IP당 1분에 10번
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '업로드 요청이 너무 많습니다. 1분 후 다시 시도해주세요.', retryAfter: '1분' },
  handler: (req, res, _next, options) => {
    res.status(429).json(options.message);
  },
});

// 혼잡도 보고: IP당 1분에 10번
const congestionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '혼잡도 보고 요청이 너무 많습니다. 1분 후 다시 시도해주세요.', retryAfter: '1분' },
  handler: (req, res, _next, options) => {
    res.status(429).json(options.message);
  },
});

module.exports = { generalLimiter, aiLimiter, loginLimiter, uploadLimiter, congestionLimiter };
