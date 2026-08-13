import { App, Notice, Platform, PluginSettingTab, SettingDefinitionItem, SettingDefinitionPage, SettingGroupItem } from 'obsidian'
import { clearImmichBlobCache } from './postProcessor'
import { FolderSuggest } from './suggesters/FolderSuggester'
import ImmichPicker from './main'

export type GetDateFromOption = 'none' | 'title' | 'frontmatter';
export type RemoteFormatOption = 'server-url' | 'code-block';
export type ImageModeOption = 'local' | 'remote' | 'shared';

/** A named Markdown template the picker can insert a photo with. */
export interface OutputTemplate {
  /** Stable key referenced by `defaultTemplateId` and by folder rules. */
  id: string;
  name: string;
  template: string;
}

/** Picks a template automatically for notes inside a folder. */
export interface FolderTemplateRule {
  folder: string;
  templateId: string;
}

/**
 * Fields no longer written, kept only so data files from older versions can
 * be read once and migrated. See `normalizeTemplateSettings`.
 */
export interface LegacySettings {
  /** Pre-1.2: the single global template, now the first entry in the list. */
  thumbnailMarkdown?: string;
}

export interface ImmichPickerSettings {
  serverUrl: string;
  apiKey: string;
  recentPhotosCount: number;
  gridColumns: number;
  includeArchived: boolean;
  imageMode: ImageModeOption;
  remoteFormat: RemoteFormatOption;
  displayWidth: number;
  renderInEditMode: boolean;
  thumbnailWidth: number;
  thumbnailHeight: number;
  filename: string;
  outputTemplates: OutputTemplate[];
  defaultTemplateId: string;
  folderTemplateRules: FolderTemplateRule[];
  locationOption: string;
  locationFolder: string;
  locationSubfolder: string;
  convertPastedLink: boolean;
  getDateFrom: GetDateFromOption;
  getDateFromFrontMatterKey: string;
  getDateFromFormat: string;
}

/** The template every install starts with, and the fallback if none is left. */
export const DEFAULT_TEMPLATE_MARKDOWN = '[![]({{local_thumbnail_link}})]({{immich_url}}) '

const DEFAULT_TEMPLATE_ID = 'default'

export const DEFAULT_SETTINGS: ImmichPickerSettings = {
  serverUrl: '',
  apiKey: '',
  recentPhotosCount: 9,
  gridColumns: 3,
  includeArchived: false,
  imageMode: 'local',
  remoteFormat: 'server-url',
  displayWidth: 0,
  renderInEditMode: true,
  thumbnailWidth: 400,
  thumbnailHeight: 280,
  filename: '[immich_]YYYY-MM-DD--HH-mm-ss[.jpg]',
  outputTemplates: [{ id: DEFAULT_TEMPLATE_ID, name: 'Default', template: DEFAULT_TEMPLATE_MARKDOWN }],
  defaultTemplateId: DEFAULT_TEMPLATE_ID,
  folderTemplateRules: [],
  locationOption: 'note',
  locationFolder: '',
  locationSubfolder: 'photos',
  convertPastedLink: true,
  getDateFrom: 'none',
  getDateFromFrontMatterKey: 'date',
  getDateFromFormat: 'YYYY-MM-DD'
}

/**
 * A fresh copy of the defaults. The arrays in DEFAULT_SETTINGS are shared
 * module state, and settings get mutated in place all over the plugin, so
 * handing them out directly would let an edit rewrite the defaults.
 */
export function cloneDefaultSettings (): ImmichPickerSettings {
  return {
    ...DEFAULT_SETTINGS,
    outputTemplates: DEFAULT_SETTINGS.outputTemplates.map(t => ({ ...t })),
    folderTemplateRules: []
  }
}

/**
 * Brings a loaded settings object up to the template list and repairs
 * dangling references.
 *
 * Up to 1.1.7 there was one global `thumbnailMarkdown` string. It becomes the
 * single entry in the list, so upgrading inserts exactly what it did before.
 * Repointing rather than dropping broken references keeps every later reader
 * free of "what if that id is gone" checks, without anything vanishing from
 * the settings UI unannounced.
 */
