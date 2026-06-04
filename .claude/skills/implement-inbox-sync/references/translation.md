# Desktop → cloud translation

Reference for translating PostHog Code's desktop UI/state idioms into PostHog Cloud's idioms. Used by `/implement-inbox-sync` and inlined into parallel sub-agent prompts.

## Component library

Desktop uses `@radix-ui/themes`, `@posthog/quill`, and `@phosphor-icons/react`. Cloud uses `@posthog/lemon-ui`, `lib/lemon-ui/*`, and `@posthog/icons`. Map each desktop component to its closest LemonUI equivalent:

- `Button` from `@posthog/quill` or `@radix-ui/themes` → `LemonButton` from `@posthog/lemon-ui`
- `IconButton` → `LemonButton` with `icon` prop, no children
- `Text`, `Box`, `Flex` from `@radix-ui/themes` → plain `div` / `span` + Tailwind classes (`flex`, `gap-2`, etc.); cloud does not use Radix Themes
- `Dialog` from `@radix-ui/themes` → `LemonModal` from `@posthog/lemon-ui`
- `Tabs` from `@radix-ui/themes` → `LemonTabs` from `@posthog/lemon-ui`
- `DropdownMenu` from `@radix-ui/themes` → `LemonMenu` from `@posthog/lemon-ui`
- `Checkbox` → `LemonCheckbox`
- `Switch` → `LemonSwitch`
- `Select` → `LemonSelect` (single) / `LemonInputSelect` (multi)
- `TextField`, `Input` → `LemonInput`
- `TextArea` → `LemonTextArea`
- `Badge` from `@radix-ui/themes` → `LemonTag` (colored labels) or `LemonBadge` (counts)
- `Tooltip` from `@radix-ui/themes` or `@posthog/quill` → `Tooltip` from `@posthog/lemon-ui`
- `ScrollArea` from `@radix-ui/themes` → plain `div` with overflow Tailwind, or `ScrollableShadows` from `lib/components/ScrollableShadows`
- `Skeleton` → `LemonSkeleton`
- `Banner` / inline alert → `LemonBanner`
- `Spinner` from `@radix-ui/themes` → `Spinner` from `@posthog/lemon-ui`
- `Link` (any) → `Link` from `@posthog/lemon-ui`
- `Markdown` / desktop's report-summary markdown component → `LemonMarkdown` from `lib/lemon-ui/LemonMarkdown`
- Profile pictures → `ProfilePicture` from `lib/lemon-ui/ProfilePicture/ProfilePicture`
- `Kbd` from `@posthog/quill` → `KeyboardShortcut` from `lib/components/KeyboardShortcut` if cloud has it, otherwise inline `<kbd>` with Tailwind
- `cn` from `@posthog/quill` → `clsx` from `clsx`

For icons, map `@phosphor-icons/react` icons to the closest equivalent in `@posthog/icons` (e.g. `EnvelopeSimpleIcon` → `IconLetter` or `IconNotification`). Do not bring Phosphor or Lucide into cloud.

**Some icons live in `lib/lemon-ui/icons` rather than `@posthog/icons`.** Before deciding an icon doesn't exist, also grep `frontend/src/lib/lemon-ui/icons/icons.tsx`. Common cases of icons in `lib/lemon-ui/icons` (not `@posthog/icons`): `IconOpenInNew`, `IconLink`, `IconArrowDown`, `IconTag`, `IconChevronUp`, `IconKanban`, `IconTicket`. The import path matters — `import { IconOpenInNew } from 'lib/lemon-ui/icons'`, not `from '@posthog/icons'`.

When a desktop component has no direct LemonUI equivalent (a specific animated loader, a custom badge variant, etc.), implement it in plain JSX + Tailwind in the cloud Inbox dir. **Do not add a third component library.**

## Animations

Desktop uses `framer-motion` for entry/exit animations, fan stacks, spring transitions. Cloud does NOT currently have `framer-motion` installed. Substitute as follows:

