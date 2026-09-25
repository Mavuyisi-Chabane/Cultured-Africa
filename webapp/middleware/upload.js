const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configurable so production can point this at a mounted persistent disk (e.g.
// Render's disk feature) instead of the app's own ephemeral checkout — without a
// persistent disk, every deploy/restart would wipe out anything uploaded here.
const UPLOAD_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${unique}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.fieldname === 'thumbnailFile') {
    return cb(null, file.mimetype.startsWith('image/'));
  }
  if (file.fieldname === 'videoFile' || file.fieldname === 'trailerFile') {
    return cb(null, file.mimetype.startsWith('video/'));
  }
  cb(null, false);
};

// No fileSize limit — multer streams straight to disk via diskStorage, so this
// doesn't risk buffering large uploads in memory.
const upload = multer({
  storage,
  fileFilter
});

module.exports = upload.fields([
  { name: 'videoFile', maxCount: 1 },
  { name: 'thumbnailFile', maxCount: 1 },
  { name: 'trailerFile', maxCount: 1 }
]);
module.exports.UPLOAD_DIR = UPLOAD_DIR;
