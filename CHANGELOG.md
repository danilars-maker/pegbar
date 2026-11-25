# Changelog

## 1.0.1 — 2026-11-24
- Buy Me a Coffee link: buymeacoffee.com/studiocoffeecat

## 1.0.0 — 2026-11-24
- Undo / redo buttons (one step in Photoshop's History)
- "About Pegbar" in the panel menu and an info button: version, made by Coffee Cat Studio, website and Buy Me a Coffee links

## 0.9.1 — 2026-11-24
- Thumbnails zoom to the drawing area of each group (same framing for all frames) and keep thin strokes when shrinking; "Zoom to drawing" can be turned off to see the whole page

## 0.9.0 — 2026-11-24
- Thumbnails: layers are made visible while their pixels are read (hidden layers can come back empty); "Test thumbnails" diagnostic
- Exposure: type any value (up to x999); stretch or shorten a drawing by dragging the right edge of its cell
- Flip by dragging on the timeline ruler or on the new flip bar
- Export: animated GIF (built-in encoder, respects exposure and fps); MP4 via Photoshop's Render Video with step-by-step help

## 0.8.0 — 2026-11-24
- Thumbnails: the plugin now builds the PNG itself (works without Photoshop's image encoder); shows a message if thumbnails fail
- Pivot rewritten: transforms around the layer's real center, then measures and corrects until the pivot stays in place; with an active selection, only the selected pixels are transformed (selection follows the object); a tiny selection marks just the pivot point
- Cut tool (razor, C): click inside an exposure to split it; Shift + click trims the rest
- Floating tooltips with the tool name on every icon

## 0.7.0 — 2026-11-24
- Languages: Portuguese, English and Spanish (selector at the top of the panel; starts in Photoshop's language)
- Buttons, descriptions, tabs, messages and History step names are translated

## 0.6.0 — 2026-11-24
- New look in the style of Photoshop panels: flat icon buttons, compact rows, theme-aware icons (dark and light themes)
- Every button has a description on hover (also shown in the status bar)
- Drag and drop drawings in the timeline: reorder in the same row or move to another group's row; Alt + drag copies; drop on a group name to send to the end
- Plugin icon: sheet of paper with peg holes

## 0.5.0 — 2026-11-24
- Timeline shows every animation group as a row (click a row or its name to edit it); keys highlighted
- Timeline zoom (width and height)
- Rotate / scale / mirror now use Photoshop's own transform with the reference point on the pivot; new "by hand" free transform starting at the pivot
- Flip buttons: previous → current, around, current → next (works on the canvas at the play fps)
- Group color now colors the group and all its frames
- "New frame" button is now a sheet-of-paper icon
- New plugin icon

## 0.4.0 — 2026-11-24
- Tools organized in tabs
- Key / breakdown / inbetween marks (K, B, I) on frames; onion skin showing only keys; pose test playback
- Shift & Trace: temporary copy of the previous/next drawing to move, rotate and mirror, original untouched
- Cycles: repeat frames as loop, ping-pong or random
- Play modes: loop, ping-pong, once
- Sync all animation groups in play, flip and navigation; light table (other groups faded)
- Field guides (document, 16:9, 9:16, 1:1, 4:5) with action-safe 93% and title-safe 90%
- Timing chart drawn on a guide layer (constant, ease in, ease out, ease in-out)
- Export PNG sequence (respects exposure and synced groups)

## 0.3.0 — 2026-11-24
- New name: **Pegbar by Coffee Cat** (was "Fofo Timeline")
- Tools bar: pivot / anchor point per layer (from selection, 9 points or x/y), rotate and scale around the pivot, mirror object on the pivot axis, mirror / upside-down view, shortcut to paint symmetry
- New menu commands for the tools (assignable shortcuts)

## 0.2.0
- Flip slider (drag to flip drawings on the canvas)
- Rename animation groups and give them a color label
- Default exposure for new frames + "apply to all"

## 0.1.2
- Play on the canvas; onion-skin color no longer uses "Clear Layer Style"

## 0.1.0
- First version: timeline with thumbnails, onion skin, exposure, labels, cut/copy/paste
