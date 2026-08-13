import { App, Modal, moment, Notice, Platform, PluginSettingTab, Setting } from 'obsidian'
import { FolderSuggest } from './suggesters/FolderSuggester'
import ImmichPicker from './main'

export type GetDateFromOption = 'none' | 'title' | 'frontmatter';
export type RemoteFormatOption = 'server-url' | 'code-block';

export type ImageModeOption = 'local' | 'remote' | 'shared';

export interface ImmichPickerSettings {
  serverUrl: string;
  apiKey: string;
  recentPhotosCount: number;
  gridColumns: number;
  imageMode: ImageModeOption;
  remoteFormat: RemoteFormatOption;
  displayWidth: number;
  renderInEditMode: boolean;
  thumbnailWidth: number;
  thumbnailHeight: number;
  filename: string;
  thumbnailMarkdown: string;
  locationOption: string;
  locationFolder: string;
  locationSubfolder: string;
  convertPastedLink: boolean;
  getDateFrom: GetDateFromOption;
  getDateFromFrontMatterKey: string;
  getDateFromFormat: string;
}

export const DEFAULT_SETTINGS: ImmichPickerSettings = {
  serverUrl: '',
  apiKey: '',
  recentPhotosCount: 9,
  gridColumns: 3,
  imageMode: 'local',
  remoteFormat: 'server-url',
  displayWidth: 0,
  renderInEditMode: true,
  thumbnailWidth: 400,
  thumbnailHeight: 280,
  filename: '[immich_]YYYY-MM-DD--HH-mm-ss[.jpg]',
  thumbnailMarkdown: '[![]({{local_thumbnail_link}})]({{immich_url}}) ',
  locationOption: 'note',
  locationFolder: '',
  locationSubfolder: 'photos',
  convertPastedLink: true,
  getDateFrom: 'none',
  getDateFromFrontMatterKey: 'date',
  getDateFromFormat: 'YYYY-MM-DD'
}

export class ImmichPickerSettingTab extends PluginSettingTab {
  plugin: ImmichPicker

  constructor (app: App, plugin: ImmichPicker) {
    super(app, plugin)
    this.plugin = plugin
  }

