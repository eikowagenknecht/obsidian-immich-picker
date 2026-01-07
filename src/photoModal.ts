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

export class ImmichPickerModal extends Modal {
  plugin: ImmichPicker
  gridView: GridView
  editor: Editor
  view: MarkdownView

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

    contentEl.createEl('h2', { text: 'Immich Photos' })
    const statusEl = contentEl.createEl('p', { text: 'Loading recent photos...' })

    try {
      const assets = await this.plugin.immichApi.getRecentPhotos(this.plugin.settings.recentPhotosCount)

      if (assets.length === 0) {
        statusEl.setText('No photos found.')
        return
      }

      statusEl.setText(`Showing ${assets.length} recent photo(s). Click to insert:`)

      this.gridView = new GridView({
        scrollEl: this.modalEl,
        plugin: this.plugin,
        onThumbnailClick: event => this.insertImageIntoEditor(event)
      })

      await this.gridView.appendThumbnailsToElement(
        this.gridView.containerEl,
        assets,
        event => this.insertImageIntoEditor(event)
      )

      contentEl.appendChild(this.gridView.containerEl)
    } catch (error) {
      console.error('Failed to load photos:', error)
      statusEl.setText('Error: ' + (error as Error).message)
      new Notice('Failed to load photos from Immich: ' + (error as Error).message)
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
