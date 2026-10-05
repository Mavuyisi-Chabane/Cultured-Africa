// Every date and time is stored in the database in UTC, as 'YYYY-MM-DD HH:MM:SS' text
// (what SQLite's datetime('now') produces), and shown to people in South African time.
// Reading and showing dates only through these helpers keeps that true whatever
// timezone the server itself runs in (hosting servers usually run in UTC).
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TIME_ZONE = 'Africa/Johannesburg';
// South Africa is UTC+2 all year (no daylight saving), used for week boundaries.
const SA_OFFSET_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// A date read from the database (UTC text), as a Date. null/empty stays null.
function parseDbDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const text = String(value).trim();
  // Already carries a zone (e.g. an ISO string): trust it as written.
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(text)) return new Date(text);
  return new Date(text.replace(' ', 'T') + 'Z');
}

// A Date as database text in UTC, for comparing with stored values.
function toSqlDateTime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// "5 Oct 2026" (or other parts via options), in South African time. Formatted with en-GB:
// the same day-month-year order as en-ZA, which writes short dates as "05 Oct 2026".
function formatDate(date, options = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!date) return '';
  return date.toLocaleDateString('en-GB', { ...options, timeZone: TIME_ZONE });
}

// "5 Oct 2026, 17:40", in South African time.
function formatDateTime(date) {
  if (!date) return '';
  return date.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TIME_ZONE
  });
}

// Monday 00:00 South African time of the week containing `date`, as a UTC instant.
function startOfWeek(date = new Date()) {
  const local = new Date(date.getTime() + SA_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  const day = local.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  return new Date(local.getTime() + diff * DAY_MS - SA_OFFSET_MS);
}

function endOfWeek(date = new Date()) {
  return new Date(startOfWeek(date).getTime() + 7 * DAY_MS);
}

// `end` is exclusive, matching endOfWeek().
function formatDateRange(start, end) {
  const first = new Date(start.getTime() + SA_OFFSET_MS);
  const last = new Date(end.getTime() - 1 + SA_OFFSET_MS);
  const startStr = `${first.getUTCDate()} ${MONTH_NAMES[first.getUTCMonth()]}`;
  const endStr = `${last.getUTCDate()} ${MONTH_NAMES[last.getUTCMonth()]} ${last.getUTCFullYear()}`;
  return `${startStr} – ${endStr}`;
}

function formatWeekLabel(start, end) {
  return `Week of ${formatDateRange(start, end)}`;
}

module.exports = {
  TIME_ZONE, parseDbDate, toSqlDateTime, formatDate, formatDateTime,
  startOfWeek, endOfWeek, formatDateRange, formatWeekLabel
};
