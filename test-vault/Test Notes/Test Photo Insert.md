---
date: 2026-03-26
---

# Test Photo Insert

Use the command palette (Ctrl+P) and search "Immich" to test the image picker.

## Test Cases

### Local mode (default)
- [ ] Insert single photo — thumbnail downloaded to vault
- [ ] Insert via paste — paste an Immich URL, thumbnail downloaded

### Remote mode
- [ ] Insert single photo — no file created, `immich://` in markdown
- [ ] Image renders in reading view
- [ ] Image renders in live preview
- [ ] Same image referenced twice only fetches once (check network)

### Shared mode
- [ ] Insert single photo — shared link created in Immich
- [ ] Public URL in markdown — opens in browser without auth

### Convert command
- [ ] Switch to remote mode, insert some photos
- [ ] Run "Convert remote images to local thumbnails" command
- [ ] Verify `immich://` references replaced with local paths
- [ ] Verify thumbnail files created in vault

### Album insert
- [ ] Insert all album photos in each mode
