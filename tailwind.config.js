/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./*.html', './*.js'],
  theme: {
    extend: {
      colors: {
        ink: '#101714',
        header: '#151e19',
        card: '#1b2420',
        cloud: '#f1f3ed',
        muted: '#9ca9a0',
        secondary: '#c5cec7',
        line: '#303b34',
        coral: {
          DEFAULT: '#bd5638',
          light: '#f0a082',
          hover: '#a84930'
        }
      },
      fontFamily: {
        sans: ['DM Sans', 'Trebuchet MS', 'sans-serif'],
        display: ['Space Grotesk', 'Trebuchet MS', 'sans-serif']
      },
      backgroundImage: {
        'jobs-hero': 'linear-gradient(115deg, #17221c 0%, #121a16 62%, #1a2119 100%)'
      }
    }
  },
  plugins: []
};