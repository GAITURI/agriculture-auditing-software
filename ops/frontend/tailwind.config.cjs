// Convention: Bootstrap = components + layout behaviour. Tailwind = small utilities, always prefixed `tw-`
// (prefix + no preflight avoid clashes with Bootstrap's reset and class names such as .collapse/.container).
module.exports = {
  prefix: 'tw-',
  content: ['./*.html', './js/**/*.js'],   // JS templates are scanned too, so classes built in strings are kept
  corePlugins: { preflight: false },
  theme: { extend: { colors: { frond: { DEFAULT: '#24493a', dark: '#1b382c', mist: '#e9eeea' }, oil: '#e3a21a' } } },
}