export function normalizeTemplateSettings (settings: ImmichPickerSettings, legacy?: LegacySettings): void {
  if (!Array.isArray(settings.outputTemplates) || settings.outputTemplates.length === 0) {
    settings.outputTemplates = [{
      id: DEFAULT_TEMPLATE_ID,
      name: 'Default',
      template: legacy?.thumbnailMarkdown || DEFAULT_TEMPLATE_MARKDOWN
    }]
    settings.defaultTemplateId = DEFAULT_TEMPLATE_ID
  }

  const ids = new Set(settings.outputTemplates.map(t => t.id))
  if (!ids.has(settings.defaultTemplateId)) {
    settings.defaultTemplateId = settings.outputTemplates[0].id
  }

  if (!Array.isArray(settings.folderTemplateRules)) {
    settings.folderTemplateRules = []
  }
  for (const rule of settings.folderTemplateRules) {
    if (!ids.has(rule.templateId)) rule.templateId = settings.defaultTemplateId
  }
}

/** An id that no existing template is using. */
export function newTemplateId (existing: OutputTemplate[]): string {
  const taken = new Set(existing.map(t => t.id))
  let id = 'tpl-' + Date.now().toString(36)
  for (let n = 1; taken.has(id); n++) id = `tpl-${Date.now().toString(36)}-${n}`
  return id
}

export class ImmichPickerSettingTab extends PluginSettingTab {
  plugin: ImmichPicker

  constructor (app: App, plugin: ImmichPicker) {
    super(app, plugin)
    this.plugin = plugin
  }

