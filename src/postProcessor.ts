import { requestUrl } from 'obsidian'
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view'
import ImmichPicker from './main'

// Module-level cache: assetId -> blob URL
const blobCache = new Map<string, string>()
const pendingFetches = new Map<string, Promise<string>>()

export function clearImmichBlobCache (): void {
  for (const blobUrl of blobCache.values()) {
    URL.revokeObjectURL(blobUrl)
  }
  blobCache.clear()
  pendingFetches.clear()
}

export function registerImmichPostProcessor (plugin: ImmichPicker): void {
  // Code block processor: renders ```immich\nUUID\n``` as images
  plugin.registerMarkdownCodeBlockProcessor('immich', async (source, el) => {
    const lines = source.trim().split('\n')
    let assetId = ''
    let width = 0

    for (const line of lines) {
      const trimmed = line.trim()
      const widthMatch = trimmed.match(/^width=(\d+)$/i)
      if (widthMatch) {
        width = parseInt(widthMatch[1], 10)
        continue
      }
      if (trimmed.match(/^[a-f0-9-]+$/i)) {
        assetId = trimmed
      }
    }

    if (assetId) {
      renderImmichImage(plugin, el, assetId, width)
    }
  })

  // Post-processor: handles Reading View
  plugin.registerMarkdownPostProcessor(async (el: HTMLElement) => {
    const images = el.querySelectorAll('img')
    const serverUrl = plugin.settings.serverUrl

    for (const img of Array.from(images)) {
      if (img.hasClass('immich-remote-image')) continue

      const src = img.getAttribute('src') || ''
      const alt = img.getAttribute('alt') || ''

      if (serverUrl && src.includes(serverUrl) && src.includes('/api/assets/')) {
        const urlMatch = src.match(/\/api\/assets\/([a-f0-9-]+)\/thumbnail/i)
        if (urlMatch) {
          await replaceImgSrc(plugin, img, urlMatch[1])
          continue
        }
      }

      const dataId = img.getAttribute('data-immich-id')
      if (dataId && dataId.match(/^[a-f0-9-]+$/i)) {
        await replaceImgSrc(plugin, img, dataId)
        continue
      }

      const altMatch = alt.match(/^immich:([a-f0-9-]+)$/i)
      if (altMatch) {
        await replaceImgSrc(plugin, img, altMatch[1])
        continue
      }

      const srcMatch = src.match(/immich:\/\/([a-f0-9-]+)/i)
      if (srcMatch) {
        await replaceImgSrc(plugin, img, srcMatch[1])
      }
    }
  })

  // Live Preview: ViewPlugin that replaces img src with authenticated blob URLs
  // Obsidian's native renderer creates .image-embed — we just authenticate the image
  if (plugin.settings.renderInEditMode) {
    const livePreviewPlugin = ViewPlugin.fromClass(
      class {
        debounceTimer: number | null = null

        constructor (view: EditorView) {
          this.scheduleProcess(view)
        }

        processImages (view: EditorView) {
          const images = view.dom.querySelectorAll('.image-embed img:not(.immich-remote-image)')

          for (const img of Array.from(images)) {
            const src = img.getAttribute('src') || ''
            if (src.includes('/api/assets/') && src.includes('/thumbnail')) {
              const urlMatch = src.match(/\/api\/assets\/([a-f0-9-]+)\/thumbnail/i)
              if (urlMatch) {
                void replaceImgSrc(plugin, img as HTMLImageElement, urlMatch[1])
              }
            }
          }
        }

        scheduleProcess (view: EditorView) {
          if (this.debounceTimer) window.clearTimeout(this.debounceTimer)
          this.debounceTimer = window.setTimeout(() => {
            this.processImages(view)
          }, 200)
        }

        update (update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged || update.selectionSet) {
            this.scheduleProcess(update.view)
          }
        }

        destroy () {
          if (this.debounceTimer) window.clearTimeout(this.debounceTimer)
        }
      }
    )

    plugin.registerEditorExtension(livePreviewPlugin)
  }
}

// --- Helpers ---

async function replaceImgSrc (plugin: ImmichPicker, img: HTMLImageElement, assetId: string): Promise<void> {
  try {
    const blobUrl = await fetchOrGetCached(plugin, assetId)
    img.src = blobUrl
    img.alt = ''
    img.addClass('immich-remote-image')
  } catch (e) {
    console.error(`Failed to load Immich thumbnail for ${assetId}:`, e)
    img.alt = `[Immich image unavailable: ${assetId}]`
  }
}

function renderImmichImage (plugin: ImmichPicker, el: HTMLElement, assetId: string, width = 0): void {
  const container = el.createDiv({ cls: 'immich-remote-container' })
  const link = container.createEl('a', {
    href: plugin.immichApi.getAssetUrl(assetId),
    cls: 'external-link'
  })
  link.setAttr('target', '_blank')
  link.setAttr('rel', 'noopener')

  const img = link.createEl('img', { cls: 'immich-remote-image' })
  if (width > 0) img.width = width
  img.alt = 'Loading from Immich...'

  void fetchOrGetCached(plugin, assetId).then(blobUrl => {
    img.src = blobUrl
    img.alt = ''
  }).catch(e => {
    console.error(`Failed to load Immich thumbnail for ${assetId}:`, e)
    img.alt = `[Immich image unavailable: ${assetId}]`
  })
}

async function fetchOrGetCached (plugin: ImmichPicker, assetId: string): Promise<string> {
  if (blobCache.has(assetId)) {
    return blobCache.get(assetId)!
  }

  if (pendingFetches.has(assetId)) {
    return pendingFetches.get(assetId)!
  }

  const fetchPromise = (async () => {
    const url = plugin.immichApi.getThumbnailUrl(assetId)
    const apiKey = await plugin.getApiKey()
    const response = await requestUrl({
      url,
      headers: { 'x-api-key': apiKey }
    })
    const blob = new Blob([response.arrayBuffer], { type: 'image/jpeg' })
    const blobUrl = URL.createObjectURL(blob)
    blobCache.set(assetId, blobUrl)
    pendingFetches.delete(assetId)
    return blobUrl
  })()

  pendingFetches.set(assetId, fetchPromise)
  return fetchPromise
}
