import { App, moment, Notice, PluginSettingTab, Setting } from 'obsidian'
import { FolderSuggest } from './suggesters/FolderSuggester'
import ImmichPicker from './main'

export interface ImmichPickerSettings {
  serverUrl: string;
  apiKey: string;
  recentPhotosCount: number;
  thumbnailWidth: number;
  thumbnailHeight: number;
  filename: string;
  thumbnailMarkdown: string;
  locationOption: string;
  locationFolder: string;
  locationSubfolder: string;
  convertPastedLink: boolean;
}

export const DEFAULT_SETTINGS: ImmichPickerSettings = {
  serverUrl: '',
  apiKey: '',
  recentPhotosCount: 10,
  thumbnailWidth: 400,
  thumbnailHeight: 280,
  filename: '[immich_]YYYY-MM-DD--HH-mm-ss[.jpg]',
  thumbnailMarkdown: '[![]({{local_thumbnail_link}})]({{immich_url}}) ',
  locationOption: 'note',
  locationFolder: '',
  locationSubfolder: 'photos',
  convertPastedLink: true
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
      setting.settingEl.style.display = visible ? 'flex' : 'none'
    }

    /*
     Connection settings
     */

    new Setting(containerEl)
      .setName('Immich Server Connection')
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

    new Setting(containerEl)
      .setName('API Key')
      .setDesc('Your Immich API key. You can generate one in Immich under Account Settings > API Keys.')
      .addText(text => text
        .setPlaceholder('Enter your API key')
        .setValue(this.plugin.settings.apiKey)
        .onChange(async value => {
          this.plugin.settings.apiKey = value.trim()
          await this.plugin.saveSettings()
        }))

    new Setting(containerEl)
      .setDesc('Test your connection to the Immich server.')
      .addButton(btn => btn
        .setButtonText('Test Connection')
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
      .setName('Photo Picker')
      .setHeading()

    new Setting(containerEl)
      .setName('Photos per page')
      .setDesc('Number of photos to load at a time (recent, search results, and "Load next")')
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

    /*
     Thumbnail settings
     */

    new Setting(containerEl)
      .setName('Thumbnail Settings')
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
          text: 'MomentJS format',
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
      .setName('Storage Location')
      .setHeading()

    const locationOptionEl = new Setting(this.containerEl)
    const locationFolderEl = new Setting(this.containerEl)
      .setName('Thumbnail image folder')
      .setDesc('Thumbnails will be saved to this folder')
      .addSearch(search => {
        new FolderSuggest(search.inputEl)
        search.setPlaceholder('Path/For/Thumbnails')
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
          .setPlaceholder('photos')
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
      .setName('Output Format')
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
      .then(setting => {
        const ul = setting.descEl.createEl('ul')
        ul.createEl('li').setText('local_thumbnail_link - Path to the local thumbnail')
        ul.createEl('li').setText('immich_url - URL to the photo in Immich')
        ul.createEl('li').setText('immich_asset_id - The Immich asset ID')
        ul.createEl('li').setText('original_filename - Original filename from Immich')
        ul.createEl('li').setText('taken_date - Date the photo was taken')
        ul.createEl('li').setText('description - Photo description from Immich')
      })

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
    if (!format.trim()) {
      el.setText('Enter a format')
      el.style.color = 'var(--text-muted)'
      return
    }
    try {
      const preview = moment().format(format)
      el.setText(preview)
      el.style.color = ''
    } catch {
      el.setText('Invalid format')
      el.style.color = 'var(--text-error)'
    }
  }
}