  /**
   * Declarative settings. Returning a non-empty array makes Obsidian render
   * the tab from these definitions and index them for settings search.
   */
  getSettingDefinitions (): SettingDefinitionItem[] {
    return [
      {
        type: 'group',
        heading: 'Immich server connection',
        items: [
          {
            name: 'Server URL',
            desc: 'The URL of your Immich server (e.g., https://immich.example.com)',
            control: {
              type: 'text',
              key: 'serverUrl',
              placeholder: 'https://immich.example.com',
              defaultValue: DEFAULT_SETTINGS.serverUrl
            }
          },
          {
            name: 'API key',
            desc: createFragment(frag => {
              frag.appendText('Generate in Immich under Account Settings > API Keys.')
              frag.createEl('br')
              frag.createEl('span', {
                text: 'Stored in your system credential manager, not in the plugin data file.',
                cls: 'mod-success'
              })
              frag.createEl('br')
              frag.appendText('Required permissions: ')
              frag.createEl('code', { text: 'asset.read' })
              frag.appendText(', ')
              frag.createEl('code', { text: 'asset.view' })
              frag.createEl('br')
              frag.appendText('Optional for albums: ')
              frag.createEl('code', { text: 'album.read' })
            }),
            control: {
              type: 'text',
              key: 'apiKey',
              placeholder: 'Enter your API key',
              defaultValue: DEFAULT_SETTINGS.apiKey
            }
          },
          {
            name: 'Test connection',
            desc: 'Test your connection to the Immich server.',
            render: setting => {
              setting.addButton(btn => btn
                .setButtonText('Test connection')
                .setCta()
                .onClick(() => void this.testConnection()))
            }
          },
          {
            name: 'Mobile quick access',
            desc: createFragment(frag => {
              frag.appendText('The Immich icon is already in the ≡ menu. To reach it from the keyboard toolbar instead, see ')
              frag.createEl('a', {
                text: 'Mobile',
                href: 'https://github.com/eikowagenknecht/obsidian-immich-picker#mobile'
              })
              frag.appendText(' in the README.')
            }),
            visible: Platform.isMobile,
            render: () => { /* description only */ }
          }
        ]
      },
      {
        type: 'group',
        heading: 'Photo picker',
        items: [
          {
            name: 'Photos per page',
            desc: 'Number of photos to load at a time (recent, search results, and "load next")',
            control: {
              type: 'number',
              key: 'recentPhotosCount',
              min: 1,
              defaultValue: DEFAULT_SETTINGS.recentPhotosCount
            }
          },
          {
            name: 'Grid columns',
            desc: 'Number of columns in the photo grid',
            control: {
              type: 'number',
              key: 'gridColumns',
              min: 1,
              max: 10,
              defaultValue: DEFAULT_SETTINGS.gridColumns
            }
          },
          {
            name: 'Include archived photos',
            desc: createFragment(frag => {
              frag.appendText('Show photos archived in Immich in recent, search and date results.')
              frag.createEl('br')
              frag.appendText('Archived photos are always visible when browsing albums.')
            }),
            control: {
              type: 'toggle',
              key: 'includeArchived',
              defaultValue: DEFAULT_SETTINGS.includeArchived
            }
          }
        ]
      },
      {
        type: 'group',
        heading: 'Image mode',
        items: [
          {
            name: 'How to store images',
            desc: createFragment(frag => {
              frag.appendText('Local: downloads thumbnail files into your vault.')
              frag.createEl('br')
              frag.appendText('Remote: images are fetched live from Immich when rendering (no files saved, requires this plugin).')
              frag.createEl('br')
              frag.appendText('Shared: creates public Immich shared links (works without the plugin, but the URLs are public).')
            }),
            control: {
              type: 'dropdown',
              key: 'imageMode',
              options: {
                local: 'Download to vault',
                remote: 'Load from Immich server',
                shared: 'Use Immich shared links'
              },
              defaultValue: DEFAULT_SETTINGS.imageMode
            }
          },
          {
            name: 'Remote image format',
            desc: createFragment(frag => {
              frag.appendText('Server link: standard markdown image. Shows a broken image outside Obsidian.')
              frag.createEl('br')
              frag.appendText('Code block: Obsidian-only rendering. Shows text outside Obsidian.')
              frag.createEl('br')
              frag.appendText('Use the "Convert Immich images" command to move existing notes between formats.')
            }),
            visible: () => this.plugin.settings.imageMode === 'remote',
            control: {
              type: 'dropdown',
              key: 'remoteFormat',
              options: {
                'server-url': 'Server link (recommended)',
                'code-block': 'Code block'
              },
              defaultValue: DEFAULT_SETTINGS.remoteFormat
            }
          },
          {
            name: 'Render in edit mode',
            desc: 'Show images inline while editing. Turn off for standard behavior.',
            visible: () => this.plugin.settings.imageMode === 'remote',
            control: {
              type: 'toggle',
              key: 'renderInEditMode',
              defaultValue: DEFAULT_SETTINGS.renderInEditMode
            }
          },
          {
            name: 'Display width',
            desc: 'Default width for inserted images. The picker can override it per image.',
            control: {
              type: 'dropdown',
              key: 'displayWidth',
              options: {
                0: 'Original size',
                200: '200px',
                400: '400px',
                600: '600px',
                800: '800px'
              },
              defaultValue: String(DEFAULT_SETTINGS.displayWidth)
            }
          }
        ]
      },
      {
        type: 'group',
        heading: 'Note date detection',
        items: [
          {
            name: 'Get date from',
            desc: 'Where to extract the date for filtering photos',
            control: {
              type: 'dropdown',
              key: 'getDateFrom',
              options: {
                none: 'Disabled',
                title: 'Note title',
                frontmatter: 'Frontmatter property'
              },
              defaultValue: DEFAULT_SETTINGS.getDateFrom
            }
          },
          {
            name: 'Frontmatter key',
            desc: 'The frontmatter property containing the date',
            visible: () => this.plugin.settings.getDateFrom === 'frontmatter',
            control: {
              type: 'text',
              key: 'getDateFromFrontMatterKey',
              placeholder: DEFAULT_SETTINGS.getDateFromFrontMatterKey,
              defaultValue: DEFAULT_SETTINGS.getDateFromFrontMatterKey
            }
          },
          {
            name: 'Date format',
            desc: createFragment(frag => {
              frag.appendText('Expected date format in title/frontmatter (')
              frag.createEl('a', {
                text: 'Moment.js format',
                href: 'https://momentjs.com/docs/#/displaying/format/'
              })
              frag.appendText(').')
            }),
            visible: () => this.plugin.settings.getDateFrom !== 'none',
            control: {
              type: 'text',
              key: 'getDateFromFormat',
              placeholder: DEFAULT_SETTINGS.getDateFromFormat,
              defaultValue: DEFAULT_SETTINGS.getDateFromFormat
            }
          }
        ]
      },
      // Thumbnail and storage settings only apply when files are downloaded.
      ...(this.plugin.settings.imageMode === 'local' ? this.localStorageGroups() : []),
      // Remote mode writes a fixed format, so there is no template to pick.
      ...(this.plugin.settings.imageMode === 'remote'
        ? [{
            type: 'group' as const,
            heading: 'Output format',
            items: [this.remoteFormatInfo()]
          }]
        : this.templateGroups()),
      {
        type: 'group',
        heading: 'Pasted links',
        items: [this.pastedLinkToggle()]
      }
    ]
  }

