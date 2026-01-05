# Icon Replacement List

## Already Replaced with Nucleo Icons ✅

1. **Copy Icon** → `IconClone2` (filled)
   - `components/AccountStatus.tsx`
   - `app/(app)/overview/components/Header/AddressDisplay.tsx`

2. **Checkmark Icon** → `IconCheck`
   - `components/AccountStatus.tsx`
   - `app/(app)/overview/components/Header/AddressDisplay.tsx`

3. **Disconnect/Logout Icon** → `IconPowerOff`
   - `components/AccountStatus.tsx`
   - `app/(app)/overview/components/Header/DisconnectButton.tsx`

4. **Overview Icon** → `IconHouse6Fill`
   - `components/app-sidebar.tsx`

5. **Liquidity Icon** → `IconStorage`
   - `components/app-sidebar.tsx`

6. **Swap Icon** → `IconArrowsBoldOppositeDirection`
   - `components/app-sidebar.tsx`

7. **Analytics Icon** → `IconChart`
   - `components/app-sidebar.tsx`

8. **Documentation Icon** → `IconSavedItems`
   - `components/app-sidebar.tsx`

9. **Right Arrow (Chevron)** → `IconChevronRight`
   - `app/(app)/overview/components/shared/ViewAllButton.tsx`
   - `app/(app)/overview/components/Overview/PointsRewardsCard.tsx`

10. **Table Sort Arrows** → `IconArrowUp`, `IconArrowDown`
    - `components/table-v2/styled.tsx`

11. **Settings/Gear Icon** → `IconGear`
    - `app/(app)/overview/components/Header/SettingsPopover/SettingsPopover.tsx`

---

## Icons Still Using Lucide-React (With Nucleo Equivalents Available) 🔄

### Direct Mappings (Easy Replacements)

| Lucide Icon | Nucleo Equivalent | Files Using It | Status |
|------------|-------------------|----------------|--------|
| `Check` / `CheckIcon` | `IconCheck` | Multiple (checkboxes, selects) | ✅ Done |
| `X` / `XIcon` | `IconXmark` | Multiple (close buttons) | ✅ Done |
| `Plus` / `PlusIcon` | `IconPlus` | Multiple (add actions) | ✅ Done |
| `Minus` / `MinusIcon` | `IconMinus` | Multiple (remove actions) | ✅ Done |
| `Search` / `SearchIcon` | `IconSearchArea` or `IconInputSearch` | Multiple (search bars) | ✅ Kept as-is |
| `ChevronDown` / `ChevronDownIcon` | `IconChevronDown` | Multiple (dropdowns) | ✅ Kept as-is |
| `ChevronUp` / `ChevronUpIcon` | `IconChevronUp` | Multiple (dropdowns) | ✅ Kept as-is |
| `ChevronLeft` / `ChevronLeftIcon` | `IconChevronLeft` | Multiple (navigation) | ✅ Kept as-is |
| `ChevronRight` / `ChevronRightIcon` | `IconChevronRight` | Multiple (navigation) | ✅ Done (already replaced earlier) |
| `ChevronsUpDown` / `ChevronsUpDownIcon` | `IconChevronExpandY` | `app/(app)/overview/components/tabs/TokensTab.tsx` | ✅ Done |
| `BadgeCheck` | `IconBadgeCheck2` (unfilled) | Multiple (success states) | ✅ Done |
| `RefreshCw` / `RefreshCwIcon` | `IconRefreshClockwise` | Multiple (refresh actions) | ✅ Done |
| `ExternalLink` / `ExternalLinkIcon` | `IconExternalLink` | Multiple (external links) | ✅ Kept as-is |
| `Loader2` / `Loader2Icon` | `IconLoader` or `IconFillLoader` | Multiple (loading states) | ✅ Kept as-is |
| `Maximize` | `IconMaximizeWindow` | Multiple | ✅ Kept as-is |
| `Menu` | `IconMenu` | `components/MobileHeader.tsx` | ✅ Done |
| `CoinsIcon` | `IconCoins` | `components/app-sidebar.tsx`, `components/nav-main.tsx` | ✅ Done |
| `CircleHelp` | `IconCircleQuestion` | `components/liquidity/AddLiquidityForm.tsx` | ✅ Kept as-is |
| `HelpCircleIcon` | `IconCircleQuestion` | `components/app-sidebar.tsx` | ✅ Kept as-is |
| `MoreHorizontal` | `IconDots` | `app/(app)/overview/components/Overview/ActionTiles.tsx` | ✅ Kept as-is |
| `MoreVerticalIcon` | `IconDotsVertical` | `components/AccountStatus.tsx` | ✅ Kept as-is |

### Needs Investigation (May Have Equivalents)

