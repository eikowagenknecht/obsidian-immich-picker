import { AbstractInputSuggest, App } from 'obsidian'

export class TagSuggest extends AbstractInputSuggest<string> {
  private textInputEl: HTMLInputElement

  constructor (app: App, inputEl: HTMLInputElement) {
    super(app, inputEl)
    this.textInputEl = inputEl
  }

  getSuggestions (inputStr: string): string[] {
    const lowerInput = inputStr.toLowerCase().replace(/^#/, '')
    const tagCounts = (this.app.metadataCache as unknown as { getTags(): Record<string, number> }).getTags()
    const tags = Object.keys(tagCounts)
      .filter(tag => tag.toLowerCase().contains(lowerInput))
      .sort((a, b) => (tagCounts[b] || 0) - (tagCounts[a] || 0))

    return tags.slice(0, 20)
  }

  renderSuggestion (tag: string, el: HTMLElement): void {
    el.setText(tag)
  }

  selectSuggestion (tag: string): void {
    this.textInputEl.value = tag
    this.textInputEl.trigger('input')
    this.close()
  }
}