  /** Only rendered in local mode, where thumbnails are written to the vault. */
  private localStorageGroups (): SettingDefinitionItem[] {
    return [
      {
        type: 'group',
        heading: 'Thumbnails',
        items: [
          {
            name: 'Thumbnail width',
            desc: 'Maximum width of the locally-saved thumbnail image in pixels',
            control: {
              type: 'number',
              key: 'thumbnailWidth',
              min: 1,
              defaultValue: DEFAULT_SETTINGS.thumbnailWidth
            }
          },
          {
            name: 'Thumbnail height',
            desc: 'Maximum height of the locally-saved thumbnail image in pixels',
            control: {
              type: 'number',
              key: 'thumbnailHeight',
              min: 1,
              defaultValue: DEFAULT_SETTINGS.thumbnailHeight
            }
          },
          {
            // Rendered imperatively to keep the live filename preview.
            name: 'Image filename format',
            render: setting => {
              setting.descEl.appendText('Filename format for saving thumbnails (')
              setting.descEl.createEl('a', {
                text: 'Moment.js format',
                href: 'https://momentjs.com/docs/#/displaying/format/'
              })
              setting.descEl.appendText(').')
              setting.descEl.createEl('br')
              setting.descEl.createEl('br')
              setting.descEl.appendText('Preview: ')
              const previewEl = setting.descEl.createEl('code', { cls: 'immich-filename-preview' })
              this.updateFilenamePreview(previewEl, this.plugin.settings.filename)

              setting.addText(text => text
                .setPlaceholder(DEFAULT_SETTINGS.filename)
                .setValue(this.plugin.settings.filename)
                .onChange(async value => {
                  this.plugin.settings.filename = value.trim()
                  await this.plugin.saveSettings()
                  this.updateFilenamePreview(previewEl, value.trim())
                }))
            }
          }
        ]
      },
      {
        type: 'group',
        heading: 'Storage location',
        items: [
          {
            name: 'Location to save thumbnails',
            desc: 'Where the local thumbnail images will be saved',
            control: {
              type: 'dropdown',
              key: 'locationOption',
              options: {
                note: 'Same folder as the note',
                subfolder: 'In a subfolder of the current note',
                specified: 'In a specific folder'
              },
              defaultValue: DEFAULT_SETTINGS.locationOption
            }
          },
          {
            name: 'Thumbnail image folder',
            desc: 'Thumbnails will be saved to this folder',
            visible: () => this.plugin.settings.locationOption === 'specified',
            control: {
              type: 'folder',
              key: 'locationFolder',
              placeholder: 'Path/for/thumbnails',
              defaultValue: DEFAULT_SETTINGS.locationFolder
            }
          },
          {
            name: 'Subfolder name',
            desc: 'Subfolder within the current note\'s folder',
            visible: () => this.plugin.settings.locationOption === 'subfolder',
            control: {
              type: 'text',
              key: 'locationSubfolder',
              placeholder: 'Photos',
              defaultValue: DEFAULT_SETTINGS.locationSubfolder
            }
          }
        ]
      },
    ]
  }