| Lucide Icon | Possible Nucleo Equivalent | Notes |
|------------|---------------------------|-------|
| `OctagonX` | `IconCircleXmarkFilled` | Error states | ✅ Done |
| `Info` / `InfoIcon` | `IconCircleInfo` | Info tooltips | ✅ Done |
| `AlertTriangle` | `IconTriangleWarningFilled` | Warning states | ✅ Done |
| `AlertCircle` | `IconCircleWarning` | Alert states | ✅ Done |
| `ArrowRight` | `IconArrowRight` | Already checked - has equivalent |
| `ArrowLeft` | `IconArrowLeft` | Already checked - has equivalent |
| `ArrowUpRight` | `IconArrowUpRight` | External links, growth | ✅ Kept as-is |
| `ArrowDownRight` | `IconArrowDownRight` | `app/(app)/overview/components/OverviewHeader.tsx` | ✅ Kept as-is |
| `ArrowLeftRight` | `IconArrowsBoldOppositeDirection` | Swap actions (already used in sidebar) | ✅ Kept as-is |
| `MoveRight` | `IconArrowRight` or `IconChevronRight` | `components/liquidity/PreviewPositionModal.tsx` |
| `CornerRightUp` | Check arrow variants | Multiple files | ✅ Kept as-is |
| `Send` | `IconPaperPlane2` | `app/(app)/overview/components/Overview/ActionTiles.tsx`, `app/(app)/overview/components/ActionGrid.tsx` | ✅ Done |
| `Trash2Icon` | `IconTableRowDeleteBottom` or similar | `components/nav-main.tsx` | ✅ Kept as-is |
| `ZoomIn` | Check zoom variants | `components/liquidity/InteractiveRangeChart.tsx` |
| `ZoomOut` | Check zoom variants | `components/liquidity/InteractiveRangeChart.tsx` |
| `PanelLeft` | `IconSidebarLeft` or similar | `components/ui/sidebar.tsx` |
| `HomeIcon` | `IconHouse` variants | `components/AccountStatus.tsx` |
| `ChartBarBig` | Check chart variants | `components/liquidity/range-selection/RangeSelectionModalV2.tsx` |
| `SquarePen` | Check edit/pen variants | `components/liquidity/range-selection/RangeSelectionModalV2.tsx` |
| `Circle` | `IconCircle` variants | Multiple files (checkboxes, radio) |

### Special Cases (May Need Custom or Keep)

- **Landing Page Icons** (`GlitchIcon.tsx`) - Custom glitch effect icons, may be intentionally custom
- **UI Component Library Icons** (`components/ui/`) - shadcn components, may need to stay for compatibility

---

## Summary Statistics

- **Already Replaced**: 11 icon types
- **Easy Replacements Available**: ~30+ icon types with direct nucleo equivalents
- **Needs Investigation**: ~10-15 icon types (may have equivalents)
- **Special Cases**: Landing page icons, UI library icons

---

## Priority Recommendations

### High Priority (Frequently Used + Easy Replacements)
1. `BadgeCheck` → `IconBadgeCheck` (33 files)
2. `X` / `XIcon` → `IconXmark` (33 files)
3. `ChevronDown` / `ChevronUp` → `IconChevronDown` / `IconChevronUp` (13 files)
4. `Plus` / `PlusIcon` → `IconPlus` (8 files)
5. `Check` / `CheckIcon` → `IconCheck` (multiple files)
6. `Search` / `SearchIcon` → `IconSearchArea` or `IconInputSearch` (multiple files)

### Medium Priority
7. `OctagonX` → Check for `IconOctagonWarning` or X variant (33 files)
8. `RefreshCw` → `IconRefresh` or `IconRefreshClockwise` (multiple files)
9. `Loader2` → `IconLoader` or `IconFillLoader` (multiple files)
10. `ExternalLink` → `IconExternalLink` (multiple files)
11. `Info` / `InfoIcon` → `IconCircleInfo` or `IconOctagonInfo` (multiple files)
12. `Minus` / `MinusIcon` → `IconMinus` (multiple files)

### Lower Priority
13. `ArrowLeftRight` → Already using `IconArrowsBoldOppositeDirection` in sidebar
14. `ArrowUpRight` → `IconArrowUpRight` (external links)
15. `Send` → `IconPaperPlane4Link` or similar
16. `MoreHorizontal` / `MoreVerticalIcon` → `IconDots` / `IconDotsVertical`
17. `CoinsIcon` → `IconCoins`
18. `Menu` → `IconMenu` or `IconMenuBars`
19. `Maximize` → `IconMaximizeWindow`
20. `ChevronLeft` → `IconChevronLeft` (navigation)

---

## Notes

- The `polar/` directory contains a separate project and can be ignored
- Most common icons have direct nucleo equivalents - these are easy replacements
- Landing page icons in `GlitchIcon.tsx` might be intentionally custom
- UI component library icons (shadcn) in `components/ui/` might need to stay as-is for compatibility
- Some icons like `OctagonX` may need investigation to find the right nucleo equivalent

