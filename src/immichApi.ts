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
  visibility?: string;
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
    /** Only filled by structured searches (3.2+). */
    nextCursor?: string | null;
  };
}

export interface AssetPage {
  assets: ImmichAsset[];
  /** Opaque token for the next page, or null on the last one. */
  next: string | null;
}

interface SearchPage {
  items: ImmichAsset[];
  nextCursor: string | null;
}

interface ImmichServerVersion {
  major: number;
  minor: number;
  patch: number;
}

export interface ImmichAlbum {
  id: string;
  albumName: string;
  assetCount: number;
  albumThumbnailAssetId?: string;
  updatedAt: string;
  order?: 'asc' | 'desc';
}

/**
 * The request shapes a server understands, derived from its version.
 *
 * - `legacy` (before 3.0): flat search fields, album responses list their assets.
 * - `flat` (3.0 and 3.1): flat search fields, album responses no longer list assets.
 * - `filter` (3.2 and later): structured `filter`/`orderBy`/`cursor` searches.
 *   The flat fields still work there but are deprecated for removal in v4.
 */
type ApiShape = 'legacy' | 'flat' | 'filter'

export interface ImmichSharedLink {
  id: string;
  key: string;
  type: string;
  assets: ImmichAsset[];
}

/** Widest real UTC offsets, used to bracket a calendar day in absolute time. */
const MAX_UTC_OFFSET_HOURS = 14
const MIN_UTC_OFFSET_HOURS = -12

/** Immich caps a search's `size` at 1000. */
const MAX_SEARCH_SIZE = 1000
/** Smaller pages keep a single day responsive. */
const DATE_SEARCH_PAGE_SIZE = 250
/** Stop runaway paging on absurdly busy days rather than hammering the server. */
const DATE_SEARCH_MAX_PAGES = 20

