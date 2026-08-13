import { App, Modal, Notice, Setting, TFile } from 'obsidian'
import ImmichPicker, { ImmichReference, applyReplacements } from './main'
import { ImmichAssetDetails } from './immichApi'
import { FolderSuggest } from './suggesters/FolderSuggester'

type ScopeOption = 'note' | 'folder' | 'vault';
type TargetFormat = 'local' | 'server-url' | 'shared' | 'code-block';

interface ScanResult {
  file: TFile;
  matches: ImmichReference[];
}

/**
 * Adapts generator output, which is shaped for insertion at a cursor, to an
 * in-place replacement: drop the padding they add, then re-add newlines only
 * where a fenced block would otherwise land inside a paragraph.
 */
function fitToSurroundings (content: string, ref: ImmichReference, replacement: string): string {
  const trimmed = replacement.trim()
  if (!trimmed.startsWith('```')) return trimmed

  const before = content.slice(0, ref.start)
  const after = content.slice(ref.end)
  return (before === '' || before.endsWith('\n') ? '' : '\n') +
    trimmed +
    (after === '' || after.startsWith('\n') ? '' : '\n')
}

/**
 * Confirms creation of Immich shared links, which are publicly readable and
 * have no expiry. Resolves false unless the user explicitly accepts.
 */
function confirmPublicLinks (app: App, count: number, scopeLabel: string): Promise<boolean> {
  return new Promise(resolve => {
    const modal = new Modal(app)
    modal.setTitle('Create public links?')

    const plural = count === 1 ? '' : 's'
    modal.contentEl.createEl('p', {
      text: `This creates ${count} Immich shared link${plural} for the images in ${scopeLabel}.`
    })
    modal.contentEl.createEl('p', {
      text: `Anyone with the URL can view ${count === 1 ? 'that photo' : 'those photos'} without logging in to Immich, and the links do not expire. Undoing this means deleting each link in Immich by hand.`
    })

    let confirmed = false
    const buttons = modal.contentEl.createDiv({ cls: 'immich-conversion-buttons' })

    const cancelBtn = buttons.createEl('button', { text: 'Cancel' })
    cancelBtn.addEventListener('click', () => { modal.close() })

    const confirmBtn = buttons.createEl('button', {
      text: `Create ${count} public link${plural}`,
      cls: 'mod-warning'
    })
    confirmBtn.addEventListener('click', () => {
      confirmed = true
      modal.close()
    })

    modal.onClose = () => { resolve(confirmed) }
    modal.open()
  })
}

export class ConversionModal extends Modal {
  plugin: ImmichPicker

  selectedScope: ScopeOption = 'note'
  selectedFolder = ''
  targetFormat: TargetFormat = 'local'

  scanResults: ScanResult[] = []
  totalImages = 0
  hasScanned = false

  constructor (app: App, plugin: ImmichPicker) {
    super(app)
    this.plugin = plugin
  }

  onOpen () {
    this.render()
  }

  render () {
    const { contentEl } = this
    contentEl.empty()

    this.setTitle('Convert Immich images')

    // Scope selector
    new Setting(contentEl)
      .setName('Scope')
      .setDesc('Which notes to convert')
      .addDropdown(dropdown => {
        dropdown
          .addOption('note', 'Current note')
          .addOption('folder', 'Folder')
          .addOption('vault', 'Entire vault')
          .setValue(this.selectedScope)
          .onChange(value => {
            this.selectedScope = value as ScopeOption
            this.hasScanned = false
            this.render()
          })
      })

    // Folder picker (shown when scope=folder)
    if (this.selectedScope === 'folder') {
      new Setting(contentEl)
        .setName('Folder')
        .addSearch(search => {
          new FolderSuggest(this.app, search.inputEl)
          search
            .setPlaceholder('Select folder...')
            .setValue(this.selectedFolder)
            .onChange(value => {
              this.selectedFolder = value
              this.hasScanned = false
            })
        })
    }

    // Target format
    new Setting(contentEl)
      .setName('Convert to')
      .addDropdown(dropdown => {
        dropdown
          .addOption('local', 'Local thumbnails')
          .addOption('server-url', 'Server link (remote)')
          .addOption('shared', 'Shared link (public)')
          .addOption('code-block', 'Code block')
          .setValue(this.targetFormat)
          .onChange(value => {
            this.targetFormat = value as TargetFormat
          })
      })

    // Scan results
    if (this.hasScanned) {
      const resultEl = contentEl.createDiv({ cls: 'immich-conversion-results' })
      if (this.totalImages === 0) {
        resultEl.createEl('p', { text: 'No Immich images found in the selected scope.' })
      } else {
        resultEl.createEl('p', {
          text: `Found ${this.totalImages} image${this.totalImages === 1 ? '' : 's'} in ${this.scanResults.length} note${this.scanResults.length === 1 ? '' : 's'}`
        })
      }
    }

    // Action buttons
    const buttonContainer = contentEl.createDiv({ cls: 'immich-conversion-buttons' })

    const scanBtn = buttonContainer.createEl('button', { text: 'Scan' })
    scanBtn.addEventListener('click', () => { void this.scan() })

    if (this.hasScanned && this.totalImages > 0) {
      const convertBtn = buttonContainer.createEl('button', {
        text: `Convert ${this.totalImages} images`,
        cls: 'mod-cta'
      })
      convertBtn.addEventListener('click', () => { void this.convert() })
    }

    const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' })
    cancelBtn.addEventListener('click', () => { this.close() })
  }

