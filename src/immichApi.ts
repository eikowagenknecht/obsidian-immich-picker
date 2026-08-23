import { moment, requestUrl } from 'obsidian'
import ImmichPicker from './main'

export interface ImmichAsset {
  id: string;
  originalFileName: string;
  fileCreatedAt: string;
  /**
   * Wall clock time where the photo was taken, sent as an ISO string with a
   * `Z` suffix that must not be converted: `2025-09-09T14:23:00.000Z` means
   * 14:23 local to the camera, whatever its offset was.
   */
  localDateTime?: string;
  type: string;
  description?: string;
}

export interface ImmichAssetDetails {
  id: string;
  originalFileName?: string;
  fileCreatedAt?: string;
  exifInfo?: {
    description?: string;
    exifImageWidth?: number;
    exifImageHeight?: number;
  };
}

export interface ImmichSearchResponse {
  assets: {
    items: ImmichAsset[];
    count: number;
  };
}

export interface ImmichAlbum {
  id: string;
  albumName: string;
  assetCount: number;
  albumThumbnailAssetId?: string;
  updatedAt: string;
}

export interface ImmichSharedLink {
  id: string;
  key: string;
  type: string;
  assets: ImmichAsset[];
}

/** Widest real UTC offsets, used to bracket a calendar day in absolute time. */
const MAX_UTC_OFFSET_HOURS = 14
const MIN_UTC_OFFSET_HOURS = -12

/** Immich caps `size` at 1000; smaller pages keep a single day responsive. */
const DATE_SEARCH_PAGE_SIZE = 250
/** Stop runaway paging on absurdly busy days rather than hammering the server. */
const DATE_SEARCH_MAX_PAGES = 20

/**
 * The calendar day an asset was taken on, in the camera's time zone. Immich
 * labels `localDateTime` with a `Z` it does not mean, so it is read as UTC to
 * get the wall clock back. Servers old enough to omit it fall back to the
 * absolute time read in the vault's time zone.
 */
