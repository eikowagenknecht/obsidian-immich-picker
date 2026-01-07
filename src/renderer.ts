import { moment, requestUrl } from 'obsidian'
import ImmichPicker from './main'
import { Moment } from 'moment'
import { ImmichAsset } from './immichApi'

export class ThumbnailImage extends Image {
  assetId: string
  immichUrl: string
  filename: string
  originalFilename: string
  creationTime: Moment
}

export default class Renderer {
  plugin: ImmichPicker

  constructor (plugin: ImmichPicker) {
    this.plugin = plugin
  }
}

export class GridView extends Renderer {
  onThumbnailClick: (event: MouseEvent) => void
  containerEl: HTMLElement
  scrollEl: HTMLElement
  isLoading = false

  constructor (options: { scrollEl: HTMLElement, plugin: ImmichPicker, onThumbnailClick: (event: MouseEvent) => void }) {
    super(options.plugin)
    this.scrollEl = options.scrollEl
    this.onThumbnailClick = options.onThumbnailClick
    this.containerEl = document.createElement('div')
    this.containerEl.classList.add('immich-picker-grid')
  }

  async resetGrid () {
    this.containerEl.innerHTML = '<p>Downloading thumbnail...</p>'
  }

  async setLoading () {
    this.isLoading = true
    this.containerEl.innerHTML = '<p>Loading photos...</p>'
  }

  async appendThumbnailsToElement (el: HTMLElement, assets: ImmichAsset[], onclick: (event: MouseEvent) => void) {
    for (const asset of assets || []) {
      const img = new ThumbnailImage()
      const settings = this.plugin.settings
      const api = this.plugin.immichApi

      try {
        // Create placeholder while loading
        img.src = 'data:image/svg+xml;base64,' + btoa(`
          <svg width="150" height="150" xmlns="http://www.w3.org/2000/svg">
            <rect width="150" height="150" fill="#f0f0f0"/>
            <text x="75" y="80" text-anchor="middle" fill="#666" font-family="Arial" font-size="12">Loading...</text>
          </svg>
        `)

        // Set properties
        img.assetId = asset.id
        img.immichUrl = api.getAssetUrl(asset.id)
        img.originalFilename = asset.originalFileName
        img.creationTime = moment(asset.fileCreatedAt)
        img.filename = img.creationTime.format(settings.filename)
        img.onclick = onclick
        img.classList.add('immich-picker-thumbnail')

        // Add to DOM
        el.appendChild(img)

        // Fetch actual thumbnail
        const thumbnailUrl = api.getThumbnailUrl(asset.id)
        const imageData = await requestUrl({
          url: thumbnailUrl,
          headers: {
            'x-api-key': settings.apiKey
          }
        })

        // Create blob URL
        const blob = new Blob([imageData.arrayBuffer], { type: 'image/jpeg' })
        const blobUrl = URL.createObjectURL(blob)
        img.src = blobUrl

        img.addEventListener('remove', () => {
          URL.revokeObjectURL(blobUrl)
        })
      } catch (error) {
        const err = error as Error & { status?: number }
        const status = err.status || (err.message.match(/status (\d+)/)?.[1])
        let errorMsg = 'Failed'
        let hint = ''

        if (String(status) === '403') {
          errorMsg = '403 Forbidden'
          hint = 'Add asset.view permission'
        } else if (String(status) === '401') {
          errorMsg = '401 Unauthorized'
          hint = 'Check API key'
        } else if (String(status) === '404') {
          errorMsg = '404 Not Found'
        } else if (err.message) {
          errorMsg = err.message.substring(0, 20)
        }

        console.error(`Failed to load image (${errorMsg}):`, error)

        // Show error with hint in the thumbnail
        const lines = hint
          ? `<text x="75" y="70" text-anchor="middle" fill="#c62828" font-family="Arial" font-size="11">${errorMsg}</text>
             <text x="75" y="90" text-anchor="middle" fill="#666" font-family="Arial" font-size="9">${hint}</text>`
          : `<text x="75" y="80" text-anchor="middle" fill="#c62828" font-family="Arial" font-size="11">${errorMsg}</text>`

        img.src = 'data:image/svg+xml;base64,' + btoa(`
          <svg width="150" height="150" xmlns="http://www.w3.org/2000/svg">
            <rect width="150" height="150" fill="#ffebee"/>
            ${lines}
          </svg>
        `)
      }
    }
    this.isLoading = false
  }

  destroy () {
    const images = this.containerEl.querySelectorAll('img')
    images.forEach(img => {
      if (img.src.startsWith('blob:')) {
        URL.revokeObjectURL(img.src)
      }
    })
  }
}
