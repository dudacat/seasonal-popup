const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');
const admin   = require('../firebaseAdmin');
const { uploadLimiter } = require('../middleware/rateLimiter');

const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv']);
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);

function isAllowed(file) {
  const ext  = path.extname(file.originalname).toLowerCase().slice(1);
  const mime = file.mimetype.toLowerCase();
  if (IMAGE_EXTS.has(ext) && mime.startsWith('image/')) return true;
  if (VIDEO_EXTS.has(ext) && mime.startsWith('video/')) return true;
  return false;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    isAllowed(file)
      ? cb(null, true)
      : cb(new Error('이미지(jpg·png·gif·webp) 또는 동영상(mp4·webm·mov·avi) 파일만 업로드 가능합니다.'));
  },
});

async function uploadToFirebase(file) {
  const ext    = path.extname(file.originalname).toLowerCase();
  const name   = `${uuidv4()}${ext}`;
  const bucket = admin.storage().bucket();
  const blob   = bucket.file(`uploads/${name}`);
  const token  = uuidv4();

  await blob.save(file.buffer, {
    metadata: {
      contentType: file.mimetype,
      cacheControl: 'public, max-age=31536000',
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });

  const encodedPath = encodeURIComponent(`uploads/${name}`);
  const url  = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`;
  const type = VIDEO_EXTS.has(ext.slice(1)) ? 'video' : 'image';
  return { filename: url, url, size: file.size, type };
}

router.post('/', uploadLimiter, (req, res) => {
  upload.single('media')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? '파일 크기는 200MB 이하여야 합니다.'
        : err.message || '업로드에 실패했습니다.';
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: '파일을 선택해주세요.' });

    try {
      const result = await uploadToFirebase(req.file);
      res.json(result);
    } catch (e) {
      console.error('Firebase Storage 업로드 실패:', e.message);
      res.status(500).json({ error: 'Firebase Storage 업로드 실패: ' + e.message });
    }
  });
});

module.exports = router;
