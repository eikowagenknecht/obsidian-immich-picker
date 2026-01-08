import {
  App,
  Editor,
  MarkdownView,
  Modal,
  moment,
  Notice,
  Platform,
  requestUrl
} from 'obsidian'
import { GridView, ThumbnailImage } from './renderer'
import ImmichPicker from './main'
import { ImmichAlbum, ImmichAsset } from './immichApi'
import { createLoadingSvg, createEmptySvg } from './svgPlaceholders'

export class ImmichPickerModal extends Modal {
  plugin: ImmichPicker
  gridView: GridView
  editor: Editor
  view: MarkdownView
  gridContainerEl: HTMLElement
  searchContainer: HTMLElement
  searchInput: HTMLInputElement
  albumsButton: HTMLButtonElement
  dateBanner: HTMLElement
  footerEl: HTMLElement
  footerRow1: HTMLElement
  hintEl: HTMLElement
  loadMoreEl: HTMLElement
  insertAllEl: HTMLElement
  backButton: HTMLElement

  currentPage = 1
  currentMode: 'recent' | 'search' | 'albums' | 'album' | 'date' = 'recent'
  currentQuery = ''
  currentAlbum: ImmichAlbum | null = null
  currentAlbumAssets: ImmichAsset[] = []
  hasMoreResults = true
  noteDate: moment.Moment | null = null

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

    this.setTitle('Immich photos')

    // Back button (top of content)
    this.backButton = contentEl.createEl('a', {
      text: '← back to albums',
      cls: 'immich-picker-back',
      href: '#'
    })
    this.backButton.hide()
    this.backButton.addEventListener('click', e => {
      e.preventDefault()
      if (this.currentMode === 'album') {
        void this.loadAlbums()
      } else if (this.currentMode === 'albums' || this.currentMode === 'date') {
        this.searchContainer.show()
        this.backButton.hide()
        this.hintEl.setText('Click an image to insert it')
        // Show date banner again if we have a note date
        if (this.noteDate) {
          this.dateBanner.show()
        }
        void this.loadRecentPhotos()
      }
    })

    // Search bar
    this.searchContainer = contentEl.createDiv({ cls: 'immich-picker-search' })
    this.searchInput = this.searchContainer.createEl('input', {
      type: 'text',
      placeholder: 'Search...',
      cls: 'immich-picker-search-input'
    })
    const searchButton = this.searchContainer.createEl('button', {
      text: 'Search',
      cls: 'immich-picker-search-button'
    })
    this.albumsButton = this.searchContainer.createEl('button', {
      text: 'Albums',
      cls: 'immich-picker-albums-button'
    })

    // Date banner (will be shown if note date is detected)
    this.dateBanner = contentEl.createDiv({ cls: 'immich-picker-date-banner' })
    this.dateBanner.hide()

    this.gridContainerEl = contentEl.createDiv({ cls: 'immich-picker-grid-container' })

    // footer with help text and load more
    this.footerEl = contentEl.createDiv({ cls: 'immich-picker-footer' })

    this.footerRow1 = this.footerEl.createDiv({ cls: 'immich-picker-footer-row' })
    this.hintEl = this.footerRow1.createSpan({ text: 'Click an image to insert it', cls: 'immich-picker-hint' })

    this.insertAllEl = this.footerRow1.createEl('a', {
      text: 'Insert all',
      cls: 'immich-picker-insert-all',
      href: '#'
    })
    this.insertAllEl.hide()
    this.insertAllEl.addEventListener('click', e => {
      e.preventDefault()
      void this.insertAllAlbumPhotos()
    })

    this.loadMoreEl = this.footerRow1.createEl('a', {
      text: `Load next ${this.plugin.settings.recentPhotosCount}`,
      cls: 'immich-picker-load-more',
      href: '#'
    })
    this.loadMoreEl.addEventListener('click', e => {
      e.preventDefault()
      if (this.currentMode === 'album') {
        // Album mode: show all remaining photos
        this.loadMoreEl.hide()
        void this.gridView.appendThumbnailsToElement(
          this.gridView.containerEl,
          this.currentAlbumAssets.slice(this.plugin.settings.recentPhotosCount),
          event => { void this.insertImageIntoEditor(event) }
        )
      } else {
        // Regular mode: load next page
        void this.loadMore()
      }
    })
    this.loadMoreEl.hide()

