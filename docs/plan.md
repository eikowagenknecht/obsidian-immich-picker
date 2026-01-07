# Obsidian Immich Picker - Implementation Plan

## Overview
Create an Obsidian plugin to insert images from a self-hosted Immich photo server. Based on `obsidian-google-photos` (GPL-3.0) but significantly simplified due to Immich's API key authentication (no OAuth needed).
obsidian-google-photos source can be found in ../obsidian-google-photos

## User Requirements
- **Command**: "Insert image from Immich" in command palette
- **Photo Picker**: Show 10 most recent photos in modal grid
- **Link Paste**: Auto-detect pasted Immich URLs and convert them
- **On Selection**: Download thumbnail, save to configurable location, insert `[![](thumbnail)](immich-url)`
- **Error Handling**: Show error notification if thumbnail download fails, don't insert
- **License**: GPL-3.0

## Project Structure
```
obsidian-immich-picker/
├── src/
│   ├── main.ts              # Plugin entry, command registration, paste handler
│   ├── immichApi.ts         # Immich API client
│   ├── photoModal.ts        # Modal with photo grid
│   ├── renderer.ts          # GridView for thumbnail display
│   ├── settings.ts          # Settings interface and tab
│   ├── handlebars.ts        # Template parsing (adapted from reference)
│   └── suggesters/
│       ├── suggest.ts       # Base suggest class (copy from reference)
│       └── FolderSuggester.ts # Folder autocomplete (copy from reference)
├── styles.css               # Modal and grid styles
├── manifest.json            # Plugin manifest
├── package.json             # Dependencies
├── tsconfig.json            # TypeScript config
├── esbuild.config.mjs       # Build config
└── LICENSE                  # GPL-3.0
```

## Implementation Steps

### Phase 1: Project Setup
1. Create `manifest.json` (id: "immich-picker", minAppVersion: "0.15.0")
2. Create `package.json` with dependencies: obsidian, @popperjs/core, esbuild, typescript
3. Copy `tsconfig.json` from reference
4. Copy `esbuild.config.mjs` from reference
5. Create `LICENSE` (GPL-3.0)

### Phase 2: Settings (src/settings.ts)
Create `ImmichPickerSettings` interface with:
- `serverUrl`, `apiKey` (connection)
- `recentPhotosCount` (default: 10)
- `thumbnailWidth`, `thumbnailHeight` (default: 400x280)
- `locationOption`, `locationFolder`, `locationSubfolder` (storage)
- `filename` (MomentJS format)
- `thumbnailMarkdown` (template)
- `convertPastedLink` (boolean)

Create `ImmichPickerSettingTab` with sections for connection, thumbnails, storage, output.

### Phase 3: API Client (src/immichApi.ts)
Create `ImmichAsset` interface (id, originalFileName, fileCreatedAt, type).

Create `ImmichApi` class with:
- `getRecentPhotos(count)` - POST `/api/search/metadata`
- `getThumbnailUrl(assetId)` - returns URL with apiKey param
- `getAssetUrl(assetId)` - returns `/photos/{id}` URL
- `downloadThumbnail(assetId)` - GET `/api/assets/{id}/thumbnail`

### Phase 4: UI Components
1. Copy `src/suggesters/suggest.ts` from reference (verbatim)
2. Copy `src/suggesters/FolderSuggester.ts` from reference (verbatim)
3. Create `src/handlebars.ts` with template variables:
   - `local_thumbnail_link`, `immich_url`, `immich_asset_id`, `original_filename`, `taken_date`
4. Create `src/renderer.ts`:
   - `ThumbnailImage` class with assetId, immichUrl, filename, creationTime
   - `GridView` class with `appendThumbnailsToElement()`
5. Create `src/photoModal.ts`:
   - `ImmichPickerModal` extending Modal
   - `onOpen()`: fetch recent photos, display grid
   - `insertImageIntoEditor()`: download thumbnail, save, insert markdown

### Phase 5: Main Plugin (src/main.ts)
- Initialize `ImmichApi` with settings
- Register command `insert-immich-photo`
- Register paste event handler for Immich URL detection
- Pattern: `serverUrl/photos/{uuid}` -> extract assetId -> download & insert

### Phase 6: Styles (styles.css)
- `.immich-picker-modal` - modal sizing
- `.immich-picker-grid` - flex wrap container
- `.immich-picker-thumbnail` - 150x150 thumbnails with hover effect

## Key Files from Reference (c:\Entwicklung\repos\obsidian-google-photos\)
- `src/main.ts` - Command registration pattern
- `src/photoModal.ts:33-88` - Image insertion logic
- `src/renderer.ts` - GridView/ThumbnailImage classes
- `src/settings.ts` - Settings tab with folder suggesters
- `src/suggesters/` - Copy verbatim

## Key Simplifications vs Reference
| Aspect | Google Photos | Immich Picker |
|--------|--------------|---------------|
| Auth | OAuth 2.0 with tokens | Simple API key |
| Session | Picker sessions + polling | None needed |
| Selection | External Google picker | Built-in modal grid |
| Thumbnails | OAuth headers (blob URLs) | Direct URL with apiKey param |

## Immich API Endpoints Used
- `POST /api/search/metadata` - Fetch recent photos
  ```json
  { "page": 1, "size": 10, "type": "IMAGE", "order": "desc" }
  ```
- `GET /api/assets/{id}/thumbnail?size=thumbnail&apiKey={key}` - Get thumbnail
- Web URL: `/photos/{id}` - Link to photo in Immich

## Settings Defaults
```typescript
{
  serverUrl: '',
  apiKey: '',
  recentPhotosCount: 10,
  thumbnailWidth: 400,
  thumbnailHeight: 280,
  locationOption: 'note',
  locationFolder: '',
  locationSubfolder: 'photos',
  filename: 'YYYY-MM-DD[_immich_]HHmmss[.jpg]',
  thumbnailMarkdown: '[![]({{local_thumbnail_link}})]({{immich_url}}) ',
  convertPastedLink: true
}
```

## References
- Simpler alternative (Templater script): https://obsidian.alan.gr/obsidian-guides/insert-images-from-immich
- Based on: https://github.com/alangrainger/obsidian-google-photos (GPL-3.0)

## Testing Checklist
- [ ] Settings: Server URL and API key validation
- [ ] Settings: Test connection button works
- [ ] Command: Opens modal with recent photos
- [ ] Modal: Thumbnails load correctly
- [ ] Modal: Click inserts thumbnail + markdown
- [ ] Storage: Thumbnails saved to correct location
- [ ] Paste: Immich URLs auto-detected and converted
- [ ] Errors: Graceful handling with user notifications
