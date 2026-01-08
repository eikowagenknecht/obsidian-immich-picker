import { Editor, MarkdownView, moment, Notice, Plugin, TFile } from 'obsidian'
import { ImmichApi } from './immichApi'
import { ImmichPickerSettingTab, ImmichPickerSettings, DEFAULT_SETTINGS } from './settings'
import { ImmichPickerModal } from './photoModal'
import { handlebarParse } from './handlebars'

export default class ImmichPicker extends Plugin {
  settings: ImmichPickerSettings
  immichApi: ImmichApi

  async onload () {
    await this.loadSettings()

    this.immichApi = new ImmichApi(this)

    this.addSettingTab(new ImmichPickerSettingTab(this.app, this))

    this.addCommand({
      id: 'insert-immich-photo',
      name: 'Insert image from immich',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        if (!this.settings.serverUrl || !this.settings.apiKey) {
          new Notice('Please configure immich server URL and API key in settings')
          return
        }
        new ImmichPickerModal(this.app, this, editor, view).open()
      }
    })

    // Register paste handler for Immich URL conversion
    this.registerEvent(
      this.app.workspace.on('editor-paste', async (evt: ClipboardEvent, editor: Editor, view: MarkdownView) => {
        if (!this.settings.convertPastedLink) return
        if (!this.settings.serverUrl || !this.settings.apiKey) return

        const clipboardText = evt.clipboardData?.getData('text/plain')
        if (!clipboardText) return

        const assetId = this.immichApi.extractAssetIdFromUrl(clipboardText)
        if (!assetId) return

        // Prevent default paste
        evt.preventDefault()

        try {
          // Show loading notice
          const loadingNotice = new Notice('Downloading thumbnail from immich...', 0)

          const noteFile = view.file
          if (!noteFile) {
            loadingNotice.hide()
            new Notice('No active note')
            return
          }

          const noteFolder = noteFile.path.split('/').slice(0, -1).join('/')
          const creationTime = moment()
          const filename = creationTime.format(this.settings.filename)

          let thumbnailFolder = noteFolder
          let linkPath = filename

          switch (this.settings.locationOption) {
            case 'specified':
              thumbnailFolder = this.settings.locationFolder
              linkPath = thumbnailFolder + '/' + filename
              break
            case 'subfolder':
              thumbnailFolder = noteFolder + '/' + this.settings.locationSubfolder
              linkPath = this.settings.locationSubfolder + '/' + filename
              break
          }

          thumbnailFolder = thumbnailFolder.replace(/^\/+/, '').replace(/\/+$/, '')
          linkPath = encodeURI(linkPath)

          const vault = this.app.vault
          if (thumbnailFolder && !await vault.adapter.exists(thumbnailFolder)) {
            await vault.createFolder(thumbnailFolder)
          }

          // Download thumbnail
          const imageData = await this.immichApi.downloadThumbnail(assetId)

          const savePath = thumbnailFolder ? thumbnailFolder + '/' + filename : filename
          await vault.adapter.writeBinary(savePath, imageData)

          const linkText = handlebarParse(this.settings.thumbnailMarkdown, {
            local_thumbnail_link: linkPath,
            immich_asset_id: assetId,
            immich_url: this.immichApi.getAssetUrl(assetId),
            original_filename: '',
            taken_date: creationTime.format(),
            description: ''
          })

          const cursorPosition = editor.getCursor()
          editor.replaceRange(linkText, cursorPosition)
          editor.setCursor({ line: cursorPosition.line, ch: cursorPosition.ch + linkText.length })

          loadingNotice.hide()
          new Notice('Image inserted from immich')
        } catch (e) {
          console.error('Failed to process Immich URL:', e)
          new Notice('Failed to download from immich: ' + (e as Error).message)
          // Fall back to pasting the original URL
          editor.replaceSelection(clipboardText)
        }
      })
    )
  }

  /**
   * Gets the date from the note title or frontmatter based on user settings
   */
  getNoteDate (file: TFile): moment.Moment | null {
    if (this.settings.getDateFrom === 'none') {
      return null
    }

    if (this.settings.getDateFrom === 'title') {
      const date = moment(file.basename, this.settings.getDateFromFormat, true)
      return date.isValid() ? date : null
    }

    if (this.settings.getDateFrom === 'frontmatter') {
      const meta = this.app.metadataCache.getFileCache(file)
      const frontMatter = meta?.frontmatter
      if (frontMatter && frontMatter[this.settings.getDateFromFrontMatterKey]) {
        const date = moment(frontMatter[this.settings.getDateFromFrontMatterKey], this.settings.getDateFromFormat, true)
        return date.isValid() ? date : null
      }
    }

    return null
  }

  async loadSettings () {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
  }

  async saveSettings () {
    await this.saveData(this.settings)
  }
}
