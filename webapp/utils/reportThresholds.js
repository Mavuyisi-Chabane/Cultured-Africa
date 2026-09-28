// Targets used to flag underperforming rows on the admin reports (SS-R1). A value below
// `warn` gets an amber "Below target" badge; below `critical` it gets a red "Critical"
// one. The same levels drive the "Only films with issues" filter, so what is flagged
// and what that filter keeps can never disagree.
const THRESHOLDS = {
  rating: { warn: 4.2, critical: 4.0 },      // average star rating out of 5
  completion: { warn: 60, critical: 50 },    // % of views watched to the end
  reviewStars: { warn: 4, critical: 3 }      // a single review: 3★ is amber, 1–2★ red
};

function flagLevel(kind, value) {
  if (value === null || value === undefined) return null;
  const t = THRESHOLDS[kind];
  if (value < t.critical) return 'critical';
  if (value < t.warn) return 'warn';
  return null;
}

module.exports = { THRESHOLDS, flagLevel };
