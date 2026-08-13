import { App, Modal, Notice, Setting, TFile } from 'obsidian'
import ImmichPicker from './main'
import { FolderSuggest } from './suggesters/FolderSuggester'
import { TagSuggest } from './suggesters/TagSuggester'

type ScopeOption = 'note' | 'folder' | 'tag' | 'vault';
type TargetFormat = 'local' | 'server-url' | 'shared' | 'code-block';

interface ScanResult {
  file: TFile;
  matches: { fullMatch: string, assetId: string }[];
}

export class ConversionModal extends Modal {
  plugin: ImmichPicker

  selectedScope: ScopeOption = 'note'
  selectedFolder = ''
  selectedTag = ''
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
          .addOption('tag', 'By tag')
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

    // Tag picker (shown when scope=tag)
    if (this.selectedScope === 'tag') {
      new Setting(contentEl)
        .setName('Tag')
        .addSearch(search => {
          new TagSuggest(this.app, search.inputEl)
          search
            .setPlaceholder('#tag')
            .setValue(this.selectedTag)
            .onChange(value => {
              this.selectedTag = value
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
      case 'tag': {
        if (!this.selectedTag) return []
        const tag = this.selectedTag.startsWith('#') ? this.selectedTag : '#' + this.selectedTag
        return this.app.vault.getMarkdownFiles().filter(file => {
          const cache = this.app.metadataCache.getFileCache(file)
          if (!cache) return false
          // Check inline tags
          if (cache.tags?.some(t => t.tag === tag)) return true
          // Check frontmatter tags
          const fmTags = cache.frontmatter?.tags
          if (Array.isArray(fmTags)) {
            const tagName = tag.replace(/^#/, '')
            return fmTags.some((t: string) => t === tagName || t === tag)
          }
          return false
        })
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

  async convert (): Promise<void> {
    if (this.scanResults.length === 0) return

    const loadingNotice = new Notice(`Converting ${this.totalImages} images...`, 0)
    let converted = 0
    // Filenames handed out during this run, so images that share a timestamp
    // don't overwrite each other before they exist on disk.
    const reservedPaths = new Set<string>()

    try {
      for (let i = 0; i < this.scanResults.length; i++) {
        const { file, matches } = this.scanResults[i]
        loadingNotice.setMessage(`Processing note ${i + 1}/${this.scanResults.length}...`)

        let content = await this.app.vault.read(file)
        const noteFolder = file.path.split('/').slice(0, -1).join('/')

        for (const { fullMatch, assetId } of matches) {
          let replacement: string

          switch (this.targetFormat) {
            case 'local': {
              // Name after the photo's own date, as the picker does. Falling back
              // to now would give every image in the batch the same filename.
              const details = await this.plugin.immichApi.getAssetDetails(assetId)
              const creationTime = details.fileCreatedAt ? window.moment(details.fileCreatedAt) : window.moment()
              const filename = creationTime.format(this.plugin.settings.filename)
              const { thumbnailFolder, linkPath, savePath } = await this.plugin.computeFreeThumbnailPaths(noteFolder, filename, reservedPaths)
              await this.plugin.ensureFolderExists(thumbnailFolder)
              await this.plugin.saveThumbnailToVault(assetId, savePath)
              const useWikilinks = !(this.app.vault as unknown as { getConfig(key: string): unknown }).getConfig('useMarkdownLinks')
              replacement = useWikilinks ? `![[${linkPath}]]` : `![](${linkPath})`
              break
            }
            case 'server-url':
              replacement = `![](${this.plugin.immichApi.getThumbnailUrl(assetId)})`
              break
            case 'shared': {
              const sharedLink = await this.plugin.immichApi.createSharedLink(assetId)
              const sharedUrl = this.plugin.immichApi.getSharedThumbnailUrl(assetId, sharedLink.key)
              replacement = `![](${sharedUrl})`
              break
            }
            case 'code-block':
              replacement = '```immich\n' + assetId + '\n```'
              break
            default:
              replacement = fullMatch
          }

          // Replacer function, not a string: `$&` and friends in a URL or
          // filename would otherwise be expanded as substitution patterns.
          content = content.replace(fullMatch, () => replacement)
          converted++
        }

        await this.app.vault.modify(file, content)
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
