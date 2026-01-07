import {
  App,
  Editor,
  MarkdownView,
  Modal,
  Notice,
  Platform
} from 'obsidian'
import { GridView, ThumbnailImage } from './renderer'
import ImmichPicker from './main'
import { handlebarParse } from './handlebars'
import { ImmichAsset } from './immichApi'

export class ImmichPickerModal extends Modal {
  plugin: ImmichPicker
  gridView: GridView
  editor: Editor
  view: MarkdownView
  gridContainerEl: HTMLElement
  searchInput: HTMLInputElement
  footerEl: HTMLElement
  loadMoreEl: HTMLElement

  currentPage = 1
  currentMode: 'recent' | 'search' = 'recent'
  currentQuery = ''
  hasMoreResults = true

  constructor (app: App, plugin: ImmichPicker, editor: Editor, view: MarkdownView) {
    super(app)
    this.plugin = plugin
    this.editor = editor
    this.view = view
  }

  async onOpen () {
    const { contentEl, modalEl } = this

    if (Platform.isDesktop) {
      modalEl.addClass('immich-picker-modal')
    }

    this.setTitle('Immich Photos')

    // Search bar
    const searchContainer = contentEl.createDiv({ cls: 'immich-picker-search' })
    this.searchInput = searchContainer.createEl('input', {
      type: 'text',
      placeholder: 'Search...',
      cls: 'immich-picker-search-input'
    })
    const searchButton = searchContainer.createEl('button', {
      text: 'Search',
      cls: 'immich-picker-search-button'
    })

    this.gridContainerEl = contentEl.createDiv({ cls: 'immich-picker-grid-container' })

    // Footer with help text and load more
    this.footerEl = contentEl.createDiv({ cls: 'immich-picker-footer' })

    const footerRow1 = this.footerEl.createDiv({ cls: 'immich-picker-footer-row' })
    footerRow1.createSpan({ text: 'Click an image to insert it', cls: 'immich-picker-hint' })
    this.loadMoreEl = footerRow1.createEl('a', {
      text: `Load next ${this.plugin.settings.recentPhotosCount}`,
      cls: 'immich-picker-load-more',
      href: '#'
    })
    this.loadMoreEl.addEventListener('click', async e => {
      e.preventDefault()
      await this.loadMore()
    })
    this.loadMoreEl.style.display = 'none'

    // Show Immich link hint if paste conversion is enabled
    if (this.plugin.settings.convertPastedLink) {
      const footerRow2 = this.footerEl.createDiv({ cls: 'immich-picker-footer-row' })
      const hintSpan = footerRow2.createSpan({ cls: 'immich-picker-hint' })
      hintSpan.appendText('Or browse ')
      hintSpan.createEl('a', {
        text: 'your Immich',
        href: this.plugin.settings.serverUrl
      })
      hintSpan.appendText(' and paste any photo URL directly into your note')
    }

    // Search on Enter key
    this.searchInput.addEventListener('keydown', async e => {
      if (e.key === 'Enter') {
        e.preventDefault()
        await this.triggerSearch()
      }
    })

    // Search on button click (for mobile)
    searchButton.addEventListener('click', async () => {
      await this.triggerSearch()
    })

    // Load recent photos initially
    await this.loadRecentPhotos()

    // Focus search input
    this.searchInput.focus()
  }

  async loadRecentPhotos () {
    this.currentPage = 1
    this.currentMode = 'recent'
    this.currentQuery = ''
    this.hasMoreResults = true

    this.setTitle('Immich Photos - Loading...')
    try {
      const assets = await this.plugin.immichApi.getRecentPhotos(this.plugin.settings.recentPhotosCount, 1)
      await this.displayPhotos(assets, 'recent', undefined, false)
    } catch (error) {
      console.error('Failed to load photos:', error)
      this.setTitle('Immich Photos - Error')
      new Notice('Failed to load photos from Immich: ' + (error as Error).message)
    }
  }

  async triggerSearch () {
    const query = this.searchInput.value.trim()
    if (!query) {
      await this.loadRecentPhotos()
      return
    }

    this.currentPage = 1
    this.currentMode = 'search'
    this.currentQuery = query
    this.hasMoreResults = true

    this.setTitle('Immich Photos - Searching...')
    try {
      const assets = await this.plugin.immichApi.searchPhotos(query, this.plugin.settings.recentPhotosCount, 1)
      await this.displayPhotos(assets, 'search', query, false)
    } catch (error) {
      console.error('Failed to search photos:', error)
      this.setTitle('Immich Photos - Search error')
      new Notice('Search failed: ' + (error as Error).message)
    }
  }

