# Cursor Handoff Prompt — Megamgem Motion Project

Copy everything below the line into Cursor as your initial prompt or paste into a `PROJECT_CONTEXT.md` at the root of your workspace. Then attach the relevant files.

---

# Megamgem Motion — Project Context

## What this project is

A kinetic typography piece for a graphic design course at HIT, visualizing the Hebrew poem "נקמת הילד הגמגם" (Roni Sumek) alongside testimonies from the Israeli TV show "סליחה על השאלה — ילדים מגמגמים" (children with stutters describing their experience).

The thesis: stuttering is the *difficulty of speaking*. Letters get stuck; sounds elongate; words abort halfway. The visual treatment honors that difficulty rather than correcting it.

The audio is a 17.5-minute interview with multiple kids. The transcript has 43 utterances, with stutter notation marked inline.

## What's already built

A custom Hebrew variable font (`TelAvivMegamgemVF.ttf`) derived from Tel Aviv Megamgem (Yanek Iontef / Daniel Grumer / Fontef, OFL). Two custom axes:

- **PROL** (Prolongation, 0–1000): horizontal stretch — for held vowels like `ה---ה`
- **STTR** (Stutter, 0–1000): letterform deformation — at 1000 letters become thin vertical strokes, at 0 they're clean

A complete browser-based motion player (`megamgem-motion-v6.html`) is the canonical artifact. It is single-file, self-contained, with the font embedded as base64 and the timeline as inline JSON.

## Current state of the player

Working features:
- 43 utterances rendered as typewriter (one character at a time, RTL Hebrew)
- Per-letter axis values for each stutter type:
  - **Repetition** (`אאאני`): N copies of the letter with descending STTR (1000 → 666 → 333 → 0); the last one is the resolved letter
  - **Repeat-dash** (`ל-למה`): same as repetition but slower per-letter
  - **Prolongation** (`ה---האחים`): the stuttered letter ramps PROL from 0 → 1000 over ~200ms × intensity, then *holds* at 1000 forever as the rest of the word types
  - **Mixed** (`ללללל-------ל`): repetition that builds into prolongation — the last letter both resolves AND prolongs
  - **Ghost word** (`(כל)`): appears with strikethrough, fades out
- Audio drag-drop loading
- Anchor system: press `A` during playback to mark utterance N's start time; saves to `localStorage` as `megamgem_anchors_v5`
- Linear interpolation between anchors for non-anchored utterances
- Speed slider (0.4×–1.8×), timeline scrub, arrow-key utterance navigation
- Stutter-tag overlay showing current stutter metadata (type, letter, intensity)

### Color and design language

- Background: `#0E0D0C` (near-black ink)
- Foreground text: `#F1ECE0` (warm cream paper)
- Accent (stutter highlights, progress bar): `#C13F1F` (rust red)
- Hebrew font: MegamgemSans (the variable font)
- UI font: ui-monospace, JetBrains Mono, Menlo
- All text RTL, `unicode-bidi: isolate`

## File structure

```
megamgem-motion-v6.html       The current player. Single self-contained file.
                              Embedded:
                                <style id="fontface"> with @font-face base64 data
                                <script id="timelineData"> with parsed transcript JSON
                                <script> with player engine

timeline_v2.json              The parsed transcript. 43 utterances. Each has:
                                utterance_id, raw, anchor_ms, events[]
                              Events are either kind="ghost" or kind="word".
                              Word events have target (resolved word) and
                              stutters[] (array of stutter descriptors).

stammer-text.rtf              Original Hebrew transcript with stutter notation.
                              Notation conventions:
                                X---X      = prolongation (multiple dashes)
                                XXXXword   = repetition build-up (3+ same letter)
                                X-X-Xword  = dash-repetition
                                XXXXX---X  = mixed (repeat into prolong)
                                (word)     = ghost word
                                Two ו or י mid-word = NOT a stutter (natural Hebrew)

anchors01.json                User's manually placed audio sync anchors:
                              { "0": 0, "1": 6260, "2": 9508, ... }
                              Maps utterance_id to start time in milliseconds.

audio.mp3                     The interview audio. 17.5 min, 16MB, 44.1kHz stereo.
                              Includes host's questions (NOT in transcript) plus
                              kids' answers (these ARE in transcript).
```

## How the player engine works

The core loop is `tick()` which runs at requestAnimationFrame:

1. Get current time `t` (from audio.currentTime if loaded, else performance.now())
2. Find which utterance is active by comparing `t` to `utteranceStarts[]`
3. If utterance changed, call `renderUtterance()` to build the DOM tree of `<span class="letter">` elements
4. For each letter in the schedule, check if its `appearAt` time has passed; if so, set its `font-variation-settings` to the target STTR/PROL values
5. For prolonged letters, animate PROL from 0 to 1000 over the ramp duration
6. Update the timeline progress bar and timecode display

