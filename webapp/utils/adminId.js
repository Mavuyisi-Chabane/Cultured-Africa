// Sequential, human-readable admin IDs (ADM-0001, ADM-0002, ...). Computed from the
// current max rather than a counter table — admin creation is rare and always goes
// through a single request path, so the tiny race window this leaves is an accepted
// tradeoff for not needing extra state.
function nextAdminId(db) {
  let maxNum = 0;
  db.prepare('SELECT admin_id FROM admins').all().forEach(row => {
    const match = /^ADM-(\d+)$/.exec(row.admin_id);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
  });
  return 'ADM-' + String(maxNum + 1).padStart(4, '0');
}

module.exports = { nextAdminId };