  async getFilesInScope (): Promise<TFile[]> {
    switch (this.selectedScope) {
      case 'note': {
        const activeFile = this.app.workspace.getActiveFile()
        return activeFile ? [activeFile] : []
      }
      case 'folder': {
        if (!this.selectedFolder) return []
        const folderPath = this.selectedFolder.replace(/\/+$/, '')
        return this.app.vault.getMarkdownFiles()
          .filter(f => f.path.startsWith(folderPath + '/') || f.path === folderPath)
      }
      case 'vault':
        return this.app.vault.getMarkdownFiles()
      default:
        return []
    }
  }

  async scan (): Promise<void> {
    const files = await this.getFilesInScope()

    if (files.length === 0) {
      this.scanResults = []
      this.totalImages = 0
      this.hasScanned = true
      this.render()
      return
    }

    this.scanResults = []
    this.totalImages = 0

    for (const file of files) {
      const content = await this.app.vault.read(file)
      const matches = this.plugin.findRemoteReferences(content)
      if (matches.length > 0) {
        this.scanResults.push({ file, matches })
        this.totalImages += matches.length
      }
    }

    this.hasScanned = true
    this.render()
  }

  scopeLabel (): string {
    switch (this.selectedScope) {
      case 'note': return 'this note'
      case 'folder': return `the folder "${this.selectedFolder}"`
      case 'vault': return 'your entire vault'
      default: return 'the selected scope'
    }
  }

  async convert (): Promise<void> {
    if (this.scanResults.length === 0) return

    // Shared links are public and permanent — never create them in bulk silently.
    if (this.targetFormat === 'shared') {
      const confirmed = await confirmPublicLinks(this.app, this.totalImages, this.scopeLabel())
      if (!confirmed) return
    }

    const loadingNotice = new Notice(`Converting ${this.totalImages} images...`, 0)
    let converted = 0
    // Filenames handed out during this run, so images that share a timestamp
    // don't overwrite each other before they exist on disk.
    const reservedPaths = new Set<string>()

    try {
      for (let i = 0; i < this.scanResults.length; i++) {
        const { file, matches } = this.scanResults[i]
        loadingNotice.setMessage(`Processing note ${i + 1}/${this.scanResults.length}...`)

        const content = await this.app.vault.read(file)
        const noteFolder = file.path.split('/').slice(0, -1).join('/')
        const edits: { ref: ImmichReference, replacement: string }[] = []

        for (const ref of matches) {
          const { assetId } = ref
          // Go through the same generators the picker uses, so a converted
          // image is indistinguishable from a freshly inserted one — same
          // template, same display width, and for local images the asset id
          // stays in the note so it can be converted again later.
          // Details cost a round trip each, and are only needed to fill
          // template variables or to decide whether a photo is already small
          // enough to skip resizing.
          const needsDetails = this.targetFormat === 'local' ||
            this.targetFormat === 'shared' ||
            this.plugin.settings.displayWidth > 0
          const details: ImmichAssetDetails = needsDetails
            ? await this.plugin.immichApi.getAssetDetails(assetId)
            : { id: assetId }
          const description = details.exifInfo?.description || ''
          const origWidth = details.exifInfo?.exifImageWidth
          const origHeight = details.exifInfo?.exifImageHeight
          let replacement: string

          switch (this.targetFormat) {
            case 'local': {
              // Name after the photo's own date, as the picker does. Falling back
              // to now would give every image in the batch the same filename.
              const creationTime = details.fileCreatedAt ? window.moment(details.fileCreatedAt) : window.moment()
              const filename = creationTime.format(this.plugin.settings.filename)
              const { thumbnailFolder, linkPath, savePath } = await this.plugin.computeFreeThumbnailPaths(noteFolder, filename, reservedPaths)
              await this.plugin.ensureFolderExists(thumbnailFolder)
              await this.plugin.saveThumbnailToVault(assetId, savePath)
              replacement = this.plugin.generateThumbnailMarkdown({
                linkPath,
                assetId,
                originalFilename: details.originalFileName || '',
                takenDate: creationTime.format(),
                description,
                origWidth,
                origHeight
              })
              break
            }
            case 'shared':
              replacement = await this.plugin.generateSharedMarkdown({
                assetId,
                originalFilename: details.originalFileName || '',
                takenDate: details.fileCreatedAt || '',
                description,
                origWidth,
                origHeight
              })
              break
            case 'server-url':
            case 'code-block':
              replacement = this.plugin.generateRemoteMarkdown({
                assetId,
                origWidth,
                origHeight,
                format: this.targetFormat
              })
              break
            default:
              replacement = ref.text
          }

          edits.push({ ref, replacement: fitToSurroundings(content, ref, replacement) })
          converted++
        }

        await this.app.vault.modify(file, applyReplacements(content, edits))
      }

      loadingNotice.hide()
      new Notice(`Converted ${converted} images in ${this.scanResults.length} notes`)
      this.close()
    } catch (e) {
      loadingNotice.hide()
      console.error('Conversion failed:', e)
      new Notice('Conversion failed: ' + (e as Error).message)
    }
  }

  onClose () {
    this.contentEl.empty()
  }
}
