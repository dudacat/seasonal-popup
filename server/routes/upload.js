const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const { uploadLimiter } = require('../middleware/rateLimiter');

const UPLOAD_DIR  = 'tmp';
const VIDEO_EXTS  = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv']);
const IMAGE_EXTS  = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);

// uploads 디렉토리 보장
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function isAllowed(file) {
  const ext  = path.extname(file.originalname).toLowerCase().slice(1);
  const mime = file.mimetype.toLowerCase();
  if (IMAGE_EXTS.has(ext) && mime.startsWith('image/')) return true;
  if (VIDEO_EXTS.has(ext) && mime.startsWith('video/')) return true;
  return false;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file,  cb) => cb(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
  fileFilter: (_req, file, cb) => {
    isAllowed(file)
      ? cb(null, true)
      : cb(new Error('이미지(jpg·png·gif·webp) 또는 동영상(mp4·webm·mov·avi) 파일만 업로드 가능합니다.'));
  },
});

// 사진 / 영상 업로드  (IP당 1분에 10번)
router.post('/', uploadLimiter, (req, res) => {
  // 명시적 콜백: multer 에러가 100% 여기서 잡힘
  upload.single('media')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? '파일 크기는 200MB 이하여야 합니다.'
        : err.message || '업로드에 실패했습니다.';
      return res.status(400).json({ error: msg });
    }

    if (!req.file) {
      return res.status(400).json({ error: '파일을 선택해주세요.' });
    }

    const ext  = path.extname(req.file.filename).slice(1).toLowerCase();
    const type = VIDEO_EXTS.has(ext) ? 'video' : 'image';

    res.json({
      filename: req.file.filename,
      url:      `/uploads/${req.file.filename}`,
      size:     req.file.size,
      type,
    });
  });
});

module.exports = router;
