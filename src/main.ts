import { Editor, MarkdownView, moment, Notice, Plugin, TFile } from 'obsidian'
import { ImmichApi } from './immichApi'
import { ImmichPickerSettingTab, ImmichPickerSettings, DEFAULT_SETTINGS, RemoteFormatOption } from './settings'
import { ImmichPickerModal } from './photoModal'
import { handlebarParse } from './handlebars'
import { registerImmichPostProcessor, clearImmichBlobCache } from './postProcessor'
import { ConversionModal } from './conversionModal'

// No placeholder needed — remote mode uses code block syntax rendered by code block processor

/** One Immich image reference found in note content, located by source range. */
export interface ImmichReference {
  /** Offset of the first character of the reference. */
  start: number;
  /** Offset just past the last character of the reference. */
  end: number;
  /** The matched source text. */
  text: string;
  assetId: string;
}

/**
 * Applies replacements to `content` by source range.
 * Splices back to front so earlier ranges keep their offsets, and so two
 * identical references (the same image embedded twice) are rewritten
 * independently rather than collapsing onto the first occurrence.
 *
 * A range whose text no longer matches what was found there is skipped: the
 * note has been edited since it was scanned, and the offsets can no longer be
 * trusted. `applied` reports how many actually landed.
 */
export function applyReplacements (
  content: string,
  edits: { ref: ImmichReference, replacement: string }[]
): { text: string, applied: number } {
  let text = content
  let applied = 0
  for (const { ref, replacement } of [...edits].sort((a, b) => b.ref.start - a.ref.start)) {
    if (text.slice(ref.start, ref.end) !== ref.text) continue
    text = text.slice(0, ref.start) + replacement + text.slice(ref.end)
    applied++
  }
  return { text, applied }
}

// Helper to access SecretStorage (available in Obsidian 1.11.0+)
function getSecretStorage (app: Record<string, unknown>): { getSecret(id: string): string | null, setSecret(id: string, secret: string): void } | null {
  const storage = (app as Record<string, unknown>).secretStorage
  if (storage && typeof storage === 'object' && 'getSecret' in storage && 'setSecret' in storage) {
    return storage as { getSecret(id: string): string | null, setSecret(id: string, secret: string): void }
  }
  return null
}

export default class ImmichPicker extends Plugin {
  settings: ImmichPickerSettings
  immichApi: ImmichApi
  cachedApiKey = ''

  async onload () {
    await this.loadSettings()

    this.immichApi = new ImmichApi(this)

    // Cache API key (migrate from data.json to secretStorage if available)
    await this.initApiKey()

    this.addSettingTab(new ImmichPickerSettingTab(this.app, this))

    // Always register post-processor so remote images render in any mode
    registerImmichPostProcessor(this)

    // Ribbon icon — accessible from hamburger menu on mobile
    this.addRibbonIcon('image-plus', 'Insert image from Immich', () => {
      if (!this.settings.serverUrl || !this.cachedApiKey) {
        new Notice('Please configure Immich server URL and API key in settings')
        return
      }
      const view = this.app.workspace.getActiveViewOfType(MarkdownView)
      if (!view) {
        new Notice('Open a note first')
        return
      }
      new ImmichPickerModal(this.app, this, view.editor, view).open()
    })

    this.addCommand({
      id: 'insert-immich-photo',
      name: 'Insert image from Immich',
      icon: 'image-plus',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        if (!this.settings.serverUrl || !this.cachedApiKey) {
          new Notice('Please configure Immich server URL and API key in settings')
          return
        }
        new ImmichPickerModal(this.app, this, editor, view).open()
      }
    })

    this.addCommand({
      id: 'convert-immich-images',
      name: 'Convert Immich images',
      icon: 'arrow-right-left',
      callback: () => {
        if (!this.settings.serverUrl) {
          new Notice('Please configure Immich server URL in settings')
          return
        }
        new ConversionModal(this.app, this).open()
      }
    })

