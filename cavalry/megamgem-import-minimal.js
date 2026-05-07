/*
 * megamgem-import-minimal.js
 * ────────────────────────────────────────────────────────────────────────────
 * MEGAMGEM SANS — Cavalry Import (Minimal)
 * 
 * Creates the Cavalry composition structure: composition with audio, one text
 * layer per utterance, positioned in time using your synced anchor data.
 * 
 * What this script DOES:
 *   ✓ Creates a 1920×1080 composition at 30fps, ~17.5 minutes long
 *   ✓ Imports the audio file (you'll be prompted to locate it)
 *   ✓ Creates 43 text layers, one per utterance, each containing the cleaned
 *     transcript text (stutter notation converted to readable Hebrew)
 *   ✓ Sets each layer's start frame to its synced anchor_ms timestamp
 *   ✓ Pre-sets the font to MegamgemSans (you must have it installed in macOS)
 *
 * What this script does NOT do:
 *   ✗ Animate the variable font axes — that's the FULL script
 *   ✗ Position or animate the camera/film-strip motion
 *   ✗ Style the dim/bright greys — set those once, copy to all layers
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SETUP
 *   1. Install TelAvivMegamgemVF.ttf into macOS Font Book
 *   2. Open Cavalry → New Project (any size, we'll override)
 *   3. Window → Editor → paste this script → ⌘R to run
 *   4. When prompted, select cavalry-data.json and your audio file
 * ────────────────────────────────────────────────────────────────────────────
 */

// ── Composition settings ────────────────────────────────────────────────────
const COMP_W = 1920;
const COMP_H = 1080;
const FPS = 30;

// ── Load the data ───────────────────────────────────────────────────────────
let dataPath = api.getOpenFilePath("Select cavalry-data.json", "*.json");
if (!dataPath) { console.log("Cancelled."); throw "No data file."; }

let data;
try {
    let raw = api.readTextFile(dataPath);
    data = JSON.parse(raw);
} catch (e) {
    console.log("Could not parse cavalry-data.json: " + e);
    throw e;
}
console.log("Loaded " + data.utterances.length + " utterances.");

// ── Audio file ──────────────────────────────────────────────────────────────
let audioPath = api.getOpenFilePath("Select the audio MP3", "*.mp3 *.wav *.m4a");
// (Audio path is optional — script proceeds either way.)

// ── Compute total duration ──────────────────────────────────────────────────
const lastUtt = data.utterances[data.utterances.length - 1];
const totalMs = (lastUtt.anchor_ms || 0) + (lastUtt.rel_duration_ms || 5000) + 2000;
const durationFrames = Math.ceil((totalMs / 1000) * FPS);

// ── Create or reset composition ─────────────────────────────────────────────
api.openCompositionEditor();
api.setCompositionResolution(COMP_W, COMP_H);
api.setCompositionFPS(FPS);
api.setCompositionDuration(durationFrames);
console.log("Composition: " + COMP_W + "×" + COMP_H + " @ " + FPS + "fps, " + durationFrames + " frames");

// ── Helper: clean stutter notation from raw text ────────────────────────────
function cleanRaw(raw) {
    // Strip parentheses but keep ghost text (we'll handle ghosts separately later)
    let cleaned = raw.replace(/\([^)]+\)/g, "");
    // Collapse repeated letters (אאאני → אני)
    cleaned = cleaned.replace(/([\u0590-\u05FF])\1{2,}/g, "$1");
    // Collapse dash-repetitions (ל-למה → למה)
    cleaned = cleaned.replace(/([\u0590-\u05FF])(?:-\1)+/g, "$1");
    // Collapse prolongations (ה---האחים → האחים)
    cleaned = cleaned.replace(/([\u0590-\u05FF])-{2,}\1/g, "$1");
    // Squeeze whitespace
    cleaned = cleaned.replace(/\s+/g, " ").trim();
    return cleaned;
}

// ── Add audio layer if provided ─────────────────────────────────────────────
if (audioPath) {
    try {
        const audioId = api.create("audio", "Audio");
        api.set(audioId, "filePath", audioPath);
        console.log("Audio layer created.");
    } catch (e) {
        console.log("Could not create audio layer (may need manual import): " + e);
    }
}

// ── Create one text layer per utterance ─────────────────────────────────────
let createdCount = 0;
for (let i = 0; i < data.utterances.length; i++) {
    const utt = data.utterances[i];
    const text = cleanRaw(utt.raw);
    if (!text) continue;
    
    const id = api.create("textShape", "Utt_" + String(utt.id).padStart(2, "0"));
    
    // Set text content
    api.set(id, "text.text", text);
    
    // Font — adjust the family name if your installed font appears differently
    api.set(id, "text.fontFamily", "MegamgemSans");
    api.set(id, "text.fontSize", 84);
    api.set(id, "text.alignment", 1); // center; adjust if your Cavalry uses different enum
    
    // RTL handling — Cavalry's text layer respects Unicode bidi
    // (set this attribute name based on your version: text.direction or similar)
    try { api.set(id, "text.direction", 1); } catch (e) { /* not all versions */ }
    
    // Color (white)
    api.set(id, "fillColor", [1, 1, 1, 1]);
    
    // Position (center of composition)
    api.set(id, "transform.position", [0, 0]);
    
    // Layer in/out frames based on anchor_ms
    const startFrame = Math.round((utt.anchor_ms || 0) / 1000 * FPS);
    let nextAnchor = totalMs;
    for (let j = i + 1; j < data.utterances.length; j++) {
        if (data.utterances[j].anchor_ms !== null) {
            nextAnchor = data.utterances[j].anchor_ms;
            break;
        }
    }
    const endFrame = Math.round(nextAnchor / 1000 * FPS);
    
    try {
        api.set(id, "layer.startFrame", startFrame);
        api.set(id, "layer.endFrame", endFrame);
    } catch (e) {
        // Alternative naming used by some Cavalry versions
        try {
            api.set(id, "inPoint", startFrame);
            api.set(id, "outPoint", endFrame);
        } catch (e2) {
            console.log("Could not set layer in/out for utt " + utt.id);
        }
    }
    
    createdCount++;
}

console.log("Created " + createdCount + " text layers.");
console.log("");
console.log("──────────────────────────────────────────────────────");
console.log("NEXT STEPS");
console.log("──────────────────────────────────────────────────────");
console.log("1. Verify the audio is in sync — scrub the timeline");
console.log("2. Style one text layer (color, weight, position)");
console.log("3. Right-click → Copy Attributes, paste to all others");
console.log("4. Run megamgem-import-axes.js to add stutter animation");
console.log("──────────────────────────────────────────────────────");