  display (): void {
    const { containerEl } = this

    containerEl.empty()
    containerEl.addClass('immich-picker-settings')

    const setVisible = (setting: Setting, visible: boolean) => {
      setting.settingEl.toggle(visible)
    }

    /*
     Connection settings
     */

    new Setting(containerEl)
      .setName('Immich server connection')
      .setHeading()

    new Setting(containerEl)
      .setName('Server URL')
      .setDesc('The URL of your Immich server (e.g., https://immich.example.com)')
      .addText(text => text
        .setPlaceholder('https://immich.example.com')
        .setValue(this.plugin.settings.serverUrl)
        .onChange(async value => {
          // Remove trailing slash
          this.plugin.settings.serverUrl = value.trim().replace(/\/+$/, '')
          await this.plugin.saveSettings()
        }))

    const apiKeySetting = new Setting(containerEl)
      .setName('API key')

    // Load API key asynchronously and populate input
    void (async () => {
      const currentKey = await this.plugin.getApiKey()
      apiKeySetting.addText(text => text
        .setPlaceholder('Enter your API key')
        .setValue(currentKey)
        .onChange(async value => {
          await this.plugin.setApiKey(value.trim())
        }))
      apiKeySetting.then(setting => {
        setting.descEl.appendText('Generate in Immich under Account Settings > API Keys.')
        setting.descEl.createEl('br')
        if (this.plugin.hasSecretStorage()) {
          setting.descEl.createEl('span', {
            text: 'Stored securely via credential manager.',
            cls: 'mod-success'
          })
        } else {
          setting.descEl.appendText('Stored in plugin data file.')
        }
        setting.descEl.createEl('br')
        setting.descEl.appendText('Required permissions: ')
        setting.descEl.createEl('code', { text: 'asset.read' })
        setting.descEl.appendText(', ')
        setting.descEl.createEl('code', { text: 'asset.view' })
        setting.descEl.createEl('br')
        setting.descEl.appendText('Optional for albums: ')
        setting.descEl.createEl('code', { text: 'album.read' })
      })
    })()

    new Setting(containerEl)
      .setDesc('Test your connection to the Immich server.')
      .addButton(btn => btn
        .setButtonText('Test connection')
        .setCta()
        .onClick(async () => {
          try {
            const result = await this.plugin.immichApi.testConnection()
            if (result) {
              new Notice('Connection successful!')
            } else {
              new Notice('Connection failed. Check your server URL and API key.')
            }
          } catch (e) {
            new Notice('Connection failed: ' + (e as Error).message)
          }
        }))

    // Mobile toolbar setup (only shown on mobile)
    if (Platform.isMobile) {
      new Setting(containerEl)
        .setName('Mobile quick access')
        .setDesc('Ways to quickly insert photos on mobile')
        .addButton(btn => btn
          .setButtonText('How to set up')
          .onClick(() => {
            const modal = new Modal(this.app)
            modal.setTitle('Quick access on mobile')

            const content = modal.contentEl

            content.createEl('p', { text: 'Two ways to quickly insert photos on mobile:' })

            content.createEl('strong').textContent = '1. Menu icon (already set up)'
            const ribbon1 = content.createEl('p')
            ribbon1.appendText('Tap the \u2261 menu at the bottom right \u2014 the Immich camera icon is already there.')
            const ribbon2 = content.createEl('p')
            ribbon2.appendText('To reorder: ')
            // eslint-disable-next-line obsidianmd/ui/sentence-case
            ribbon2.createEl('strong').textContent = 'Settings \u2192 Appearance \u2192 Ribbon menu'

            content.createEl('strong').textContent = '2. Keyboard toolbar (optional)'
            const toolbar1 = content.createEl('p')
            toolbar1.appendText('Add the command to the bar above your keyboard when editing:')
            const toolbar2 = content.createEl('p')
            toolbar2.appendText('Go to ')
            // eslint-disable-next-line obsidianmd/ui/sentence-case
            toolbar2.createEl('strong').textContent = 'Settings \u2192 Toolbar'
            toolbar2.appendText(', tap +, search "Immich"')

            const tip = content.createEl('p')
            tip.createEl('small', { text: 'For more customization, try the ' })
            const tipLink = tip.createEl('small')
            tipLink.createEl('a', { text: 'Commander', href: 'obsidian://show-plugin?id=cmdr' })
            tipLink.appendText(' plugin.')

            const btnRow = content.createDiv({ attr: { style: 'display:flex;gap:8px;margin-top:12px;' } })
            const okBtn = btnRow.createEl('button', { text: 'Got it', cls: 'mod-cta' })
            okBtn.addEventListener('click', () => { modal.close() })

            modal.open()
          }))
    }

    /*
     Photo picker settings
     */

    new Setting(containerEl)
      .setName('Photo picker')
      .setHeading()

    new Setting(containerEl)
      .setName('Photos per page')
      .setDesc('Number of photos to load at a time (recent, search results, and "load next")')
      .addText(text => text
        .setPlaceholder(DEFAULT_SETTINGS.recentPhotosCount.toString())
        .setValue(this.plugin.settings.recentPhotosCount.toString())
        .onChange(async value => {
          const num = parseInt(value, 10)
          if (!isNaN(num) && num > 0) {
            this.plugin.settings.recentPhotosCount = num
            await this.plugin.saveSettings()
          }
        }))

    new Setting(containerEl)
      .setName('Grid columns')
      .setDesc('Number of columns in the photo grid')
      .addText(text => text
        .setPlaceholder(DEFAULT_SETTINGS.gridColumns.toString())
        .setValue(this.plugin.settings.gridColumns.toString())
        .onChange(async value => {
          const num = parseInt(value, 10)
          if (!isNaN(num) && num > 0 && num <= 10) {
            this.plugin.settings.gridColumns = num
            await this.plugin.saveSettings()
          }
        }))

    /*
     Image mode settings
     */

    new Setting(containerEl)
      .setName('Image mode')
      .setHeading()

    new Setting(containerEl)
      .setName('How to store images')
      .addDropdown(dropdown => {
        dropdown
          .addOption('local', 'Download to vault')
          .addOption('remote', 'Load from Immich server')
          .addOption('shared', 'Use Immich shared links')
          .setValue(this.plugin.settings.imageMode)
          .onChange(async value => {
            this.plugin.settings.imageMode = value as 'local' | 'remote' | 'shared'
            await this.plugin.saveSettings()
            // Re-render to show/hide dependent sections
            this.display()
          })
      })
      .then(setting => {
        setting.descEl.appendText('Local: downloads thumbnail files into your vault. ')
        setting.descEl.createEl('br')
        setting.descEl.appendText('Remote: images are fetched live from Immich when rendering (no files saved, requires plugin). ')
        setting.descEl.createEl('br')
        setting.descEl.appendText('Shared: creates public Immich shared links (works without plugin, but URLs are public).')
      })

    // Remote format sub-mode (only visible in remote mode)
    if (this.plugin.settings.imageMode === 'remote') {
      new Setting(containerEl)
        .setName('Remote image format')
        .addDropdown(dropdown => {
          dropdown
            .addOption('server-url', 'Server link (recommended)')
            .addOption('code-block', 'Code block')
            .setValue(this.plugin.settings.remoteFormat)
            .onChange(async value => {
              this.plugin.settings.remoteFormat = value as RemoteFormatOption
              await this.plugin.saveSettings()
              this.display()
            })
        })
        .then(setting => {
          setting.descEl.appendText('Server link: standard markdown image. Shows broken image outside Obsidian.')
          setting.descEl.createEl('br')
          setting.descEl.appendText('Code block: Obsidian-only rendering. Shows text outside Obsidian.')
          setting.descEl.createEl('br')
          setting.descEl.createEl('br')
          setting.descEl.appendText('Use "Convert remote images to current format" command to convert existing notes.')
        })

      new Setting(containerEl)
        .setName('Render in edit mode')
        .setDesc('Show images inline while editing. Turn off for standard behavior.')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.renderInEditMode)
          .onChange(async value => {
            this.plugin.settings.renderInEditMode = value
            await this.plugin.saveSettings()
          }))
    }

    // Display width (shown in all modes)
    new Setting(containerEl)
      .setName('Display width')
      .setDesc('Default width for inserted images (in pixels). Set to 0 for original size.')
      .addDropdown(dropdown => {
        dropdown
          .addOption('0', 'Original size')
          .addOption('200', '200px')
          .addOption('400', '400px')
          .addOption('600', '600px')
          .addOption('800', '800px')
          .setValue(this.plugin.settings.displayWidth.toString())
          .onChange(async value => {
            this.plugin.settings.displayWidth = parseInt(value, 10)
            await this.plugin.saveSettings()
          })
      })

    /*
     Date detection settings
     */

    new Setting(containerEl)
      .setName('Note date detection')
      .setHeading()
      .setDesc('Detect a date from the current note to filter photos.')

    const dateFromFrontMatterKeyEl = new Setting(this.containerEl)
      .setName('Frontmatter key')
      .setDesc('The frontmatter property containing the date')
      .addText(text => text
        .setPlaceholder(DEFAULT_SETTINGS.getDateFromFrontMatterKey)
        .setValue(this.plugin.settings.getDateFromFrontMatterKey)
        .onChange(async value => {
          this.plugin.settings.getDateFromFrontMatterKey = value.trim()
          await this.plugin.saveSettings()
        }))

    const dateFromFormatEl = new Setting(this.containerEl)
      .setName('Date format')
      .addText(text => text
        .setPlaceholder(DEFAULT_SETTINGS.getDateFromFormat)
        .setValue(this.plugin.settings.getDateFromFormat)
        .onChange(async value => {
          this.plugin.settings.getDateFromFormat = value.trim()
          await this.plugin.saveSettings()
        }))
      .then(setting => {
        setting.descEl.appendText('Expected date format in title/frontmatter (')
        setting.descEl.createEl('a', {
          text: 'Moment.js format',
          href: 'https://momentjs.com/docs/#/displaying/format/'
        })
        setting.descEl.appendText(').')
      })

    new Setting(containerEl)
      .setName('Get date from')
      .setDesc('Where to extract the date for filtering photos')
      .addDropdown(dropdown => {
        dropdown
          .addOption('none', 'Disabled')
          .addOption('title', 'Note title')
          .addOption('frontmatter', 'Frontmatter property')
          .setValue(this.plugin.settings.getDateFrom)
          .onChange(async value => {
            this.plugin.settings.getDateFrom = value as 'none' | 'title' | 'frontmatter'
            setVisible(dateFromFrontMatterKeyEl, value === 'frontmatter')
            setVisible(dateFromFormatEl, value !== 'none')
            await this.plugin.saveSettings()
          })
      })
      .then(() => {
        setVisible(dateFromFrontMatterKeyEl, this.plugin.settings.getDateFrom === 'frontmatter')
        setVisible(dateFromFormatEl, this.plugin.settings.getDateFrom !== 'none')
      })

    // Only show thumbnail and storage settings in local mode
    if (this.plugin.settings.imageMode === 'local') {
      /*
       Thumbnail settings
       */

      new Setting(containerEl)
        .setName('Thumbnails')
        .setHeading()
        .setDesc('Configure the locally-saved thumbnail images.')

      new Setting(containerEl)
        .setName('Thumbnail width')
        .setDesc('Maximum width of the locally-saved thumbnail image in pixels')
        .addText(text => text
          .setPlaceholder(DEFAULT_SETTINGS.thumbnailWidth.toString())
          .setValue(this.plugin.settings.thumbnailWidth.toString())
          .onChange(async value => {
            this.plugin.settings.thumbnailWidth = +value
            await this.plugin.saveSettings()
          }))

      new Setting(containerEl)
        .setName('Thumbnail height')
        .setDesc('Maximum height of the locally-saved thumbnail image in pixels')
        .addText(text => text
          .setPlaceholder(DEFAULT_SETTINGS.thumbnailHeight.toString())
          .setValue(this.plugin.settings.thumbnailHeight.toString())
          .onChange(async value => {
            this.plugin.settings.thumbnailHeight = +value
            await this.plugin.saveSettings()
          }))

      let filenamePreviewEl: HTMLElement

      new Setting(containerEl)
        .setName('Image filename format')
        .addText(text => text
          .setPlaceholder(DEFAULT_SETTINGS.filename)
          .setValue(this.plugin.settings.filename)
          .onChange(async value => {
            this.plugin.settings.filename = value.trim()
            await this.plugin.saveSettings()
            this.updateFilenamePreview(filenamePreviewEl, value.trim())
          }))
        .then(setting => {
          setting.descEl.appendText('Filename format for saving thumbnails (')
          setting.descEl.createEl('a', {
            text: 'Moment.js format',
            href: 'https://momentjs.com/docs/#/displaying/format/'
          })
          setting.descEl.appendText(').')
          setting.descEl.createEl('br')
          setting.descEl.createEl('br')
          setting.descEl.appendText('Preview: ')
          filenamePreviewEl = setting.descEl.createEl('code', { cls: 'immich-filename-preview' })
          this.updateFilenamePreview(filenamePreviewEl, this.plugin.settings.filename)
        })

      /*
       Storage location settings
       */

      new Setting(containerEl)
        .setName('Storage location')
        .setHeading()

      const locationOptionEl = new Setting(this.containerEl)
      const locationFolderEl = new Setting(this.containerEl)
        .setName('Thumbnail image folder')
        .setDesc('Thumbnails will be saved to this folder')
        .addSearch(search => {
          new FolderSuggest(this.app, search.inputEl)
          search.setPlaceholder('Path/for/thumbnails')
            .setValue(this.plugin.settings.locationFolder)
            .onChange(async value => {
              this.plugin.settings.locationFolder = value.trim()
              await this.plugin.saveSettings()
            })
        })

      const locationSubfolderEl = new Setting(this.containerEl)
        .setName('Subfolder name')
        .setDesc('Subfolder within the current note\'s folder')
        .addText(text => {
          text
            .setPlaceholder('Photos')
            .setValue(this.plugin.settings.locationSubfolder)
            .onChange(async value => {
              this.plugin.settings.locationSubfolder = value.trim().replace(/^[\\/]+/, '').replace(/[\\/]+$/, '')
              await this.plugin.saveSettings()
            })
        })

      locationOptionEl
        .setName('Location to save thumbnails')
        .setDesc('Where the local thumbnail images will be saved')
        .addDropdown(dropdown => {
          dropdown
            .addOption('note', 'Same folder as the note')
            .addOption('subfolder', 'In a subfolder of the current note')
            .addOption('specified', 'In a specific folder')
            .setValue(this.plugin.settings.locationOption)
            .onChange(async value => {
              setVisible(locationFolderEl, value === 'specified')
              setVisible(locationSubfolderEl, value === 'subfolder')
              this.plugin.settings.locationOption = value
              await this.plugin.saveSettings()
            })
        })
        .then(() => {
          setVisible(locationFolderEl, this.plugin.settings.locationOption === 'specified')
          setVisible(locationSubfolderEl, this.plugin.settings.locationOption === 'subfolder')
        })
    }

    /*
     Output settings
     */

    new Setting(containerEl)
      .setName('Output format')
      .setHeading()

    const isRemoteMode = this.plugin.settings.imageMode === 'remote'
    const vaultConfig = this.app.vault as unknown as { getConfig(key: string): unknown }
    const useWikilinks = !vaultConfig.getConfig('useMarkdownLinks')

    if (isRemoteMode) {
      // Remote mode uses a fixed format — show info instead of editable template
      new Setting(containerEl)
        .setName('Inserted text format')
        .then(setting => {
          setting.descEl.appendText('Remote mode uses a fixed format (not customizable):')
          setting.descEl.createEl('br')
          // eslint-disable-next-line obsidianmd/ui/sentence-case
          setting.descEl.createEl('code', { text: '[![immich:id](placeholder)](link)' })
          setting.descEl.createEl('br')
          setting.descEl.createEl('br')
          setting.descEl.appendText('The post-processor replaces the placeholder with the actual image at render time.')
        })
    } else {
      // Local/Shared mode — show editable template with presets
      let templateInput: { setValue(value: string): unknown } | null = null

      new Setting(containerEl)
        .setName('Inserted text format')
        .setDesc('Text inserted when adding a photo')
        .addTextArea(text => {
          templateInput = text
          text
            .setPlaceholder(DEFAULT_SETTINGS.thumbnailMarkdown)
            .setValue(this.plugin.settings.thumbnailMarkdown)
            .onChange(async value => {
              this.plugin.settings.thumbnailMarkdown = value
              await this.plugin.saveSettings()
            })
        })
        .then(setting => {
          // Preset buttons
          const btnContainer = setting.descEl.createDiv({ cls: 'immich-picker-preset-buttons' })
          btnContainer.createEl('span', { text: 'Presets: ' })

          const presets = [
            { label: 'Markdown', value: '[![{{display_width}}]({{local_thumbnail_link}})]({{immich_url}}) ', recommended: !useWikilinks },
            { label: 'Wikilink', value: '![[{{local_thumbnail_link}}{{display_width}}]]', recommended: useWikilinks },
            { label: 'Image only', value: '![{{display_width}}]({{local_thumbnail_link}})', recommended: false }
          ]

          for (const preset of presets) {
            const btn = btnContainer.createEl('button', {
              text: preset.label + (preset.recommended ? ' *' : ''),
              cls: 'immich-picker-preset-btn'
            })
            btn.addEventListener('click', async () => {
              this.plugin.settings.thumbnailMarkdown = preset.value
              await this.plugin.saveSettings()
              templateInput?.setValue(preset.value)
            })
          }

          btnContainer.createEl('br')
          btnContainer.createEl('small', { text: '* recommended based on your vault link settings' })

          // Variable reference
          setting.descEl.createEl('br')
          setting.descEl.appendText('Available variables:')
          const ul = setting.descEl.createEl('ul')
          ul.createEl('li').setText('local_thumbnail_link - path to the local thumbnail')
          // eslint-disable-next-line obsidianmd/ui/sentence-case
          ul.createEl('li').setText('immich_thumbnail_url - the thumbnail link')
          ul.createEl('li').setText('immich_url - link to the photo in the server')
          ul.createEl('li').setText('immich_asset_id - the asset id')
          ul.createEl('li').setText('original_filename - original filename')
          ul.createEl('li').setText('taken_date - date the photo was taken')
          ul.createEl('li').setText('description - photo description')
          // eslint-disable-next-line obsidianmd/ui/sentence-case
          ul.createEl('li').setText('display_width - image width from settings (e.g. |400)')
        })
    }

    new Setting(containerEl)
      .setName('Convert pasted Immich links')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.convertPastedLink)
        .onChange(async value => {
          this.plugin.settings.convertPastedLink = value
          await this.plugin.saveSettings()
        }))
      .then(setting => {
        setting.descEl.appendText('When pasting an Immich photo URL (e.g., ')
        setting.descEl.createEl('code', { text: 'https://immich.example.com/photos/abc-123' })
        setting.descEl.appendText('), automatically download the thumbnail and insert it as markdown instead of pasting the plain URL.')
      })
  }

  updateFilenamePreview (el: HTMLElement, format: string): void {
    el.removeClass('is-muted', 'is-error')
    if (!format.trim()) {
      el.setText('Enter a format')
      el.addClass('is-muted')
      return
    }
    try {
      const preview = moment().format(format)
      el.setText(preview)
    } catch {
      el.setText('Invalid format')
      el.addClass('is-error')
    }
  }
}