    // Register paste handler for Immich URL conversion
    this.registerEvent(
      this.app.workspace.on('editor-paste', async (evt: ClipboardEvent, editor: Editor, view: MarkdownView) => {
        if (!this.settings.convertPastedLink) return
        if (!this.settings.serverUrl || !this.cachedApiKey) return

        const clipboardText = evt.clipboardData?.getData('text/plain')
        if (!clipboardText) return

        const assetId = this.immichApi.extractAssetIdFromUrl(clipboardText)
        if (!assetId) return

        // Prevent default paste
        evt.preventDefault()

        try {
          const loadingNotice = new Notice('Processing Immich link...', 0)

          const noteFile = view.file
          if (!noteFile) {
            loadingNotice.hide()
            new Notice('No active note')
            return
          }

          let linkText: string

          if (this.settings.imageMode === 'remote') {
            linkText = this.generateRemoteMarkdown({ assetId })
          } else if (this.settings.imageMode === 'shared') {
            linkText = await this.generateSharedMarkdown({
              assetId,
              originalFilename: '',
              takenDate: moment().format(),
              description: ''
            })
          } else {
            const noteFolder = noteFile.path.split('/').slice(0, -1).join('/')
            const creationTime = moment()
            const filename = creationTime.format(this.settings.filename)

            const { thumbnailFolder, linkPath, savePath } = await this.computeFreeThumbnailPaths(noteFolder, filename)
            await this.ensureFolderExists(thumbnailFolder)
            await this.saveThumbnailToVault(assetId, savePath)

            linkText = this.generateThumbnailMarkdown({
              linkPath,
              assetId,
              originalFilename: '',
              takenDate: creationTime.format(),
              description: ''
            })
          }

          const cursorPosition = editor.getCursor()
          editor.replaceRange(linkText, cursorPosition)
          editor.setCursor({ line: cursorPosition.line, ch: cursorPosition.ch + linkText.length })

          loadingNotice.hide()
          new Notice('Image inserted from Immich')
        } catch (e) {
          console.error('Failed to process Immich URL:', e)
          new Notice('Failed to process Immich URL: ' + (e as Error).message)
          // Fall back to pasting the original URL
          editor.replaceSelection(clipboardText)
        }
      })
    )
  }

  onunload () {
    clearImmichBlobCache()
  }

  // --- SecretStorage ---

  hasSecretStorage (): boolean {
    return getSecretStorage(this.app as unknown as Record<string, unknown>) != null
  }

  async getApiKey (): Promise<string> {
    if (this.cachedApiKey) return this.cachedApiKey

    const storage = getSecretStorage(this.app as unknown as Record<string, unknown>)
    if (storage) {
      try {
        const secret = storage.getSecret('immich-api-key')
        if (secret) {
          this.cachedApiKey = secret
          return secret
        }
      } catch {
        // Fall through to settings
      }
    }

    this.cachedApiKey = this.settings.apiKey
    return this.cachedApiKey
  }

  async setApiKey (apiKey: string): Promise<void> {
    this.cachedApiKey = apiKey

    const storage = getSecretStorage(this.app as unknown as Record<string, unknown>)
    if (storage) {
      try {
        storage.setSecret('immich-api-key', apiKey)
        // Clear from plain-text settings
        this.settings.apiKey = ''
        await this.saveSettings()
        return
      } catch {
        // Fall through to settings
      }
    }

    this.settings.apiKey = apiKey
    await this.saveSettings()
  }

  private async initApiKey (): Promise<void> {
    // Migrate from data.json to secretStorage if available
    const storage = getSecretStorage(this.app as unknown as Record<string, unknown>)
    if (storage && this.settings.apiKey) {
      try {
        storage.setSecret('immich-api-key', this.settings.apiKey)
        this.cachedApiKey = this.settings.apiKey
        this.settings.apiKey = ''
        await this.saveSettings()
        return
      } catch {
        // Fall through
      }
    }

    await this.getApiKey()
  }

  // --- Path computation ---

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
   * Like computeThumbnailPaths, but guarantees the filename is free.
   * Appends -1, -2, ... before the extension until the save path collides with
   * neither an existing file nor a name already handed out via `reserved`.
   * Needed for batch operations, where every image can otherwise format to the
   * same filename and silently overwrite the previous one.
   */
  async computeFreeThumbnailPaths (noteFolder: string, filename: string, reserved?: Set<string>): Promise<{ thumbnailFolder: string, linkPath: string, savePath: string }> {
    const dot = filename.lastIndexOf('.')
    const stem = dot > 0 ? filename.slice(0, dot) : filename
    const ext = dot > 0 ? filename.slice(dot) : ''

    let candidate = filename
    for (let n = 1; ; n++) {
      const paths = this.computeThumbnailPaths(noteFolder, candidate)
      const clashes = reserved?.has(paths.savePath) || await this.app.vault.adapter.exists(paths.savePath)
      if (!clashes) {
        reserved?.add(paths.savePath)
        return paths
      }
      candidate = `${stem}-${n}${ext}`
    }
  }

  async ensureFolderExists (folderPath: string): Promise<void> {
    if (folderPath && !await this.app.vault.adapter.exists(folderPath)) {
      await this.app.vault.createFolder(folderPath)
    }
  }

  async saveThumbnailToVault (assetId: string, savePath: string): Promise<void> {
    const imageData = await this.immichApi.downloadThumbnail(assetId)
    await this.app.vault.adapter.writeBinary(savePath, imageData)
  }

  // --- Markdown generation ---

  /**
   * Computes display dimensions using "fit long edge" logic.
   * Returns `|WxH` if dimensions known, `|W` if only max size set, or empty string.
   */
  /**
   * Returns the width alt text for image sizing.
   * Uses width-only format (e.g. |400) so Obsidian preserves aspect ratio.
   * If original dimensions are known and the image is already smaller than
   * maxSize, returns empty (no resize needed).
   */
  getWidthAlt (origWidth?: number, origHeight?: number): string {
    const maxSize = this.settings.displayWidth
    if (maxSize <= 0) return ''

    // If we know the dimensions, skip sizing if image is already small enough
    if (origWidth && origHeight) {
      const longEdge = Math.max(origWidth, origHeight)
      if (longEdge <= maxSize) return ''
    }

    // Width-only — Obsidian handles aspect ratio automatically
    return `|${maxSize}`
  }

  generateThumbnailMarkdown (params: {
    linkPath: string,
    assetId: string,
    originalFilename: string,
    takenDate: string,
    description: string,
    origWidth?: number,
    origHeight?: number
  }): string {
    return handlebarParse(this.settings.thumbnailMarkdown, {
      local_thumbnail_link: params.linkPath,
      immich_thumbnail_url: this.immichApi.getThumbnailUrl(params.assetId),
      immich_asset_id: params.assetId,
      immich_url: this.immichApi.getAssetUrl(params.assetId),
      original_filename: params.originalFilename,
      taken_date: params.takenDate,
      description: params.description,
      display_width: this.getWidthAlt(params.origWidth, params.origHeight)
    })
  }

  /**
   * Remote mode: generates markdown based on the selected remote format.
   * `format` overrides the configured one, so bulk conversion can target a
   * format the user is not currently inserting in.
   */
  generateRemoteMarkdown (params: {
    assetId: string,
    origWidth?: number,
    origHeight?: number,
    format?: RemoteFormatOption
  }): string {
    const format = params.format || this.settings.remoteFormat || 'server-url'
    const widthAlt = this.getWidthAlt(params.origWidth, params.origHeight)

    if (format === 'code-block') {
      // Same sizing decision as the alt text, so a code block and a server
      // link produced from one photo agree on whether to resize at all.
      const widthLine = widthAlt ? `\nwidth=${widthAlt.slice(1)}` : ''
      return '\n```immich\n' + params.assetId + widthLine + '\n```\n'
    }
    return `![${widthAlt}](${this.immichApi.getThumbnailUrl(params.assetId)}) `
  }

  async generateSharedMarkdown (params: {
    assetId: string,
    originalFilename: string,
    takenDate: string,
    description: string,
    origWidth?: number,
    origHeight?: number
  }): Promise<string> {
    const sharedLink = await this.immichApi.createSharedLink(params.assetId)
    const sharedThumbnailUrl = this.immichApi.getSharedThumbnailUrl(params.assetId, sharedLink.key)

    return handlebarParse(this.settings.thumbnailMarkdown, {
      local_thumbnail_link: sharedThumbnailUrl,
      immich_thumbnail_url: sharedThumbnailUrl,
      immich_asset_id: params.assetId,
      immich_url: this.immichApi.getAssetUrl(params.assetId),
      original_filename: params.originalFilename,
      taken_date: params.takenDate,
      description: params.description,
      display_width: this.getWidthAlt(params.origWidth, params.origHeight)
    })
  }

  // --- Finding existing references ---

  /**
   * Finds all Immich image references in note content.
   *
   * Matching is anchored on the asset id, not on an exact output format: find
   * the markdown constructs that can carry an image, then keep the ones that
   * mention an asset on the configured server. That way a reference stays
   * findable whatever the display width or the user's template did to the
   * text around it.
   *
   * A reference is only convertible if the note records the asset id
   * somewhere — as a thumbnail URL, or as a link to the photo page, which is
   * what {{immich_url}} in the default local template provides. Local images
   * inserted from a template with neither are not matched, because nothing in
   * the note says which Immich asset they came from.
   *
   * Returns one entry per occurrence, sorted by position, with the source
   * range so callers can rewrite each occurrence independently.
   */
  findRemoteReferences (content: string): ImmichReference[] {
    const serverUrl = this.settings.serverUrl
    if (!serverUrl) return []

    const escaped = serverUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const ASSET_ID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
    // /api/assets/<id>/thumbnail in remote and shared mode, /photos/<id> in
    // the link half of the default local and shared templates.
    const idInUrl = new RegExp(`${escaped}/(?:api/assets|photos)/(${ASSET_ID})`, 'i')

    // Widest construct first: a linked image has to claim the whole
    // [![](thumb)](photo) before the inner ![](thumb) is considered.
    const constructs = [
      /\[!\[[^\]]*\]\([^)\n]*\)\]\([^)\n]*\)/g,
      /!\[[^\]]*\]\([^)\n]*\)/g
    ]

    const refs: ImmichReference[] = []
    const claimed: { start: number, end: number }[] = []

    const add = (start: number, end: number, text: string, assetId: string) => {
      if (claimed.some(c => start < c.end && end > c.start)) return
      claimed.push({ start, end })
      refs.push({ start, end, text, assetId })
    }

    // Code blocks carry the bare id on its own line, alongside optional
    // directives such as `width=400`.
    for (const match of content.matchAll(/```immich\r?\n[\s\S]*?```/g)) {
      const id = match[0].match(new RegExp(`^\\s*(${ASSET_ID})\\s*$`, 'im'))
      if (id) add(match.index, match.index + match[0].length, match[0], id[1])
    }

    for (const pattern of constructs) {
      for (const match of content.matchAll(pattern)) {
        const id = match[0].match(idInUrl)
        if (id) add(match.index, match.index + match[0].length, match[0], id[1])
      }
    }

    return refs.sort((a, b) => a.start - b.start)
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