The `buildLetterFlowFor()` function takes one event (word or ghost) and returns an array of letter descriptors with axis values. This is where the visual logic for each stutter type lives.

`buildUtteranceSchedule()` takes one utterance and converts the letter flow into a time-stamped schedule (each letter has an `appearAt` ms relative to utterance start).

`computeUtteranceStarts()` distributes utterances across audio time using anchors when available, character-count proportional distribution otherwise.

## What I want to improve in Cursor

(Yehonatan, replace this section with your specific intent)

Some directions I might want to pursue:

1. **Film-strip mode** — currently all letters of an utterance appear stacked at composition center. I want a horizontal scrolling strip where the active word is centered, surrounding words fade to grey. Reference: I tried this once with `film-strip.html` (a separate Antigravity build).

2. **Better stutter visualization** — currently stutters render as N copies of a letter with descending STTR. Some viewers find this cluttered. Want to experiment with single-letter stutter where the letter "skips" via STTR oscillation while staying at one position.

3. **Per-utterance pacing tuning** — the typewriter speed (TIMING.charTime = 125ms) is one-size-fits-all. Some utterances feel rushed, others slow. Want to allow per-utterance speed override in the data.

4. **Audition CSV import** — replace the manual A-key anchoring with an import button that reads markers.csv exported from Adobe Audition.

5. **Render to video** — instead of screen-recording, render the canvas to a webm/mp4 file directly via MediaRecorder API or canvas-to-frames pipeline.

6. **Timing bezier curves** — replace linear PROL ramps with cubic-bezier easing for a more organic "vowel hold" feel.

## Constraints and design principles

- **Single-file architecture preferred.** The player is portable; I can email it, host it on Vercel, embed it. Don't fragment into multiple files unless there's a real reason.
- **Hebrew RTL is non-negotiable.** Every text element must be `direction: rtl; unicode-bidi: isolate`.
- **The font is the design.** Don't reach for non-typographic effects (color swaps, jitter animations, glow) when an axis change would do. The whole point of the variable font is that the *typography itself* expresses the speech disruption.
- **Don't add framework/build steps.** The file must remain runnable by double-clicking it. No Webpack, no React, no TypeScript compilation. Vanilla HTML/CSS/JS.
- **Don't break the timeline data structure.** Other tools (a Cavalry import script, an InDesign data merge for the zine) read `timeline_v2.json`. Schema is stable.

## Honest disclosure of limitations

- **Glyphs editor cannot be invoked from JS.** Font changes require re-exporting from Glyphs and re-embedding base64 in the HTML.
- **Hebrew shaping in CSS is imperfect.** When a single isolated Hebrew letter is rendered, it uses the isolated form, which doesn't match how it appears in continuous text. Don't try to "fix" this in JS — accept it.
- **Audio sync without anchors drifts.** The player needs at least 5–10 anchors per minute of audio to feel synced. The anchor system is the user's responsibility, not a bug to fix.

## My role in our work together

I'm a designer first, a coder second. I think in visual systems and design intent. When you suggest implementations, prefer:

- Plain JavaScript over abstracted patterns
- CSS-driven animation when possible
- Comments that explain *why*, not *what*
- Showing me visual previews/test renders before committing to a direction

Push back when my requests will hurt the design. I'd rather hear "that will look bad because X" than implement something I'll regret. The Megamgem font is a serious piece of work and the motion treatment should match.

## What to attach when starting in Cursor

Drop these files into your workspace at minimum:

1. `megamgem-motion-v6.html` — the player
2. `timeline_v2.json` — parsed transcript
3. `anchors01.json` — sync anchors
4. `stammer-text.rtf` — original transcript with notation
5. `TelAvivMegamgemVF.ttf` — the font (for reference, even though it's embedded)
6. `audio.mp3` — for testing playback

Optional for fuller context:
- Any earlier player versions (`megamgem-motion-v3.html`, `v4.html`, `v5.html`) showing the design evolution

## Starting prompt for Cursor

After attaching the files, your first message can be:

> Read PROJECT_CONTEXT.md to understand the project. Then read megamgem-motion-v6.html — particularly the TIMING constant block, buildLetterFlowFor function, and the renderAtTime loop. Don't change anything yet. Tell me what you think the cleanest place to add [feature X] would be, and what you'd need to know about the data structure before implementing it.

Replace `[feature X]` with the specific thing you want to work on first. Don't ask Cursor to do everything at once — pick one direction, ship it, then move to the next.
