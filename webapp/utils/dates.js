const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function startOfWeek(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setDate(d.getDate() + diff);
  return d;
}

function endOfWeek(date = new Date()) {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return end;
}

function toSqlDateTime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// `end` is exclusive, matching endOfWeek().
function formatDateRange(start, end) {
  const last = new Date(end.getTime() - 1);
  const startStr = `${start.getDate()} ${MONTH_NAMES[start.getMonth()]}`;
  const endStr = `${last.getDate()} ${MONTH_NAMES[last.getMonth()]} ${last.getFullYear()}`;
  return `${startStr} – ${endStr}`;
}

function formatWeekLabel(start, end) {
  return `Week of ${formatDateRange(start, end)}`;
}

module.exports = { startOfWeek, endOfWeek, toSqlDateTime, formatDateRange, formatWeekLabel };
