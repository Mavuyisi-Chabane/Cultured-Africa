const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configurable so production can point this at a mounted persistent disk (e.g.
// Render's disk feature) instead of the app's own ephemeral checkout — without a
// persistent disk, every deploy/restart would wipe out anything uploaded here.
const UPLOAD_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Only formats browsers can actually play / display. The saved file's extension comes
// from this list (never the uploader's filename), so nothing like .html or .svg can be
// planted in /uploads and served back from this site's domain.
const VIDEO_TYPES = {
  '.mp4': ['video/mp4'],
  '.m4v': ['video/mp4', 'video/x-m4v'],
  '.webm': ['video/webm'],
  '.mov': ['video/quicktime']
};
const IMAGE_TYPES = {
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.webp': ['image/webp'],
  '.gif': ['image/gif']
};
const VIDEO_FIELDS = new Set(['videoFile', 'trailerFile']);

const GB = 1024 * 1024 * 1024;
// Must be a whole number of bytes: with a fractional limit busboy truncates the file
// without multer reporting LIMIT_FILE_SIZE, so a cut-off video would be saved as if valid.
const MAX_VIDEO_BYTES = Math.floor(Number(process.env.MAX_VIDEO_GB || 9) * GB);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const VIDEO_FORMATS_LABEL = 'MP4, WebM or MOV';
const IMAGE_FORMATS_LABEL = 'JPG, PNG, WebP or GIF';

function allowedTypesFor(fieldname) {
  if (VIDEO_FIELDS.has(fieldname)) return VIDEO_TYPES;
  if (fieldname === 'thumbnailFile') return IMAGE_TYPES;
  return null;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = crypto.randomBytes(8).toString('hex');
    cb(null, `${Date.now()}-${unique}${path.extname(file.originalname).toLowerCase()}`);
  }
});

function fileFilter(req, file, cb) {
  const types = allowedTypesFor(file.fieldname);
  if (!types) return cb(new UploadError('Unexpected file field.'));
  const ext = path.extname(file.originalname).toLowerCase();
  if (!types[ext] || !types[ext].includes(file.mimetype)) {
    const isVideo = VIDEO_FIELDS.has(file.fieldname);
    const label = file.fieldname === 'trailerFile' ? 'Trailer' : (isVideo ? 'Video' : 'Thumbnail');
    return cb(new UploadError(`${label} "${file.originalname}" isn't a supported format. Please upload ${isVideo ? VIDEO_FORMATS_LABEL : IMAGE_FORMATS_LABEL}.`));
  }
  cb(null, true);
}

class UploadError extends Error {}

const upload = multer({
  storage,
  fileFilter,
  // Multer applies one size limit to every file; images get their tighter limit below.
  limits: { fileSize: MAX_VIDEO_BYTES, files: 3 }
}).fields([
  { name: 'videoFile', maxCount: 1 },
  { name: 'thumbnailFile', maxCount: 1 },
  { name: 'trailerFile', maxCount: 1 }
]);

function removeFiles(files) {
  Object.values(files || {}).flat().forEach(f => fs.unlink(f.path, () => {}));
}

// Never throws into Express: on any problem the uploaded files are deleted and
// req.uploadError holds a message the route shows on the form.
function handleUploads(req, res, next) {
  upload(req, res, err => {
    if (err) {
      removeFiles(req.files);
      req.files = {};
      if (err instanceof UploadError) req.uploadError = err.message;
      else if (err.code === 'LIMIT_FILE_SIZE') req.uploadError = `That file is too large. Videos can be at most ${+(MAX_VIDEO_BYTES / GB).toFixed(1)} GB — please compress it and try again.`;
      else req.uploadError = 'The upload could not be completed. Please try again.';
      return next();
    }
    const thumb = req.files && req.files.thumbnailFile && req.files.thumbnailFile[0];
    if (thumb && thumb.size > MAX_IMAGE_BYTES) {
      removeFiles(req.files);
      req.files = {};
      req.uploadError = `The thumbnail image is too large. Images can be at most ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`;
    }
    next();
  });
}

module.exports = handleUploads;
module.exports.UPLOAD_DIR = UPLOAD_DIR;
module.exports.VIDEO_EXTENSIONS = Object.keys(VIDEO_TYPES);
module.exports.IMAGE_EXTENSIONS = Object.keys(IMAGE_TYPES);
module.exports.VIDEO_FORMATS_LABEL = VIDEO_FORMATS_LABEL;
