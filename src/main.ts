import { Editor, MarkdownView, moment, Notice, Plugin, TFile } from 'obsidian'
import { ImmichApi } from './immichApi'
import {
  ImmichPickerSettingTab,
  ImmichPickerSettings,
  LegacySettings,
  RemoteFormatOption,
  DEFAULT_TEMPLATE_MARKDOWN,
  cloneDefaultSettings,
  normalizeTemplateSettings
} from './settings'
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

/** Credential-manager entry holding the Immich API key. */
const API_KEY_SECRET = 'immich-api-key'

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
        // Another handler already dealt with this paste
        if (evt.defaultPrevented) return
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
          // No picker to choose in, so the folder rules decide alone.
          const templateId = this.templateIdForPath(noteFile.path)

          if (this.settings.imageMode === 'remote') {
            linkText = this.generateRemoteMarkdown({ assetId })
          } else if (this.settings.imageMode === 'shared') {
            linkText = await this.generateSharedMarkdown({
              assetId,
              originalFilename: '',
              takenDate: window.moment().format(),
              description: '',
              templateId
            })
          } else {
            const noteFolder = noteFile.path.split('/').slice(0, -1).join('/')
            const creationTime = window.moment()
            const filename = creationTime.format(this.settings.filename)

            const { thumbnailFolder, linkPath, savePath } = await this.computeFreeThumbnailPaths(noteFolder, filename)
            await this.ensureFolderExists(thumbnailFolder)
            await this.saveThumbnailToVault(assetId, savePath)

            linkText = this.generateThumbnailMarkdown({
              linkPath,
              assetId,
              originalFilename: '',
              takenDate: creationTime.format(),
              description: '',
              templateId
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

  // --- API key storage ---
  //
  // The key lives in the OS credential manager rather than data.json.
  // app.secretStorage is available from Obsidian 1.11.4 and manifest.json
  // requires 1.13.0, so there is no fallback path to maintain.

  getApiKey (): string {
    if (!this.cachedApiKey) {
      this.cachedApiKey = this.app.secretStorage.getSecret(API_KEY_SECRET) || ''
    }
    return this.cachedApiKey
  }

  async setApiKey (apiKey: string): Promise<void> {
    this.cachedApiKey = apiKey
    this.app.secretStorage.setSecret(API_KEY_SECRET, apiKey)

    // An older version may have left a copy in the plain-text data file.
    if (this.settings.apiKey) {
      this.settings.apiKey = ''
      await this.saveSettings()
    }
  }

  private async initApiKey (): Promise<void> {
    if (this.settings.apiKey) {
      await this.setApiKey(this.settings.apiKey)
      return
    }
    this.getApiKey()
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
    if (!filename) {
      throw new Error('Image filename format produced an empty filename — check it in settings')
    }

    const dot = filename.lastIndexOf('.')
    const stem = dot > 0 ? filename.slice(0, dot) : filename
    const ext = dot > 0 ? filename.slice(dot) : ''

    let candidate = filename
    // Bounded: a format with no time component gives every image in a batch
    // the same name, and without a ceiling a wedged suffix search would hang
    // Obsidian rather than surface the bad setting.
    for (let n = 1; n <= 10000; n++) {
      const paths = this.computeThumbnailPaths(noteFolder, candidate)
      const clashes = reserved?.has(paths.savePath) || await this.app.vault.adapter.exists(paths.savePath)
      if (!clashes) {
        reserved?.add(paths.savePath)
        return paths
      }
      candidate = `${stem}-${n}${ext}`
    }
    throw new Error(`Could not find a free filename for "${filename}" — check the image filename format in settings`)
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
  getWidthAlt (origWidth?: number, origHeight?: number, maxSize = this.settings.displayWidth): string {
    if (maxSize <= 0) return ''

    // If we know the dimensions, skip sizing if image is already small enough
    if (origWidth && origHeight) {
      const longEdge = Math.max(origWidth, origHeight)
      if (longEdge <= maxSize) return ''
    }

    // Width-only — Obsidian handles aspect ratio automatically
    return `|${maxSize}`
  }

  /**
   * The template a note should be inserted with, from the folder rules.
   *
   * The deepest matching folder wins, so a rule on `blog/drafts` beats one on
   * `blog` for a note inside both. Notes matched by nothing get the default.
   * Comparison is case-insensitive, since a folder path typed into the rule
   * rarely matches the vault's casing exactly.
   */
  templateIdForPath (notePath?: string | null): string {
    let best: { id: string, depth: number } | null = null

    for (const rule of this.settings.folderTemplateRules) {
      const folder = rule.folder.replace(/^\/+|\/+$/g, '')
      if (!folder || !notePath) continue
      if (!notePath.toLowerCase().startsWith(folder.toLowerCase() + '/')) continue
      if (!best || folder.length > best.depth) best = { id: rule.templateId, depth: folder.length }
    }

    return best?.id ?? this.settings.defaultTemplateId
  }

  /**
   * Template text for an id. Falls back through the default to the first
   * entry, so a stale id from a picker left open across a settings change
   * still produces something insertable.
   */
  templateFor (templateId?: string): string {
    const templates = this.settings.outputTemplates
    const found = templates.find(t => t.id === templateId) ??
      templates.find(t => t.id === this.settings.defaultTemplateId) ??
      templates[0]
    return found?.template ?? DEFAULT_TEMPLATE_MARKDOWN
  }

  generateThumbnailMarkdown (params: {
    linkPath: string,
    assetId: string,
    originalFilename: string,
    takenDate: string,
    description: string,
    origWidth?: number,
    origHeight?: number,
    /** Overrides the display width setting for this one call. */
    displayWidth?: number,
    /** Overrides the template the folder rules would pick. */
    templateId?: string
  }): string {
    return handlebarParse(this.templateFor(params.templateId), {
      local_thumbnail_link: params.linkPath,
      immich_thumbnail_url: this.immichApi.getThumbnailUrl(params.assetId),
      immich_asset_id: params.assetId,
      immich_url: this.immichApi.getAssetUrl(params.assetId),
      original_filename: params.originalFilename,
      taken_date: params.takenDate,
      description: params.description,
      display_width: this.getWidthAlt(params.origWidth, params.origHeight, params.displayWidth)
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
    /** Overrides the display width setting for this one call. */
    displayWidth?: number,
    format?: RemoteFormatOption
  }): string {
    const format = params.format || this.settings.remoteFormat || 'server-url'
    const widthAlt = this.getWidthAlt(params.origWidth, params.origHeight, params.displayWidth)

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
    origHeight?: number,
    /** Overrides the display width setting for this one call. */
    displayWidth?: number,
    /** Overrides the template the folder rules would pick. */
    templateId?: string
  }): Promise<string> {
    const sharedLink = await this.immichApi.createSharedLink(params.assetId)
    const sharedThumbnailUrl = this.immichApi.getSharedThumbnailUrl(params.assetId, sharedLink.key)

    return handlebarParse(this.templateFor(params.templateId), {
      local_thumbnail_link: sharedThumbnailUrl,
      immich_thumbnail_url: sharedThumbnailUrl,
      immich_asset_id: params.assetId,
      immich_url: this.immichApi.getAssetUrl(params.assetId),
      original_filename: params.originalFilename,
      taken_date: params.takenDate,
      description: params.description,
      display_width: this.getWidthAlt(params.origWidth, params.origHeight, params.displayWidth)
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
   * somewhere — as a thumbnail URL, as a link to the photo page, which is
   * what {{immich_url}} in the default local template provides, or in a
   * trailing `<!--immich: ...-->` comment, which is how a template keeps the
   * embed itself plain for publish plugins that choke on a link wrapper. The
   * comment is part of the matched range, so converting away from that
   * format takes the now-stale backlink with it. Local images inserted from
   * a template with none of the three are not matched, because nothing in
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

    // An immich backlink comment on the same line or the one below, which is
    // where a template that emits one puts it. Confined to a single line, so
    // an unterminated comment cannot swallow the rest of the note.
    const BACKLINK = String.raw`(?:[ \t]*\r?\n?[ \t]*<!--\s*immich:[^\n]*?-->)?`

    // Widest construct first: a linked image has to claim the whole
    // [![](thumb)](photo) before the inner ![](thumb) is considered.
    const constructs = [
      new RegExp(String.raw`\[!\[[^\]]*\]\([^)\n]*\)\]\([^)\n]*\)` + BACKLINK, 'g'),
      new RegExp(String.raw`!\[[^\]]*\]\([^)\n]*\)` + BACKLINK, 'g')
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
      const date = window.moment(file.basename, this.settings.getDateFromFormat, true)
      return date.isValid() ? date : null
    }

    if (this.settings.getDateFrom === 'frontmatter') {
      const meta = this.app.metadataCache.getFileCache(file)
      const frontMatter = meta?.frontmatter
      if (frontMatter && frontMatter[this.settings.getDateFromFrontMatterKey]) {
        const dateValue = frontMatter[this.settings.getDateFromFrontMatterKey] as string
        const date = window.moment(dateValue, this.settings.getDateFromFormat, true)
        return date.isValid() ? date : null
      }
    }

    return null
  }

  async loadSettings () {
    const stored = await this.loadData() as (Partial<ImmichPickerSettings> & LegacySettings) | null
    this.settings = Object.assign(cloneDefaultSettings(), stored)
    normalizeTemplateSettings(this.settings, stored ?? undefined)
    // The pre-1.2 single template now lives in the list; stop writing it back.
    delete (this.settings as LegacySettings).thumbnailMarkdown
  }

  async saveSettings () {
    await this.saveData(this.settings)
  }
}
