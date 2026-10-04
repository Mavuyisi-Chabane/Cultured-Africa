const express = require('express');
const path = require('path');
const { UPLOAD_DIR, IMAGE_EXTENSIONS } = require('./upload');

// /uploads serves thumbnails and trailers publicly, but never a full film: those only
// stream through GET /film/:id/stream, which checks the viewer has paid. Admins can
// open any uploaded file (the upload form's "pick a frame" reads the current video).
function uploadsAccess(db) {
  const serve = express.static(UPLOAD_DIR, { fallthrough: false, index: false });
  const isTrailer = db.prepare('SELECT 1 FROM content WHERE trailer_url = ? LIMIT 1');

  return (req, res, next) => {
    const ext = path.extname(req.path).toLowerCase();
    const allowed = IMAGE_EXTENSIONS.includes(ext)
      || Boolean(req.session && req.session.admin)
      || Boolean(isTrailer.get(`/uploads${req.path}`));
    if (!allowed) return res.status(404).end();
    serve(req, res, next);
  };
}

module.exports = uploadsAccess;
