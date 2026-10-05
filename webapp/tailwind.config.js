// Builds public/css/app.css from the classes used in the views (npm run build:css).
// Replaces the Tailwind CDN script, which compiled styles in every visitor's browser.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./views/**/*.ejs'],
  theme: {
    extend: {
      colors: {
        // Dark cinematic sunset palette: near-black surfaces, amber/tangerine accents.
        primary: '#140d0a',    // base page surface (warm near-black)
        surface: '#1e1613',    // elevated card / section
        sand: '#271c17',       // secondary tile / input surface
        ink: '#f7efe6',        // primary text / headings (warm white)
        muted: '#a99a8b',      // secondary text
        border: '#38281f',     // hairline borders on surfaces
        borderdark: '#38281f', // hairline borders on dark surfaces
        accent: '#fcaa13'      // amber accent (interactive only)
      },
      fontFamily: {
        sans: ['EB Garamond', 'serif'],
        serif: ['Cinzel', 'serif']
      },
      keyframes: {
        scroll: { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } },
        floaty: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } }
      },
      animation: {
        scroll: 'scroll 30s linear infinite',
        floaty: 'floaty 6s ease-in-out infinite'
      }
    }
  },
  plugins: []
};
