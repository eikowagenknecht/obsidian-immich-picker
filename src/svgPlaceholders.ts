/**
 * SVG placeholder images for loading states and errors
 */

const SVG_SIZE = 150

function svgDataUrl (svg: string): string {
  return 'data:image/svg+xml,' + encodeURIComponent(svg)
}

export function createLoadingSvg (): string {
  return svgDataUrl(
    `<svg width="${SVG_SIZE}" height="${SVG_SIZE}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${SVG_SIZE}" height="${SVG_SIZE}" fill="#f0f0f0"/>` +
    '<text x="75" y="80" text-anchor="middle" fill="#666" font-family="Arial" font-size="12">Loading...</text>' +
    '</svg>'
  )
}

export function createErrorSvg (errorMsg: string, hint?: string): string {
  const lines = hint
    ? `<text x="75" y="70" text-anchor="middle" fill="#c62828" font-family="Arial" font-size="11">${errorMsg}</text>` +
      `<text x="75" y="90" text-anchor="middle" fill="#666" font-family="Arial" font-size="9">${hint}</text>`
    : `<text x="75" y="80" text-anchor="middle" fill="#c62828" font-family="Arial" font-size="11">${errorMsg}</text>`

  return svgDataUrl(
    `<svg width="${SVG_SIZE}" height="${SVG_SIZE}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${SVG_SIZE}" height="${SVG_SIZE}" fill="#ffebee"/>` +
    lines +
    '</svg>'
  )
}

export function createEmptySvg (): string {
  return svgDataUrl(
    `<svg width="${SVG_SIZE}" height="${SVG_SIZE}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${SVG_SIZE}" height="${SVG_SIZE}" fill="#ddd"/>` +
    '</svg>'
  )
}
