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

function formatWeekLabel(start, end) {
  const last = new Date(end.getTime() - 1);
  const startStr = `${start.getDate()} ${MONTH_NAMES[start.getMonth()]}`;
  const endStr = `${last.getDate()} ${MONTH_NAMES[last.getMonth()]} ${last.getFullYear()}`;
  return `Week of ${startStr} – ${endStr}`;
}

module.exports = { startOfWeek, endOfWeek, toSqlDateTime, formatWeekLabel };