    // Show Immich link hint if paste conversion is enabled
    if (this.plugin.settings.convertPastedLink) {
      const footerRow2 = this.footerEl.createDiv({ cls: 'immich-picker-footer-row' })
      const hintSpan = footerRow2.createSpan({ cls: 'immich-picker-hint' })
      hintSpan.appendText('Or browse ')
      hintSpan.createEl('a', {
        text: 'Your immich',
        href: this.plugin.settings.serverUrl
      })
      hintSpan.appendText(' and paste any photo URL directly into your note')
    }

    // Search on Enter key
    this.searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void this.triggerSearch()
      }
    })

    // Search on button click (for mobile)
    searchButton.addEventListener('click', () => {
      void this.triggerSearch()
    })

    // Albums button click
    this.albumsButton.addEventListener('click', () => {
      void this.loadAlbums()
    })

    // Check if albums are accessible and show/hide button
    this.albumsButton.hide()
    void this.checkAlbumsAccess()

    // Check for note date and show date banner if found
    const noteFile = this.view.file
    if (noteFile) {
      this.noteDate = this.plugin.getNoteDate(noteFile)
      if (this.noteDate) {
        const formattedDate = this.noteDate.format('MMMM D, YYYY')
        this.dateBanner.setText(`📅 Show photos from ${formattedDate}?`)
        this.dateBanner.show()
        this.dateBanner.addEventListener('click', () => {
          void this.loadPhotosByDate()
        })
      }
    }

    // Load recent photos initially
    void this.loadRecentPhotos()

    // Focus search input
    this.searchInput.focus()
  }

  async checkAlbumsAccess () {
    try {
      await this.plugin.immichApi.getAlbums()
      this.albumsButton.show()
    } catch {
      // Albums not accessible, keep button hidden
    }
  }

  showLoading () {
    this.gridView?.destroy()
    this.gridContainerEl.empty()
    this.gridContainerEl.createDiv({ cls: 'immich-picker-loading', text: 'Loading photos...' })
    this.loadMoreEl.hide()
  }

  async loadRecentPhotos () {
    this.currentPage = 1
    this.currentMode = 'recent'
    this.currentQuery = ''
    this.hasMoreResults = true

    this.setTitle('Immich photos - loading...')
    this.showLoading()
    try {
      const assets = await this.plugin.immichApi.getRecentPhotos(this.plugin.settings.recentPhotosCount, 1)
      await this.displayPhotos(assets, 'recent', undefined, false)
    } catch (error) {
      console.error('Failed to load photos:', error)
      this.setTitle('Immich photos - error')
      new Notice('Failed to load photos from immich: ' + (error as Error).message)
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

    this.setTitle('Immich photos - searching...')
    this.showLoading()
    try {
      const assets = await this.plugin.immichApi.searchPhotos(query, this.plugin.settings.recentPhotosCount, 1)
      await this.displayPhotos(assets, 'search', query, false)
    } catch (error) {
      console.error('Failed to search photos:', error)
      this.setTitle('Immich photos - search error')
      new Notice('Search failed: ' + (error as Error).message)
    }
  }

  async displayPhotos (assets: ImmichAsset[], mode: 'recent' | 'search' | 'albums' | 'album' | 'date', query?: string, append = false) {
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
        onThumbnailClick: event => { void this.insertImageIntoEditor(event) }
      })
      this.gridContainerEl.appendChild(this.gridView.containerEl)
    }

    if (assets.length === 0 && !append) {
      this.setTitle(mode === 'search' ? `Immich photos - No results for "${query}"` : 'Immich photos - No photos found')
      this.loadMoreEl.hide()
      return
    }

    // Count total photos displayed
    const existingCount = this.gridView.containerEl.querySelectorAll('.immich-picker-thumbnail').length
    const totalCount = existingCount + assets.length

    let title: string
    if (mode === 'search') {
      title = `Immich photos - "${query}" (${totalCount})`
    } else if (mode === 'date') {
      title = `Immich photos - ${query} (${totalCount})`
    } else {
      title = `Immich photos - ${totalCount} recent`
    }
    this.setTitle(title)

    await this.gridView.appendThumbnailsToElement(
      this.gridView.containerEl,
      assets,
      event => { void this.insertImageIntoEditor(event) }
    )

    // Show/hide load more link
    this.loadMoreEl.toggle(this.hasMoreResults)
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
      } else if (this.currentMode === 'date' && this.noteDate) {
        assets = await this.plugin.immichApi.getPhotosByDate(
          this.noteDate,
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

  async loadPhotosByDate () {
    if (!this.noteDate) return

    this.currentPage = 1
    this.currentMode = 'date'
    this.currentQuery = ''
    this.hasMoreResults = true

    // Hide search bar and date banner, show back button
    this.searchContainer.hide()
    this.dateBanner.hide()
    this.backButton.show()
    this.backButton.textContent = '← back to recent'

    const dateStr = this.noteDate.format('YYYY-MM-DD')
    this.setTitle(`Immich photos - loading ${dateStr}...`)
    this.showLoading()

    try {
      const assets = await this.plugin.immichApi.getPhotosByDate(
        this.noteDate,
        this.plugin.settings.recentPhotosCount,
        1
      )
      await this.displayPhotos(assets, 'date', dateStr, false)
    } catch (error) {
      console.error('Failed to load photos by date:', error)
      this.setTitle(`Immich photos - error loading ${dateStr}`)
      new Notice('Failed to load photos: ' + (error as Error).message)
    }
  }

  async loadAlbums () {
    this.currentMode = 'albums'
    this.currentAlbum = null
    this.setTitle('Immich albums - loading...')
    this.searchContainer.hide()
    this.dateBanner.hide()
    this.loadMoreEl.hide()
    this.insertAllEl.hide()
    this.backButton.show()
    this.backButton.textContent = '← back to photos'
    this.hintEl.setText('Click an album to browse its photos')

    try {
      const albums = await this.plugin.immichApi.getAlbums()
      await this.displayAlbums(albums)
    } catch (error) {
      console.error('Failed to load albums:', error)
      this.setTitle('Immich albums - error')
      new Notice('Failed to load albums: ' + (error as Error).message)
    }
  }

  async displayAlbums (albums: ImmichAlbum[]) {
    this.gridContainerEl.empty()
    this.gridView?.destroy()

    if (albums.length === 0) {
      this.setTitle('Immich albums - no albums found')
      return
    }

    // Sort by most recently updated
    albums.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

    this.setTitle(`Immich albums - ${albums.length} albums`)

    const grid = this.gridContainerEl.createDiv({ cls: 'immich-picker-grid' })
    grid.style.gridTemplateColumns = `repeat(${this.plugin.settings.gridColumns}, 1fr)`

    for (const album of albums) {
      const albumEl = grid.createDiv({ cls: 'immich-picker-album' })

      // Album thumbnail
      if (album.albumThumbnailAssetId) {
        const img = albumEl.createEl('img', { cls: 'immich-picker-album-thumb' })
        img.src = createLoadingSvg()
        // Load thumbnail asynchronously
        void this.loadAlbumThumbnail(img, album.albumThumbnailAssetId)
      } else {
        albumEl.createDiv({ cls: 'immich-picker-album-placeholder' })
      }

      // Album name and count
      albumEl.createDiv({ cls: 'immich-picker-album-name', text: album.albumName })
      albumEl.createDiv({ cls: 'immich-picker-album-count', text: `${album.assetCount} photos` })

      albumEl.addEventListener('click', () => {
        void this.loadAlbumPhotos(album)
      })
    }
  }

  async loadAlbumThumbnail (img: HTMLImageElement, assetId: string) {
    try {
      const thumbnailUrl = this.plugin.immichApi.getThumbnailUrl(assetId)
      const response = await requestUrl({
        url: thumbnailUrl,
        headers: { 'x-api-key': this.plugin.settings.apiKey }
      })
      const blob = new Blob([response.arrayBuffer])
      img.src = URL.createObjectURL(blob)
    } catch {
      img.src = createEmptySvg()
    }
  }

  async loadAlbumPhotos (album: ImmichAlbum) {
    this.currentMode = 'album'
    this.currentAlbum = album
    this.setTitle(`${album.albumName} - loading...`)
    this.backButton.show()
    this.backButton.textContent = '← back to albums'
    this.insertAllEl.hide()
    this.hintEl.setText('Click an image to insert it')
    this.showLoading()

    try {
      const assets = await this.plugin.immichApi.getAlbumAssets(album.id)
      this.currentAlbumAssets = assets

      // Show first N photos
      const displayAssets = assets.slice(0, this.plugin.settings.recentPhotosCount)
      await this.displayAlbumPhotos(displayAssets, album, assets.length)
    } catch (error) {
      console.error('Failed to load album photos:', error)
      this.setTitle(`${album.albumName} - error`)
      new Notice('Failed to load album photos: ' + (error as Error).message)
    }
  }

  async displayAlbumPhotos (assets: ImmichAsset[], album: ImmichAlbum, totalCount: number) {
    this.gridContainerEl.empty()
    this.gridView?.destroy()

    if (assets.length === 0) {
      this.setTitle(`${album.albumName} - Empty album`)
      this.insertAllEl.hide()
      return
    }

    this.setTitle(`${album.albumName} - ${totalCount} photos`)
    this.insertAllEl.show()
    this.insertAllEl.textContent = `Insert all ${totalCount}`

    this.gridView = new GridView({
      scrollEl: this.modalEl,
      plugin: this.plugin,
      onThumbnailClick: event => { void this.insertImageIntoEditor(event) }
    })

    await this.gridView.appendThumbnailsToElement(
      this.gridView.containerEl,
      assets,
      event => { void this.insertImageIntoEditor(event) }
    )

    this.gridContainerEl.appendChild(this.gridView.containerEl)

    // Show load more if there are more photos
    if (assets.length < totalCount) {
      this.loadMoreEl.show()
      this.loadMoreEl.textContent = `Show all ${totalCount}`
    }
  }

  async insertAllAlbumPhotos () {
    if (!this.currentAlbum || this.currentAlbumAssets.length === 0) {
      new Notice('No album selected or album is empty')
      return
    }

    const noteFile = this.view.file
    if (!noteFile) {
      new Notice('No active note')
      this.close()
      return
    }

    const loadingNotice = new Notice(`Inserting ${this.currentAlbumAssets.length} photos...`, 0)

    try {
      const noteFolder = noteFile.path.split('/').slice(0, -1).join('/')
      // Ensure folder exists once before the loop
      const firstAsset = this.currentAlbumAssets[0]
      const firstFilename = window.moment(firstAsset.fileCreatedAt).format(this.plugin.settings.filename)
      const { thumbnailFolder } = this.plugin.computeThumbnailPaths(noteFolder, firstFilename)
      await this.plugin.ensureFolderExists(thumbnailFolder)

      let insertedText = ''

      for (let i = 0; i < this.currentAlbumAssets.length; i++) {
        const asset = this.currentAlbumAssets[i]
        loadingNotice.setMessage(`Inserting photo ${i + 1}/${this.currentAlbumAssets.length}...`)

        const creationTime = window.moment(asset.fileCreatedAt)
        const filename = creationTime.format(this.plugin.settings.filename)
        const { linkPath, savePath } = this.plugin.computeThumbnailPaths(noteFolder, filename)

        await this.plugin.saveThumbnailToVault(asset.id, savePath)

        // Get description
        const assetDetails = await this.plugin.immichApi.getAssetDetails(asset.id)
        const description = assetDetails.exifInfo?.description || ''

        const linkText = this.plugin.generateThumbnailMarkdown({
          linkPath,
          assetId: asset.id,
          originalFilename: asset.originalFileName,
          takenDate: creationTime.format(),
          description
        })

        insertedText += linkText
      }

      const cursorPosition = this.editor.getCursor()
      this.editor.replaceRange(insertedText, cursorPosition)
      this.editor.setCursor({ line: cursorPosition.line, ch: cursorPosition.ch + insertedText.length })

      loadingNotice.hide()
      new Notice(`Inserted ${this.currentAlbumAssets.length} photos from "${this.currentAlbum.albumName}"`)
    } catch (e) {
      loadingNotice.hide()
      console.error('Failed to insert album photos:', e)
      new Notice('Failed to insert album photos: ' + (e as Error).message)
    }

    this.close()
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
      const { thumbnailFolder, linkPath, savePath } = this.plugin.computeThumbnailPaths(noteFolder, thumbnailImage.filename)
      await this.plugin.ensureFolderExists(thumbnailFolder)
      await this.plugin.saveThumbnailToVault(thumbnailImage.assetId, savePath)

      // Fetch asset details to get description
      const assetDetails = await this.plugin.immichApi.getAssetDetails(thumbnailImage.assetId)
      const description = assetDetails.exifInfo?.description || ''

      const linkText = this.plugin.generateThumbnailMarkdown({
        linkPath,
        assetId: thumbnailImage.assetId,
        originalFilename: thumbnailImage.originalFilename,
        takenDate: thumbnailImage.creationTime.format(),
        description
      })

      const cursorPosition = this.editor.getCursor()
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