  async displayPhotos (assets: ImmichAsset[], mode: 'recent' | 'search', query?: string, append = false) {
    // Check if we got fewer results than requested (no more pages)
    if (assets.length < this.plugin.settings.recentPhotosCount) {
      this.hasMoreResults = false
    }

    if (!append) {
      // Clear existing grid for new search/load
      this.gridContainerEl.empty()
      this.gridView?.destroy()
      this.gridView = new GridView({
        scrollEl: this.modalEl,
        plugin: this.plugin,
        onThumbnailClick: event => this.insertImageIntoEditor(event)
      })
      this.gridContainerEl.appendChild(this.gridView.containerEl)
    }

    if (assets.length === 0 && !append) {
      this.setTitle(mode === 'search' ? `Immich Photos - No results for "${query}"` : 'Immich Photos - No photos found')
      this.loadMoreEl.style.display = 'none'
      return
    }

    // Count total photos displayed
    const existingCount = this.gridView.containerEl.querySelectorAll('.immich-picker-thumbnail').length
    const totalCount = existingCount + assets.length

    const title = mode === 'search'
      ? `Immich Photos - "${query}" (${totalCount})`
      : `Immich Photos - ${totalCount} recent`
    this.setTitle(title)

    await this.gridView.appendThumbnailsToElement(
      this.gridView.containerEl,
      assets,
      event => this.insertImageIntoEditor(event)
    )

    // Show/hide load more link
    this.loadMoreEl.style.display = this.hasMoreResults ? 'inline' : 'none'
  }

  async loadMore () {
    this.currentPage++
    this.loadMoreEl.textContent = 'Loading...'

    try {
      let assets: ImmichAsset[]
      if (this.currentMode === 'search') {
        assets = await this.plugin.immichApi.searchPhotos(
          this.currentQuery,
          this.plugin.settings.recentPhotosCount,
          this.currentPage
        )
      } else {
        assets = await this.plugin.immichApi.getRecentPhotos(
          this.plugin.settings.recentPhotosCount,
          this.currentPage
        )
      }

      await this.displayPhotos(assets, this.currentMode, this.currentQuery, true)
      this.loadMoreEl.textContent = `Load next ${this.plugin.settings.recentPhotosCount}`
      this.gridContainerEl.scrollTo({ top: this.gridContainerEl.scrollHeight, behavior: 'smooth' })
    } catch (error) {
      console.error('Failed to load more photos:', error)
      new Notice('Failed to load more photos: ' + (error as Error).message)
      this.loadMoreEl.textContent = `Load next ${this.plugin.settings.recentPhotosCount}`
    }
  }

  async insertImageIntoEditor (event: MouseEvent) {
    try {
      await this.gridView.resetGrid()
      const thumbnailImage = event.target as ThumbnailImage

      const noteFile = this.view.file
      if (!noteFile) {
        new Notice('No active note')
        this.close()
        return
      }

      const noteFolder = noteFile.path.split('/').slice(0, -1).join('/')
      let thumbnailFolder = noteFolder
      let linkPath = thumbnailImage.filename

      switch (this.plugin.settings.locationOption) {
        case 'specified':
          thumbnailFolder = this.plugin.settings.locationFolder
          linkPath = thumbnailFolder + '/' + thumbnailImage.filename
          break
        case 'subfolder':
          thumbnailFolder = noteFolder + '/' + this.plugin.settings.locationSubfolder
          linkPath = this.plugin.settings.locationSubfolder + '/' + thumbnailImage.filename
          break
      }

      thumbnailFolder = thumbnailFolder.replace(/^\/+/, '').replace(/\/+$/, '')
      linkPath = encodeURI(linkPath)

      const vault = this.view.app.vault
      if (thumbnailFolder && !await vault.adapter.exists(thumbnailFolder)) {
        await vault.createFolder(thumbnailFolder)
      }

      // Download thumbnail from Immich
      const imageData = await this.plugin.immichApi.downloadThumbnail(thumbnailImage.assetId)

      const savePath = thumbnailFolder ? thumbnailFolder + '/' + thumbnailImage.filename : thumbnailImage.filename
      await vault.adapter.writeBinary(savePath, imageData)

      const cursorPosition = this.editor.getCursor()
      const linkText = handlebarParse(this.plugin.settings.thumbnailMarkdown, {
        local_thumbnail_link: linkPath,
        immich_asset_id: thumbnailImage.assetId,
        immich_url: thumbnailImage.immichUrl,
        original_filename: thumbnailImage.originalFilename,
        taken_date: thumbnailImage.creationTime.format()
      })

      this.editor.replaceRange(linkText, cursorPosition)
      this.editor.setCursor({ line: cursorPosition.line, ch: cursorPosition.ch + linkText.length })
    } catch (e) {
      console.error('Failed to insert image:', e)
      new Notice('Failed to download thumbnail: ' + (e as Error).message)
    }
    this.close()
  }

  onClose () {
    this.gridView?.destroy()
  }
}