- `<motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{duration:0.2}}>` → `<div className="animate-fade-in">` if cloud has a Tailwind `fade-in` keyframe; otherwise plain `<div>` with `style={{ transition: 'opacity 0.2s ease' }}`.
- `<motion.div animate={{ x: N, scale: S }}>` → `<div style={{ transform: \`translateX(${N}px) scale(${S})\`, transition: 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)' }}>`.
- `<AnimatePresence>` exit animations → handle via CSS `@keyframes` + a `transition-group`-style mount/unmount delay, or accept synchronous unmount if the exit visual is minor.
- Spring-physics fan stacks (e.g. desktop's MultiSelectStack) → port via CSS `transition: transform ... cubic-bezier(...)`. The visual will land 90% of the way without `spring` physics.
- Stagger entry (per-row `delay: i * 0.035`) → CSS `animation-delay` on a `@keyframes` rule, or accept synchronous appearance for list rows (typical at >20 rows the stagger barely shows anyway).

If a desktop animation is core UX and CSS substitution would be jarring (e.g. a primary interaction surface), surface it under Open Questions in the final report and recommend adding `framer-motion` to cloud's `package.json` rather than dropping silently.

**Replacing `<motion.div>` with a bare `<div>` and reporting "no functional impact" is a polish drop.** The parent skill's hard rules forbid this — at minimum keep CSS transitions; at maximum surface as Open Question.

## State management

Desktop uses Zustand stores and TanStack Query. Cloud uses Kea. Map each desktop pattern to its Kea equivalent:

- Zustand `create(...)` store with state + actions → Kea logic with `actions` + `reducers`
- Zustand persisted store via `persist()` middleware → Kea reducer with the `{ persist: true }` option per-reducer. Pattern: `reducers({ statusFilter: [DESKTOP_DEFAULT, { persist: true }, { setStatusFilter: (_, { value }) => value }] })`. **If desktop persists a piece of state via Zustand `persist`, the cloud Kea reducer MUST also persist via `{ persist: true }`.** Default values mirror desktop verbatim — copy the literal default from the desktop store file.
- TanStack Query `useQuery` / `useInfiniteQuery` → Kea `loaders` builder. Pagination: a `loadMoreReports` action that appends; do not re-implement infinite scroll from scratch.
- TanStack Query refetch interval / polling → Kea `afterMount` + `cache.disposables.add(...)` registering a `setInterval`. Read the cloud `using-kea-disposables` skill first.
- `useMutation` → a Kea `actions` + `listeners` block that calls `api.signalReports.*`, dispatches success/failure actions, surfaces `lemonToast` for errors.
- tRPC client call from a component → a `listeners` call that hits the appropriate `api.*` REST endpoint in `~/Developer/posthog/frontend/src/lib/api.ts`.
- `useEffect` for subscriptions / window listeners → `afterMount` + `cache.disposables.add(...)`. Never write a bare `addEventListener` in a Kea logic without disposables.
- Cross-store `useOtherStore.getState()` → Kea `connect({ values: [otherLogic, [...]], actions: [otherLogic, [...]] })`.
- `useState` for UI-local toggles → `useState` is fine on cloud too — local component state stays local.
- Custom hook orchestrating multiple queries → a selector or loader on the logic that merges them. Do not write hooks that re-run multiple queries.

The `useDiscussReport` and any chat-with-inbox affordance are agent-chat hooks — stub them Coming soon™. The "Create PR" / `useCreatePrReport` is a **task-kickoff** hook, not a chat hook — port it fully, wiring to cloud's `api.tasks.*` and reusing desktop's prompt-building utils where the prompt content matters.

## Routing

Desktop uses TanStack Router. Cloud uses scenes + urls + sceneTypes. Map each desktop pattern to its cloud equivalent:

- Route registered in `apps/code/src/renderer/router.tsx` → already-registered cloud scene (today: `Scene.Inbox` in `frontend/src/scenes/sceneTypes.ts`, mapped in `frontend/src/scenes/scenes.ts`, URL in `frontend/src/scenes/urls.ts` as `urls.inbox(reportId?)`). If desktop introduces new top-level tabs, add the corresponding cloud routes here.
- `useSearch()` / route params → `urlToAction` / `actionToUrl` in the central inbox scene logic
- Deep-link selection (desktop's `useInboxDeepLink`, `useInboxDeepLinkListSync`) → `setSelectedReportId` action + `actionToUrl` round-trip on the cloud side. Verify deep links survive the polish you port; extend if needed.

For modals and drawers (sources dialog, dismiss dialog, configure-agents drawer), they generally stay in-scene as `LemonModal` / `LemonDrawer`, no new URL — unless desktop deep-links to a specific configuration tab, in which case mirror that with a sub-route.

## API

Both sides talk to the same Django backend. On cloud, REST endpoints are wrapped in `frontend/src/lib/api.ts` under `api.signalReports.*` (list, retrieve, dismiss, snooze, etc.) and adjacent groupings (`api.tasks.*`, etc.). Read those wrappers — they tell you the exact request shape. If desktop reads a field cloud's serializer doesn't expose, that's a backend gap → surface it in the report, don't add a parallel API. If the endpoint exists but cloud lacks a TS wrapper, add the wrapper.

## Empty / loading / setup states

Desktop has rich onboarding (warming-up panes, select-something panes, gated panes, skeleton backdrops, setup panes) plus sources dialogs. Port the **logic** of each (when it shows, what it says, what action it offers) into cloud's equivalent. Don't copy desktop's exact JSX — cloud's layout, hedgehogs, and typography differ.

Hedgehogs come from `lib/components/hedgehogs` (e.g. `GraphsHog`, `PopUpBinocularsHog`). Use these for cloud empty states; do not import desktop assets.

## Analytics

Desktop fires events via `@utils/analytics` with constants from `@shared/types/analytics`. Cloud fires events via `posthog.capture(...)` from `posthog-js` (or the `eventUsageLogic` pattern). **Mirror the event name and properties verbatim** — same `inbox viewed`, same property keys — so we can dashboard both surfaces together. If desktop has a constant, copy the literal string into cloud.
