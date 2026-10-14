// Cultures always offered in the upload form's Culture Category list, even on a new
// database with no films yet. Picking one that isn't in the cultures table yet adds it
// there on save. Anything else is typed in through the list's "Other" option.
const DEFAULT_CULTURES = [
  'Ndebele',
  'Pedi',
  'Sotho',
  'Swati',
  'Tsonga',
  'Tswana',
  'Venda',
  'Xhosa',
  'Zulu',
  'Khoi and San',
  'Multi-Culture'
];

module.exports = { DEFAULT_CULTURES };
