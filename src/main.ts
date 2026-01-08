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
      name: 'Insert image from Immich',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        if (!this.settings.serverUrl || !this.settings.apiKey) {
          new Notice('Please configure Immich server URL and API key in settings')
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
          const loadingNotice = new Notice('Downloading thumbnail from Immich...', 0)

          const noteFile = view.file
          if (!noteFile) {
            loadingNotice.hide()
            new Notice('No active note')
            return
          }

          const noteFolder = noteFile.path.split('/').slice(0, -1).join('/')
          const creationTime = moment()
          const filename = creationTime.format(this.settings.filename)

          const { thumbnailFolder, linkPath, savePath } = this.computeThumbnailPaths(noteFolder, filename)
          await this.ensureFolderExists(thumbnailFolder)
          await this.saveThumbnailToVault(assetId, savePath)

          const linkText = this.generateThumbnailMarkdown({
            linkPath,
            assetId,
            originalFilename: '',
            takenDate: creationTime.format(),
            description: ''
          })

          const cursorPosition = editor.getCursor()
          editor.replaceRange(linkText, cursorPosition)
          editor.setCursor({ line: cursorPosition.line, ch: cursorPosition.ch + linkText.length })

          loadingNotice.hide()
          new Notice('Image inserted from Immich')
        } catch (e) {
          console.error('Failed to process Immich URL:', e)
          new Notice('Failed to download from Immich: ' + (e as Error).message)
          // Fall back to pasting the original URL
          editor.replaceSelection(clipboardText)
        }
      })
    )
  }

  /**
   * Computes thumbnail folder and link paths based on settings
   */
  computeThumbnailPaths (noteFolder: string, filename: string): { thumbnailFolder: string, linkPath: string, savePath: string } {
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
    const savePath = thumbnailFolder ? thumbnailFolder + '/' + filename : filename

    return { thumbnailFolder, linkPath, savePath }
  }

  /**
   * Creates folder if it doesn't exist
   */
  async ensureFolderExists (folderPath: string): Promise<void> {
    if (folderPath && !await this.app.vault.adapter.exists(folderPath)) {
      await this.app.vault.createFolder(folderPath)
    }
  }

  /**
   * Downloads thumbnail from Immich and saves to vault
   */
  async saveThumbnailToVault (assetId: string, savePath: string): Promise<void> {
    const imageData = await this.immichApi.downloadThumbnail(assetId)
    await this.app.vault.adapter.writeBinary(savePath, imageData)
  }

  /**
   * Generates markdown text for inserted thumbnail
   */
  generateThumbnailMarkdown (params: {
    linkPath: string,
    assetId: string,
    originalFilename: string,
    takenDate: string,
    description: string
  }): string {
    return handlebarParse(this.settings.thumbnailMarkdown, {
      local_thumbnail_link: params.linkPath,
      immich_asset_id: params.assetId,
      immich_url: this.immichApi.getAssetUrl(params.assetId),
      original_filename: params.originalFilename,
      taken_date: params.takenDate,
      description: params.description
    })
  }

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
        const dateValue = frontMatter[this.settings.getDateFromFrontMatterKey] as string
        const date = moment(dateValue, this.settings.getDateFromFormat, true)
        return date.isValid() ? date : null
      }
    }

    return null
  }

  async loadSettings () {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<ImmichPickerSettings>)
  }

  async saveSettings () {
    await this.saveData(this.settings)
  }
}
