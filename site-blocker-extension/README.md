# Site Blocker (Chrome MV3 Extension)

Block distracting websites using a configurable list with a quick enable/disable toggle.

## Install (Load Unpacked)

1. Open Chrome and go to `chrome://extensions`.
2. Enable "Developer mode" in the top-right.
3. Click "Load unpacked" and select the `site-blocker-extension` folder in this workspace.
4. The extension appears as "Site Blocker".

## Usage

- Click the extension icon to quickly Enable/Disable and open the manager.
- Open the Options page ("Details" -> "Extension options" or via the popup) to:
  - Add a domain like `facebook.com`. Subdomains are also blocked.
  - Remove domains.
  - Export/Import your list as JSON.
  - Clear all.
- When a blocked site is visited, you’ll be redirected to the built-in blocked page.

## Notes

- Uses Manifest V3 Declarative Net Request (DNR) for efficient on-device blocking.
- Rules match only top-level navigations (`main_frame`), so embedded content isn’t blocked.
- Host permissions are `<all_urls>`, required for DNR to operate on all sites.
- Data is stored locally (Chrome storage). No network or analytics.

## Uninstall

Remove from `chrome://extensions`.