function localDay (asset: ImmichAsset): string {
  return asset.localDateTime
    ? window.moment.utc(asset.localDateTime).format('YYYY-MM-DD')
    : window.moment(asset.fileCreatedAt).format('YYYY-MM-DD')
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
    return this.plugin.cachedApiKey || this.plugin.settings.apiKey
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

  private async search (endpoint: string, body: Record<string, unknown>, errorLabel: string): Promise<ImmichAsset[]> {
    const response = await requestUrl({
      url: `${this.serverUrl}${endpoint}`,
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body)
    })

    if (response.status !== 200) {
      throw new Error(`${errorLabel}: ${response.status}`)
    }

    const data = response.json as ImmichSearchResponse
    return data.assets?.items || []
  }

  /**
   * Immich searches filter on a single visibility value, so timeline plus
   * archived takes two requests. The value is always sent explicitly because
   * the server default changed between versions: 1.133+ returns `timeline`
   * only, while 3.x returns everything that is not locked.
   *
   * `order` re-sorts the merged pages. Smart search has no such key, so its
   * archived hits are appended and each half keeps its relevance order.
   */
  private async searchVisible (
    endpoint: string,
    body: Record<string, unknown>,
    errorLabel: string,
    order?: 'asc' | 'desc'
  ): Promise<ImmichAsset[]> {
    if (!this.plugin.settings.includeArchived) {
      return this.search(endpoint, { ...body, visibility: 'timeline' }, errorLabel)
    }

    // Every asset has exactly one visibility, so the two pages never overlap.
    const [timeline, archived] = await Promise.all([
      this.search(endpoint, { ...body, visibility: 'timeline' }, errorLabel),
      this.search(endpoint, { ...body, visibility: 'archive' }, errorLabel)
    ])

    const merged = [...timeline, ...archived]
    if (order) {
      merged.sort((a, b) => {
        const diff = new Date(a.fileCreatedAt).getTime() - new Date(b.fileCreatedAt).getTime()
        return order === 'asc' ? diff : -diff
      })
    }
    return merged
  }

  /**
   * Page a search to exhaustion. Each visibility is paged on its own so a
   * short page ends only that half, instead of the merged length making both
   * look finished.
   */
  private async searchAllPages (
    endpoint: string,
    body: Record<string, unknown>,
    errorLabel: string
  ): Promise<ImmichAsset[]> {
    const visibilities = this.plugin.settings.includeArchived
      ? ['timeline', 'archive']
      : ['timeline']

    const pageSize = typeof body.size === 'number' ? body.size : DATE_SEARCH_PAGE_SIZE
    const pages = await Promise.all(visibilities.map(async visibility => {
      const items: ImmichAsset[] = []
      for (let page = 1; page <= DATE_SEARCH_MAX_PAGES; page++) {
        const batch = await this.search(endpoint, { ...body, visibility, page }, errorLabel)
        items.push(...batch)
        if (batch.length < pageSize) break
      }
      return items
    }))

    return pages.flat()
  }

  async getRecentPhotos (count: number, page = 1): Promise<ImmichAsset[]> {
    return this.searchVisible(
      '/api/search/metadata',
      {
        page,
        size: count,
        type: 'IMAGE',
        order: 'desc'
      },
      'Failed to fetch photos',
      'desc'
    )
  }

  async searchPhotos (query: string, count: number, page = 1): Promise<ImmichAsset[]> {
    return this.searchVisible(
      '/api/search/smart',
      {
        query,
        page,
        size: count
      },
      'Failed to search photos'
    )
  }

  /**
   * Every photo taken on the given calendar day, in the camera's own time zone.
   *
   * `takenAfter`/`takenBefore` compare against `fileCreatedAt`, the absolute
   * instant, so day boundaries built from the vault's time zone cut the wrong
   * window for photos taken elsewhere: a New Zealand vault asking for a day in
   * Spain used to get 14:00 to 14:00 (#10). The server has no filter on the
   * asset's own local date, so instead we ask for every instant that could
   * belong to that day anywhere on earth (UTC-12 to UTC+14) and keep the
   * assets whose `localDateTime` lands on it.
   */
  async getPhotosByDate (date: moment.Moment): Promise<ImmichAsset[]> {
    const targetDay = date.format('YYYY-MM-DD')
    const dayStartUtc = window.moment.utc(targetDay, 'YYYY-MM-DD')
    const dayEndUtc = dayStartUtc.clone().add(1, 'day').subtract(1, 'millisecond')

    // An instant is `local time - offset`, so the widest bracket subtracts the
    // largest offset from the day's start and the smallest from its end.
    const takenAfter = dayStartUtc.clone().subtract(MAX_UTC_OFFSET_HOURS, 'hours').toISOString()
    const takenBefore = dayEndUtc.clone().subtract(MIN_UTC_OFFSET_HOURS, 'hours').toISOString()

    const candidates = await this.searchAllPages(
      '/api/search/metadata',
      {
        size: DATE_SEARCH_PAGE_SIZE,
        type: 'IMAGE',
        takenAfter,
        takenBefore,
        order: 'asc'
      },
      'Failed to fetch photos by date'
    )

    return candidates
      .filter(asset => localDay(asset) === targetDay)
      .sort((a, b) => new Date(a.fileCreatedAt).getTime() - new Date(b.fileCreatedAt).getTime())
  }

  getThumbnailUrl (assetId: string): string {
    // #.jpg fragment hints to Obsidian's parser that this is an image (doesn't affect HTTP request)
    return `${this.serverUrl}/api/assets/${assetId}/thumbnail?size=preview#.jpg`
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

  async getAssetDetails (assetId: string): Promise<ImmichAssetDetails> {
    const response = await requestUrl({
      url: `${this.serverUrl}/api/assets/${assetId}`,
      method: 'GET',
      headers: this.getHeaders()
    })

    if (response.status !== 200) {
      throw new Error(`Failed to get asset details: ${response.status}`)
    }

    return response.json as ImmichAssetDetails
  }

  async getAlbums (): Promise<ImmichAlbum[]> {
    const response = await requestUrl({
      url: `${this.serverUrl}/api/albums`,
      method: 'GET',
      headers: this.getHeaders()
    })

    if (response.status !== 200) {
      throw new Error(`Failed to fetch albums: ${response.status}`)
    }

    return response.json as ImmichAlbum[]
  }

  async getAlbumAssets (albumId: string): Promise<ImmichAsset[]> {
    const response = await requestUrl({
      url: `${this.serverUrl}/api/albums/${albumId}`,
      method: 'GET',
      headers: this.getHeaders()
    })

    if (response.status !== 200) {
      throw new Error(`Failed to fetch album assets: ${response.status}`)
    }

    const album = response.json as { assets: ImmichAsset[] }
    return album.assets || []
  }

  async createSharedLink (assetId: string): Promise<ImmichSharedLink> {
    const response = await requestUrl({
      url: `${this.serverUrl}/api/shared-links`,
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        type: 'INDIVIDUAL',
        assetIds: [assetId]
      })
    })

    if (response.status !== 200 && response.status !== 201) {
      throw new Error(`Failed to create shared link: ${response.status}`)
    }

    return response.json as ImmichSharedLink
  }

  getSharedThumbnailUrl (assetId: string, shareKey: string): string {
    // Same #.jpg hint as getThumbnailUrl, so Obsidian's parser treats a shared
    // URL as an image too.
    return `${this.serverUrl}/api/assets/${assetId}/thumbnail?size=preview&key=${shareKey}#.jpg`
  }

  extractAssetIdFromUrl (url: string): string | null {
    // Match pattern: {serverUrl}/photos/{uuid}
    const serverUrlPattern = this.serverUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`${serverUrlPattern}/photos/([a-f0-9-]+)`, 'i')
    const match = url.match(pattern)
    return match ? match[1] : null
  }
}
