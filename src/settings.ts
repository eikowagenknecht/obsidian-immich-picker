import { App, moment, Notice, PluginSettingTab, Setting } from 'obsidian'
import { FolderSuggest } from './suggesters/FolderSuggester'
import ImmichPicker from './main'

export type GetDateFromOption = 'none' | 'title' | 'frontmatter';

export interface ImmichPickerSettings {
  serverUrl: string;
  apiKey: string;
  recentPhotosCount: number;
  gridColumns: number;
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
      .setDesc('The URL of your immich server (e.g., https://immich.example.com)')
      .addText(text => text
        .setPlaceholder('https://immich.example.com')
        .setValue(this.plugin.settings.serverUrl)
        .onChange(async value => {
          // Remove trailing slash
          this.plugin.settings.serverUrl = value.trim().replace(/\/+$/, '')
          await this.plugin.saveSettings()
        }))

    new Setting(containerEl)
      .setName('API key')
      .addText(text => text
        .setPlaceholder('Enter your API key')
        .setValue(this.plugin.settings.apiKey)
        .onChange(async value => {
          this.plugin.settings.apiKey = value.trim()
          await this.plugin.saveSettings()
        }))
      .then(setting => {
        setting.descEl.appendText('Generate in immich under Account Settings > API Keys.')
        setting.descEl.createEl('br')
        setting.descEl.appendText('Required permissions: ')
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- technical API permission code
        setting.descEl.createEl('code', { text: 'asset.read' })
        setting.descEl.appendText(', ')
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- technical API permission code
        setting.descEl.createEl('code', { text: 'asset.view' })
        setting.descEl.createEl('br')
        setting.descEl.appendText('Optional for albums: ')
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- technical API permission code
        setting.descEl.createEl('code', { text: 'album.read' })
      })

    new Setting(containerEl)
      .setDesc('Test your connection to the immich server.')
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
        new FolderSuggest(search.inputEl)
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

    /*
     Output settings
     */

    new Setting(containerEl)
      .setName('Output format')
      .setHeading()

    new Setting(containerEl)
      .setName('Inserted Markdown')
      .setDesc('The Markdown text inserted when adding a photo. Available variables:')
      .addTextArea(text => text
        .setPlaceholder(DEFAULT_SETTINGS.thumbnailMarkdown)
        .setValue(this.plugin.settings.thumbnailMarkdown)
        .onChange(async value => {
          this.plugin.settings.thumbnailMarkdown = value
          await this.plugin.saveSettings()
        }))
      /* eslint-disable obsidianmd/ui/sentence-case -- variable names with underscores */
      .then(setting => {
        const ul = setting.descEl.createEl('ul')
        ul.createEl('li').setText('local_thumbnail_link - path to the local thumbnail')
        ul.createEl('li').setText('immich_url - URL to the photo in immich')
        ul.createEl('li').setText('immich_asset_id - the immich asset ID')
        ul.createEl('li').setText('original_filename - original filename from immich')
        ul.createEl('li').setText('taken_date - date the photo was taken')
        ul.createEl('li').setText('description - photo description from immich')
      })
      /* eslint-enable obsidianmd/ui/sentence-case */

    new Setting(containerEl)
      .setName('Convert pasted immich links')
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
