import { AbstractInputSuggest, App, TAbstractFile, TFolder } from 'obsidian'

export class FolderSuggest extends AbstractInputSuggest<TFolder> {
  private textInputEl: HTMLInputElement

  constructor (app: App, inputEl: HTMLInputElement) {
    super(app, inputEl)
    this.textInputEl = inputEl
  }

  getSuggestions (inputStr: string): TFolder[] {
    const abstractFiles = this.app.vault.getAllLoadedFiles()
    const folders: TFolder[] = []
    const lowerCaseInputStr = inputStr.toLowerCase()

    abstractFiles.forEach((folder: TAbstractFile) => {
      if (
        folder instanceof TFolder &&
        folder.path.toLowerCase().contains(lowerCaseInputStr)
      ) {
        folders.push(folder)
      }
    })

    return folders
  }

  renderSuggestion (file: TFolder, el: HTMLElement): void {
    el.setText(file.path)
  }

  selectSuggestion (file: TFolder): void {
    this.textInputEl.value = file.path
    this.textInputEl.trigger('input')
    this.close()
  }
}