  /**
   * Local and shared modes both fill a template. Rendered as a list of named
   * templates plus the rules that pick between them, so a vault can keep a
   * linked thumbnail for ordinary notes and a plain embed for notes that get
   * published elsewhere.
   */
  private templateGroups (): SettingDefinitionItem[] {
    const templates = this.plugin.settings.outputTemplates
    // Nothing to choose between, and nothing to route to, until there are two.
    const hasChoice = () => this.plugin.settings.outputTemplates.length > 1

    return [
      {
        type: 'list',
        heading: 'Output templates',
        // Keeps the `.immich-picker-settings textarea` rule in styles.css applying.
        cls: 'immich-picker-settings',
        items: templates.map(template => this.templatePage(template)),
        addItem: {
          name: 'Add template',
          action: () => { void this.addTemplate() }
        },
        onReorder: (oldIndex, newIndex) => { void this.reorderTemplates(oldIndex, newIndex) },
        onDelete: index => { void this.deleteTemplate(index) }
      },
      {
        type: 'group',
        visible: hasChoice,
        items: [
          {
            name: 'Default template',
            desc: 'Used for notes no folder rule matches, and pre-selected in the picker.',
            control: {
              type: 'dropdown',
              key: 'defaultTemplateId',
              options: Object.fromEntries(templates.map(t => [t.id, t.name || 'Unnamed template'])),
              defaultValue: this.plugin.settings.defaultTemplateId
            }
          }
        ]
      },
      {
        type: 'list',
        heading: 'Folder rules',
        visible: hasChoice,
        emptyState: 'No rules. Every note uses the default template.',
        items: this.plugin.settings.folderTemplateRules.map(rule => this.folderRuleRow(rule)),
        addItem: {
          name: 'Add folder rule',
          action: () => { void this.addFolderRule() }
        },
        onDelete: index => { void this.deleteFolderRule(index) }
      },
      {
        type: 'group',
        visible: hasChoice,
        items: [
          {
            name: 'How templates are chosen',
            desc: createFragment(frag => {
              frag.appendText('Deepest matching folder rule wins, otherwise the default template is used. ')
              frag.appendText('The picker shows the resolved choice and lets you override it for a single insert.')
            }),
            render: () => { /* description only */ }
          }
        ]
      }
    ]
  }

  /** One template, edited on its own page so the textarea has room. */
  private templatePage (template: OutputTemplate): SettingDefinitionPage {
    return {
      type: 'page',
      name: template.name || 'Unnamed template',
      displayValue: () => template.template.replace(/\s+/g, ' ').trim().slice(0, 40),
      items: [
        {
          name: 'Name',
          desc: 'Shown in the picker and in the folder rules below.',
          control: {
            type: 'text',
            key: `template:${template.id}:name`,
            placeholder: 'Publish-safe',
            defaultValue: template.name
          }
        },
        {
          name: 'Inserted Markdown',
          desc: createFragment(frag => {
            frag.appendText('The Markdown text inserted when adding a photo. Available variables:')
            const ul = frag.createEl('ul')
            ul.createEl('li', { text: 'local_thumbnail_link - path to the local thumbnail (the shared URL in shared mode)' })
            ul.createEl('li', { text: 'immich_thumbnail_url - the thumbnail URL on the server' })
            ul.createEl('li', { text: 'immich_url - URL to the photo in Immich' })
            ul.createEl('li', { text: 'immich_asset_id - the Immich asset ID' })
            ul.createEl('li', { text: 'original_filename - original filename from Immich' })
            ul.createEl('li', { text: 'taken_date - date the photo was taken' })
            ul.createEl('li', { text: 'description - photo description from Immich' })
            ul.createEl('li', { text: 'display_width - image width from settings (e.g. |400)' })
            frag.createEl('br')
            frag.appendText('Include immich_url or immich_thumbnail_url if you want "Convert Immich images" to find these images later. ')
            frag.appendText('A trailing ')
            frag.createEl('code', { text: '<!--immich: {{immich_url}}-->' })
            frag.appendText(' comment counts, and keeps the embed itself a plain one for publish plugins.')
          }),
          control: {
            type: 'textarea',
            key: `template:${template.id}:body`,
            placeholder: DEFAULT_TEMPLATE_MARKDOWN,
            defaultValue: template.template
          }
        }
      ]
    }
  }

