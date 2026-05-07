/*
 * megamgem-import-axes.js
 * ────────────────────────────────────────────────────────────────────────────
 * MEGAMGEM SANS — Cavalry Import (Variable Axis Animation)
 *
 * Run this AFTER the minimal script. This rebuilds the comp using one text
 * layer PER LETTER (2,199 layers total) so each letter can have its own
 * PROL/STTR animation. This is heavier but enables the per-character control.
 *
 * Why per-letter layers?
 *   Cavalry's standard text layer uses one set of axis values for the whole
 *   string. To animate axes per character (which is what your design needs),
 *   each character needs to be its own shape. The script handles layout for
 *   you using calculated positions.
 *
 * IMPORTANT — variable axis attribute path:
 *   Cavalry exposes variable font axes through the text shape's font settings.
 *   The exact attribute name varies slightly between versions. The script
 *   tries several known paths in order. If none work, you'll see error logs;
 *   open one text shape, find the axis sliders manually in the Attributes
 *   panel, hover the slider to see the path, and update VARIABLE_AXIS_PATHS.
 * ────────────────────────────────────────────────────────────────────────────
 */

const FPS = 30;
const FONT_FAMILY = "MegamgemSans";
const FONT_SIZE = 84;
const STRIP_Y = 0;          // vertical center of strip
const LETTER_SPACING = 48;  // horizontal pixels per letter; tune to your font
const FILL_COLOR_ACTIVE = [1, 1, 1, 1];
const FILL_COLOR_GHOST = [0.55, 0.55, 0.55, 1];

// Known attribute paths for variable font axes — the script tries each in order
const VARIABLE_AXIS_PATHS = {
    PROL: [
        "text.fontVariations.PROL",
        "text.variableAxes.PROL",
        "text.openType.PROL",
        "text.axes.PROL"
    ],
    STTR: [
        "text.fontVariations.STTR",
        "text.variableAxes.STTR",
        "text.openType.STTR",
        "text.axes.STTR"
    ]
};

// Detect which path works for this Cavalry version
let workingAxisPath = { PROL: null, STTR: null };

function detectAxisPath(testId) {
    for (const axis of ["PROL", "STTR"]) {
        for (const path of VARIABLE_AXIS_PATHS[axis]) {
            try {
                api.set(testId, path, 0);
                workingAxisPath[axis] = path;
                console.log("Axis " + axis + " uses path: " + path);
                break;
            } catch (e) { /* try next */ }
        }
        if (!workingAxisPath[axis]) {
            console.log("⚠ Could not find a working path for " + axis + ".");
            console.log("  Open Attributes panel on a text shape, find the " + axis +
                        " slider, hover for the path, edit VARIABLE_AXIS_PATHS in this script.");
        }
    }
}

// ── Load data ───────────────────────────────────────────────────────────────
let dataPath = api.getOpenFilePath("Select cavalry-data.json", "*.json");
if (!dataPath) throw "Cancelled.";
const data = JSON.parse(api.readTextFile(dataPath));
console.log("Loaded " + data.all_letters.length + " letter events.");

// ── Detect API paths ────────────────────────────────────────────────────────
const probe = api.create("textShape", "_axis_probe");
api.set(probe, "text.text", "א");
api.set(probe, "text.fontFamily", FONT_FAMILY);
detectAxisPath(probe);
api.deleteShape(probe);

if (!workingAxisPath.PROL && !workingAxisPath.STTR) {
    console.log("✗ No working axis path found. The font may not be installed,");
    console.log("  or this Cavalry version uses a different attribute name.");
    console.log("  See instructions above for manual lookup.");
    throw "Axis paths unknown.";
}

// ── Helper: convert ms → frames ─────────────────────────────────────────────
const msToFrames = ms => Math.round((ms / 1000) * FPS);

// ── Group letters by utterance, lay them out as a strip ─────────────────────
console.log("Building letter shapes (this takes a moment)...");

const utteranceGroups = {};
data.all_letters.forEach((l, idx) => {
    const k = l.utt_id;
    if (!utteranceGroups[k]) utteranceGroups[k] = [];
    utteranceGroups[k].push({ ...l, _flat_idx: idx });
});

let totalCreated = 0;

for (const utt of data.utterances) {
    const letters = utteranceGroups[utt.id];
    if (!letters || letters.length === 0) continue;
    
    // Lay out letters horizontally (RTL: rightmost letter is first character)
    const totalWidth = letters.length * LETTER_SPACING;
    let x = totalWidth / 2;  // start at right edge
    
    for (const letter of letters) {
        const id = api.create("textShape",
                              "U" + utt.id + "_" + letter._flat_idx + "_" + letter.char);
        
        // Static attributes
        api.set(id, "text.text", letter.char);
        api.set(id, "text.fontFamily", FONT_FAMILY);
        api.set(id, "text.fontSize", FONT_SIZE);
        api.set(id, "fillColor", letter.is_ghost ? FILL_COLOR_GHOST : FILL_COLOR_ACTIVE);
        api.set(id, "transform.position", [x, STRIP_Y]);
        x -= LETTER_SPACING;
        
        // In/out: appear at abs_ms, disappear at end of comp (or per ghost timing)
        const inFrame = msToFrames(letter.abs_ms);
        try {
            api.set(id, "layer.startFrame", inFrame);
        } catch (e) {
            try { api.set(id, "inPoint", inFrame); } catch (e2) {}
        }
        
        // Variable axis values
        // For static letters: set once
        // For prolongation animation: keyframe from 0 → 1000 over the ramp duration
        if (letter.animates_prol && letter.prol_ramp_end_ms && workingAxisPath.PROL) {
            const startFrame = msToFrames(letter.abs_ms);
            const endFrame = msToFrames(letter.prol_ramp_end_ms);
            try {
                api.setKeyframe(id, workingAxisPath.PROL, startFrame, 0);
                api.setKeyframe(id, workingAxisPath.PROL, endFrame, 1000);
                api.setKeyframe(id, workingAxisPath.PROL, endFrame + 1, 1000);  // hold
            } catch (e) {
                // Fall back to static set
                api.set(id, workingAxisPath.PROL, 1000);
            }
        } else {
            if (workingAxisPath.PROL) {
                try { api.set(id, workingAxisPath.PROL, letter.prol); } catch (e) {}
            }
        }
        
        // STTR is always static per letter (the sequence of letters embodies the stutter)
        if (workingAxisPath.STTR) {
            try { api.set(id, workingAxisPath.STTR, letter.sttr); } catch (e) {}
        }
        
        totalCreated++;
        
        // Progress every 200 letters
        if (totalCreated % 200 === 0) {
            console.log("  ... " + totalCreated + " / " + data.all_letters.length);
        }
    }
}

console.log("");
console.log("Created " + totalCreated + " letter shapes.");
console.log("");
console.log("──────────────────────────────────────────────────────");
console.log("REFINEMENT TIPS");
console.log("──────────────────────────────────────────────────────");
console.log("1. Group all letters of one utterance: select them, ⌘G");
console.log("2. Add a single horizontal-translate keyframe to the group");
console.log("   to scroll the strip past the center as the audio plays.");
console.log("3. Add a fade in/out on each utterance group at its anchor.");
console.log("4. Audio waveform: enable in timeline view; drag any letter's");
console.log("   keyframe to align with a peak.");
console.log("──────────────────────────────────────────────────────");
