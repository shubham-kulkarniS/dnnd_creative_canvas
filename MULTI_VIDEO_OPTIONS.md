# Multiple Video Generation: UI Options & Evaluation

## Current Architecture
- **Backend**: `generate_video()` returns `List[Tuple[bytes, str]]` supporting 1-4 videos per request
- **Frontend**: All videos pushed downstream via `pushDownstream()`, but only first video (`result.assets[0]`) set as node value
- **Storage**: Currently no way to access/display the other generated videos in the UI

## Challenge
When `number_of_videos > 1`, users can't see alternative generations (different random seeds) in the canvas UI, even though they're generated and available.

---

## Option 1: Seed Ring Icons (Recommended)
**Display small indicator circles below main preview showing all seeds**

### Implementation
```
[Main Video Preview]
  🟦 🟦 🟦 🟦
  1  2  3  4
```
- Each circle represents a seed variant
- Filled/active circle shows current selection
- Click to switch video display
- Shows seed index or actual seed value on hover

### Pros ✅
- **Compact**: Doesn't expand node size
- **Visual**: Immediately shows "multiple variants available"
- **Intuitive**: Circle pattern is recognizable for options/seeds
- **Accessible**: Tab-keyboard navigation between variants
- **Non-breaking**: Works with existing node layout
- **Real-time**: Can swap videos in milliseconds

### Cons ❌
- Requires storing all video URLs in node state (currently only first stored)
- Small UI elements might be hard to hit on touch
- Only shows up to ~6 seeds before wrapping

### Dev Effort: **Medium**
- Store all assets in node: `node._allAssets = [{url, mime}, ...]`
- Add seed indicator UI in preview
- Click handler to swap `node.value` between stored assets

---

## Option 2: Dropdown Selector
**"Video 1 of 4" dropdown with arrow navigation**

### Implementation
```
[Prev] Video 1 of 4 [Next]
         ↓↑
[Main Video Preview]
```

### Pros ✅
- **Clear**: Explicitly shows count and current position
- **Mobile-friendly**: Larger tap targets (prev/next buttons)
- **Discoverable**: Text label explains what it is

### Cons ❌
- Takes up header space
- Less visually striking than icons
- Sequential browsing (vs direct seed access)

### Dev Effort: **Low**
- Add prev/next buttons to header
- Store active index in `node._activeAssetIndex`
- Update preview on button click

---

## Option 3: Inline Thumbnail Strip
**Show small preview thumbnails of all variants**

### Implementation
```
[Active] [Seed2] [Seed3] [Seed4]
```

### Pros ✅
- **Visual**: Users see actual preview of each variant
- **Direct selection**: Click any thumbnail
- **Beautiful**: Modern UI pattern

### Cons ❌
- **Space intensive**: Can make node very wide
- **Performance**: Rendering 4 video elements with thumbnails = expensive
- **Clutter**: Reduces space for main preview
- **Not scalable**: Works poorly with max 4 videos constraint

### Dev Effort: **High**
- Generate video thumbnails on backend
- Style thumbnail grid
- Manage video/thumbnail lifecycle

---

## Option 4: Right-Click Context Menu
**Access variants via context menu**

### Implementation
```
Right-click on video →
┌─────────────────────┐
│ Variant 1 (seed:42) │
│ Variant 2 (seed:73) │
│ Variant 3 (seed:15) │
│ Variant 4 (seed:88) │
└─────────────────────┘
```

### Pros ✅
- Zero screen space impact
- Discoverable via right-click UX
- Clean minimalist aesthetic

### Cons ❌
- **Hidden by default**: Users might not know variants exist
- **Not obvious**: Requires right-click knowledge
- **No visual indicator** that variants are available
- **Accessibility**: Context menu pattern has worse keyboard support

### Dev Effort: **Medium**

---

## Option 5: Library Panel Tab (Alternative)
**Dedicated "Variants" tab in left sidebar**

### Pros ✅
- Consistent with existing library UI
- Can show full details: seed, timestamp, dimensions
- Searchable/filterable

### Cons ❌
- Out of context: far from the node
- Requires switching panels (cognitive load)
- User might not discover feature

### Dev Effort: **High**

---

## Recommended Solution: **Option 1 + Option 2 Hybrid**

Combine **seed ring icons** (for visual indicator) with **prev/next buttons** (for accessibility):

```
[Prev] [Main Video] [Next]
          ●●●●
```

### Why This Works
1. **Visual indicator** (rings) shows variants exist
2. **Keyboard-friendly** (prev/next buttons)
3. **Touch-friendly** (larger targets than tiny circles)
4. **Compact** (doesn't expand node)
5. **Accessible** (ARIA labels, keyboard nav)
6. **Modern** (familiar pattern from photo galleries)

---

## Implementation Roadmap

### Phase 1: Store Multiple Assets (Backend Alignment)
- Keep backend returning all videos in `result.assets`
- Update runner.js to store all assets in node: `node._generatedAssets = result.assets`

### Phase 2: UI Components
1. Add to `previewHTML()` in `node-views.js`:
   - Prev/Next buttons in preview box header
   - Seed ring indicators below preview
   - ARIA labels for accessibility

2. Add to `node-actions.js`:
   - `setActiveAssetIndex(node, index)` handler
   - Update `node.value` to `node._generatedAssets[index].url`
   - Trigger re-render via `_refreshBody()`

3. Add CSS to `style.css`:
   - `.preview-nav-buttons` for prev/next
   - `.seed-ring` for indicator circles
   - Hover states and animations

### Phase 3: Polish
- Tooltip showing seed value on hover
- Keyboard arrow keys to navigate (if focused)
- Smooth transition between videos
- Save selected variant preference to session

---

## Size Impact
- **HTML**: +15 lines (buttons + rings markup)
- **CSS**: ~40 lines (styling + animations)  
- **JavaScript**: ~25 lines (click handlers + state management)
- **Performance**: Minimal (no new API calls, reuses existing assets)