  /**
   * A folder rule needs two controls on one row, which the declarative
   * controls cannot express, so it is built by hand. The row closes over the
   * rule object rather than its index, so deleting another rule cannot make
   * this one write to the wrong entry.
   */
  private folderRuleRow (rule: FolderTemplateRule): SettingGroupItem {
    return {
      name: 'Notes in',
      searchable: false,
      render: setting => {
        setting.addSearch(search => {
          new FolderSuggest(this.app, search.inputEl)
          search
            .setPlaceholder('Blog/posts')
            .setValue(rule.folder)
            .onChange(async value => {
              rule.folder = value.trim().replace(/^\/+|\/+$/g, '')
              await this.plugin.saveSettings()
            })
        })
        setting.addDropdown(dropdown => {
          for (const template of this.plugin.settings.outputTemplates) {
            dropdown.addOption(template.id, template.name || 'Unnamed template')
          }
          dropdown
            .setValue(rule.templateId)
            .onChange(async value => {
              rule.templateId = value
              await this.plugin.saveSettings()
            })
        })
      }
    }
  }

  private async addTemplate (): Promise<void> {
    const templates = this.plugin.settings.outputTemplates
    templates.push({
      id: newTemplateId(templates),
      name: `Template ${templates.length + 1}`,
      template: DEFAULT_TEMPLATE_MARKDOWN
    })
    await this.plugin.saveSettings()
    this.rebuild()
  }

  private async reorderTemplates (oldIndex: number, newIndex: number): Promise<void> {
    const templates = this.plugin.settings.outputTemplates
    if (oldIndex < 0 || oldIndex >= templates.length) return
    const [moved] = templates.splice(oldIndex, 1)
    templates.splice(newIndex, 0, moved)
    await this.plugin.saveSettings()
    this.rebuild()
  }

  private async deleteTemplate (index: number): Promise<void> {
    const settings = this.plugin.settings
    // Something has to be inserted, so the last template cannot go away.
    if (settings.outputTemplates.length <= 1) {
      new Notice('Keep at least one output template')
      this.rebuild()
      return
    }

    if (index < 0 || index >= settings.outputTemplates.length) return
    settings.outputTemplates.splice(index, 1)
    // Repoints the default and any rules that named it.
    normalizeTemplateSettings(settings)
    await this.plugin.saveSettings()
    this.rebuild()
  }

  private async addFolderRule (): Promise<void> {
    this.plugin.settings.folderTemplateRules.push({
      folder: '',
      templateId: this.plugin.settings.defaultTemplateId
    })
    await this.plugin.saveSettings()
    this.rebuild()
  }

  private async deleteFolderRule (index: number): Promise<void> {
    this.plugin.settings.folderTemplateRules.splice(index, 1)
    await this.plugin.saveSettings()
    this.rebuild()
  }

  /**
   * Re-reads getSettingDefinitions() after the definitions themselves changed
   * — a template added or removed changes how many rows there are, and which
   * of the dependent groups are visible at all. update() is the only thing
   * that refreshes a declarative tab; display() is deprecated and does not.
   */
  private rebuild (): void {
    this.update()
  }

  /** Remote mode writes a fixed format, so there is nothing to edit. */
  private remoteFormatInfo (): SettingGroupItem {
    const isCodeBlock = this.plugin.settings.remoteFormat === 'code-block'
    return {
      name: 'Inserted Markdown',
      desc: createFragment(frag => {
        frag.appendText('Remote mode uses a fixed format (not customizable):')
        frag.createEl('br')
        frag.createEl('code', {
          text: isCodeBlock ? '```immich <asset id> ```' : '![](<server>/api/assets/<asset id>/thumbnail)'
        })
        frag.createEl('br')
        frag.appendText(isCodeBlock
          ? 'The code block processor fetches the image and renders it at read time.'
          : 'The plugin re-fetches this URL with your API key when rendering, since Obsidian cannot send the key itself.')
      }),
      render: () => { /* description only */ }
    }
  }

