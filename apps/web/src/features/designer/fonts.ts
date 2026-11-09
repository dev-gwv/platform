/**
 * The designer's typefaces (scripts and serifs a wedding quotation wears),
 * one Google Fonts request the first time a design is opened. Separate from
 * shared/theme/fonts.ts, which is the app's own UI face.
 */
const HREF =
  'https://fonts.googleapis.com/css2?family=Great+Vibes&family=Allura' +
  '&family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400' +
  '&family=Playfair+Display:wght@400;600;700' +
  '&family=Lato:ital,wght@0,400;0,700;1,400' +
  '&family=Raleway:ital,wght@0,400;0,600;0,700;1,400' +
  '&family=Nunito+Sans:ital,wght@0,400;0,700;1,400' +
  '&family=Montserrat:ital,wght@0,400;0,600;0,700;1,400&display=swap'

export function loadDesignerFonts() {
  if (typeof document === 'undefined' || document.getElementById('designer-fonts')) return
  const link = document.createElement('link')
  link.id = 'designer-fonts'
  link.rel = 'stylesheet'
  link.href = HREF
  document.head.appendChild(link)
}