function byFileCreatedAt (order: 'asc' | 'desc') {
  return (a: ImmichAsset, b: ImmichAsset): number => {
    const diff = new Date(a.fileCreatedAt).getTime() - new Date(b.fileCreatedAt).getTime()
    return order === 'asc' ? diff : -diff
  }
}

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
  private apiShape: { serverUrl: string, shape: Promise<ApiShape> } | null = null

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

  /**
   * The server's request shapes, looked up once per server URL. Sniffing
   * responses cannot replace this: 3.0 and 3.1 silently drop an unknown
   * `filter` key and answer with an unfiltered search.
   */
  private getApiShape (): Promise<ApiShape> {
    const serverUrl = this.serverUrl
    if (this.apiShape?.serverUrl === serverUrl) {
      return this.apiShape.shape
    }

    const shape = this.fetchApiShape()
    const entry = { serverUrl, shape }
    this.apiShape = entry
    // Forget a failed lookup so the next request tries again.
    void shape.catch(() => {
      if (this.apiShape === entry) this.apiShape = null
    })
    return shape
  }

  private async fetchApiShape (): Promise<ApiShape> {
    const response = await requestUrl({
      url: `${this.serverUrl}/api/server/version`,
      method: 'GET',
      headers: this.getHeaders()
    })

    if (response.status !== 200) {
      throw new Error(`Failed to get server version: ${response.status}`)
    }

    const { major, minor } = response.json as ImmichServerVersion
    if (major < 3) return 'legacy'
    if (major === 3 && minor < 2) return 'flat'
    return 'filter'
  }

  private get visibilities (): string[] {
    return this.plugin.settings.includeArchived ? ['timeline', 'archive'] : ['timeline']
  }

  private async search (endpoint: string, body: Record<string, unknown>, errorLabel: string): Promise<SearchPage> {
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
    return {
      items: data.assets?.items || [],
      nextCursor: data.assets?.nextCursor ?? null
    }
  }

  /**
   * One page of a flat-field search (before 3.2). Flat searches filter on a
   * single visibility value, so timeline plus archived takes two requests. The
   * value is always sent explicitly because the server default changed between
   * versions: 1.133+ returns `timeline` only, while 3.x returns everything that
   * is not locked.
   *
   * `order` re-sorts the merged pages. Smart search has no such key, so its
   * archived hits are appended and each half keeps its relevance order.
   */
  private async searchFlatPage (
    endpoint: string,
    body: Record<string, unknown>,
    size: number,
    page: number,
    errorLabel: string,
    order?: 'asc' | 'desc'
  ): Promise<AssetPage> {
    // Every asset has exactly one visibility, so the halves never overlap.
    const halves = await Promise.all(this.visibilities.map(visibility =>
      this.search(endpoint, { ...body, size, page, visibility }, errorLabel)
    ))

    const assets = halves.flatMap(half => half.items)
    if (order) assets.sort(byFileCreatedAt(order))

    const hasMore = halves.some(half => half.items.length === size)
    return { assets, next: hasMore ? String(page + 1) : null }
  }

  /**
   * Page a flat-field search to exhaustion. Each visibility is paged on its own
   * so a short page ends only that half, instead of the merged length making
   * both look finished.
   */
  private async searchFlatAll (
    endpoint: string,
    body: Record<string, unknown>,
    size: number,
    errorLabel: string,
    maxPages: number
  ): Promise<ImmichAsset[]> {
    const halves = await Promise.all(this.visibilities.map(async visibility => {
      const items: ImmichAsset[] = []
      for (let page = 1; page <= maxPages; page++) {
        const batch = await this.search(endpoint, { ...body, size, visibility, page }, errorLabel)
        items.push(...batch.items)
        if (batch.items.length < size) break
      }
      return items
    }))

    return halves.flat()
  }

  /**
   * One page of a structured search (3.2+). Visibility is part of the filter,
   * so timeline and archived come back in one request. `options` must not carry
   * flat fields: the server rejects them next to `filter`.
   */
  private async searchFilterPage (
    endpoint: string,
    filter: Record<string, unknown>,
    options: Record<string, unknown>,
    errorLabel: string
  ): Promise<SearchPage> {
    return this.search(
      endpoint,
      { ...options, filter: { ...filter, visibility: { in: this.visibilities } } },
      errorLabel
    )
  }

  private async searchFilterAll (
    endpoint: string,
    filter: Record<string, unknown>,
    options: Record<string, unknown>,
    errorLabel: string,
    maxPages: number
  ): Promise<ImmichAsset[]> {
    const items: ImmichAsset[] = []
    let cursor: string | undefined
    for (let page = 1; page <= maxPages; page++) {
      const batch = await this.searchFilterPage(endpoint, filter, { ...options, cursor }, errorLabel)
      items.push(...batch.items)
      if (!batch.nextCursor) break
      cursor = batch.nextCursor
    }
    return items
  }

  /** Newest photos first. Pass the previous page's `next` to continue. */
  async getRecentPhotos (count: number, next?: string): Promise<AssetPage> {
    const errorLabel = 'Failed to fetch photos'

    if (await this.getApiShape() === 'filter') {
      const result = await this.searchFilterPage(
        '/api/search/metadata',
        { type: { eq: 'IMAGE' } },
        { size: count, orderBy: { field: 'fileCreatedAt', direction: 'desc' }, cursor: next },
        errorLabel
      )
      return { assets: result.items, next: result.nextCursor }
    }

    return this.searchFlatPage(
      '/api/search/metadata',
      { type: 'IMAGE', order: 'desc' },
      count,
      next ? Number(next) : 1,
      errorLabel,
      'desc'
    )
  }

  /** Smart search results by relevance. Pass the previous page's `next` to continue. */
  async searchPhotos (query: string, count: number, next?: string): Promise<AssetPage> {
    const errorLabel = 'Failed to search photos'

    if (await this.getApiShape() === 'filter') {
      // Structured smart search has neither cursor nor page. Each page asks for
      // everything up to its end and drops what was already shown, which stops
      // at the server's size cap.
      const offset = next ? Number(next) : 0
      const size = Math.min(offset + count, MAX_SEARCH_SIZE)
      const result = await this.searchFilterPage('/api/search/smart', {}, { query, size }, errorLabel)
      const hasMore = result.items.length === size && size < MAX_SEARCH_SIZE
      return { assets: result.items.slice(offset), next: hasMore ? String(size) : null }
    }

    return this.searchFlatPage('/api/search/smart', { query }, count, next ? Number(next) : 1, errorLabel)
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

    const errorLabel = 'Failed to fetch photos by date'
    const candidates = await this.getApiShape() === 'filter'
      ? await this.searchFilterAll(
        '/api/search/metadata',
        { type: { eq: 'IMAGE' }, takenAt: { gte: takenAfter, lte: takenBefore } },
        { size: DATE_SEARCH_PAGE_SIZE, orderBy: { field: 'fileCreatedAt', direction: 'asc' } },
        errorLabel,
        DATE_SEARCH_MAX_PAGES
      )
      : await this.searchFlatAll(
        '/api/search/metadata',
        { type: 'IMAGE', takenAfter, takenBefore, order: 'asc' },
        DATE_SEARCH_PAGE_SIZE,
        errorLabel,
        DATE_SEARCH_MAX_PAGES
      )

    return candidates
      .filter(asset => localDay(asset) === targetDay)
      .sort(byFileCreatedAt('asc'))
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

  /** Every asset in an album, sorted the way the album is set to. */
  async getAlbumAssets (album: ImmichAlbum): Promise<ImmichAsset[]> {
    const assets = await this.fetchAlbumAssets(album, await this.getApiShape())
    return assets.sort(byFileCreatedAt(album.order ?? 'desc'))
  }

  /**
   * Before 3.0 the album response lists its assets. 3.0 dropped that list, so
   * newer servers search with an album filter (#14). Only 3.0+ lets that search
   * return photos other album members added; older servers limit it to the
   * user's own and partners' assets, so they keep reading the album response.
   */
  private async fetchAlbumAssets (album: ImmichAlbum, shape: ApiShape): Promise<ImmichAsset[]> {
    const errorLabel = 'Failed to fetch album assets'
    // `assetCount` bounds the paging; the extra page absorbs photos added since.
    const maxPages = Math.ceil(album.assetCount / MAX_SEARCH_SIZE) + 1

    switch (shape) {
      case 'legacy': {
        const response = await requestUrl({
          url: `${this.serverUrl}/api/albums/${album.id}`,
          method: 'GET',
          headers: this.getHeaders()
        })

        if (response.status !== 200) {
          throw new Error(`${errorLabel}: ${response.status}`)
        }

        const { assets = [] } = response.json as { assets?: ImmichAsset[] }
        return assets.filter(asset => this.visibilities.includes(asset.visibility ?? 'timeline'))
      }
      case 'flat':
        return this.searchFlatAll(
          '/api/search/metadata',
          { albumIds: [album.id] },
          MAX_SEARCH_SIZE,
          errorLabel,
          maxPages
        )
      case 'filter':
        return this.searchFilterAll(
          '/api/search/metadata',
          { albumIds: { any: [album.id] } },
          { size: MAX_SEARCH_SIZE },
          errorLabel,
          maxPages
        )
    }
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