  private pastedLinkToggle (): SettingGroupItem {
    return {
      name: 'Convert pasted Immich links',
      desc: createFragment(frag => {
        frag.appendText('When pasting an Immich photo URL (e.g., ')
        frag.createEl('code', { text: 'https://immich.example.com/photos/abc-123' })
        frag.appendText('), automatically download the thumbnail and insert it as markdown instead of pasting the plain URL.')
      }),
      control: {
        type: 'toggle',
        key: 'convertPastedLink',
        defaultValue: DEFAULT_SETTINGS.convertPastedLink
      }
    }
  }

  /**
   * The two fields of a template are addressed as `template:<id>:name` and
   * `template:<id>:body`, since the declarative controls key into a flat
   * settings object and templates live in an array.
   */
  private templateField (key: string): { template: OutputTemplate, field: 'name' | 'body' } | null {
    const match = /^template:(.+):(name|body)$/.exec(key)
    if (!match) return null
    const template = this.plugin.settings.outputTemplates.find(t => t.id === match[1])
    return template ? { template, field: match[2] as 'name' | 'body' } : null
  }

  getControlValue (key: string): unknown {
    // The API key lives in the OS credential manager, not in settings. It is
    // cached at load, so it can still be read synchronously here.
    if (key === 'apiKey') return this.plugin.cachedApiKey
    if (key === 'displayWidth') return String(this.plugin.settings.displayWidth)

    const field = this.templateField(key)
    if (field) return field.field === 'name' ? field.template.name : field.template.template

    return this.plugin.settings[key as keyof ImmichPickerSettings]
  }

  async setControlValue (key: string, value: unknown): Promise<void> {
    if (key === 'apiKey') {
      await this.plugin.setApiKey(this.normalize(key, String(value)))
      // Thumbnails fetched with the previous key may no longer be valid.
      clearImmichBlobCache()
      return
    }

    const field = this.templateField(key)
    if (field) {
      if (field.field === 'name') {
        field.template.name = String(value).trim()
      } else {
        field.template.template = String(value)
      }
      // Deliberately no re-render: this runs per keystroke, and the places a
      // name is echoed (the list entry, the dropdowns) are rebuilt when the
      // user navigates back out of the page anyway.
      await this.plugin.saveSettings()
      return
    }

    const normalized = typeof value === 'string' ? this.normalize(key, value) : value
    Object.assign(this.plugin.settings, {
      // The dropdown hands back strings; the rest of the plugin does arithmetic on it.
      [key]: key === 'displayWidth' ? Number(normalized) : normalized
    })
    await this.plugin.saveSettings()

    if (key === 'serverUrl') {
      // Cached thumbnails belong to the old server.
      clearImmichBlobCache()
    }

    // Image mode adds and removes whole groups, so the definitions have to be
    // rebuilt. The rest only drive `visible` predicates already in the DOM.
    if (key === 'imageMode' || key === 'remoteFormat') {
      this.rebuild()
    } else if (key === 'getDateFrom' || key === 'locationOption') {
      this.refreshDomState()
    }
  }

  /** Mirrors the input cleanup the imperative display() fallback performs. */
  private normalize (key: string, value: string): string {
    switch (key) {
      case 'serverUrl':
        return value.trim().replace(/\/+$/, '')
      case 'locationSubfolder':
        return value.trim().replace(/^[\\/]+/, '').replace(/[\\/]+$/, '')
      case 'apiKey':
      case 'filename':
      case 'getDateFromFrontMatterKey':
      case 'getDateFromFormat':
        return value.trim()
      default:
        return value
    }
  }

  private async testConnection (): Promise<void> {
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
  }

  updateFilenamePreview (el: HTMLElement, format: string): void {
    el.removeClass('is-muted', 'is-error')
    if (!format.trim()) {
      el.setText('Enter a format')
      el.addClass('is-muted')
      return
    }
    try {
      const preview = window.moment().format(format)
      el.setText(preview)
    } catch {
      el.setText('Invalid format')
      el.addClass('is-error')
    }
  }
}
