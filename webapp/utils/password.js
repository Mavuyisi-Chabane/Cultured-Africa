const SPECIAL_CHAR_REGEX = /[!@#$%^&*(),.?":{}|<>_\-+=~`[\]\\/;']/;

function getPasswordRequirementFailures(password) {
  const failures = [];
  if (password.length < 8) failures.push('at least 8 characters');
  if (!/[A-Z]/.test(password)) failures.push('an uppercase letter');
  if (!/[a-z]/.test(password)) failures.push('a lowercase letter');
  if (!/[0-9]/.test(password)) failures.push('a number');
  if (!SPECIAL_CHAR_REGEX.test(password)) failures.push('a special character');
  return failures;
}

module.exports = { getPasswordRequirementFailures };
