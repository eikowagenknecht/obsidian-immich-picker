import { requestUrl } from 'obsidian'
import ImmichPicker from './main'

export interface ImmichAsset {
  id: string;
  originalFileName: string;
  fileCreatedAt: string;
  type: string;
}

export interface ImmichSearchResponse {
  assets: {
    items: ImmichAsset[];
    count: number;
  };
}

export class ImmichApi {
  plugin: ImmichPicker

  constructor (plugin: ImmichPicker) {
    this.plugin = plugin
  }

  private get serverUrl (): string {
    return this.plugin.settings.serverUrl
  }

  private get apiKey (): string {
    return this.plugin.settings.apiKey
  }

  private getHeaders (): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      'Content-Type': 'application/json'
    }
  }

  async testConnection (): Promise<boolean> {
    if (!this.serverUrl || !this.apiKey) {
      return false
    }

    try {
      const response = await requestUrl({
        url: `${this.serverUrl}/api/server/ping`,
        method: 'GET',
        headers: this.getHeaders()
      })
      return response.status === 200
    } catch (e) {
      console.error('Immich connection test failed:', e)
      return false
    }
  }

  async getRecentPhotos (count: number): Promise<ImmichAsset[]> {
    const response = await requestUrl({
      url: `${this.serverUrl}/api/search/metadata`,
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        page: 1,
        size: count,
        type: 'IMAGE',
        order: 'desc'
      })
    })

    if (response.status !== 200) {
      throw new Error(`Failed to fetch photos: ${response.status}`)
    }

    const data = response.json as ImmichSearchResponse
    return data.assets?.items || []
  }

  getThumbnailUrl (assetId: string): string {
    return `${this.serverUrl}/api/assets/${assetId}/thumbnail?size=preview`
  }

  getAssetUrl (assetId: string): string {
    return `${this.serverUrl}/photos/${assetId}`
  }

  async downloadThumbnail (assetId: string): Promise<ArrayBuffer> {
    const response = await requestUrl({
      url: this.getThumbnailUrl(assetId),
      method: 'GET',
      headers: {
        'x-api-key': this.apiKey
      }
    })

    if (response.status !== 200) {
      throw new Error(`Failed to download thumbnail: ${response.status}`)
    }

    return response.arrayBuffer
  }

  extractAssetIdFromUrl (url: string): string | null {
    // Match pattern: {serverUrl}/photos/{uuid}
    const serverUrlPattern = this.serverUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`${serverUrlPattern}/photos/([a-f0-9-]+)`, 'i')
    const match = url.match(pattern)
    return match ? match[1] : null
  }
}
