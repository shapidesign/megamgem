#!/usr/bin/env python3
"""
generate_anchors.py
Uses ffmpeg silence detection to find utterance boundaries in the audio
and generates anchors.json for the megamgem-motion player.

Usage: python3 generate_anchors.py

Requires: ffmpeg (already installed)
"""
import re
import json
import subprocess
import os

AUDIO_FILE = "סליחה על השאלה ילדים 4  ילדים מגמגמים.mp3"
TIMELINE_FILE = "timeline_v2.json"
OUTPUT_FILE = "anchors.json"

# ─── Step 1: Get audio duration ───
result = subprocess.run(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration",
     "-of", "default=noprint_wrappers=1:nokey=1", AUDIO_FILE],
    capture_output=True, text=True
)
audio_duration = float(result.stdout.strip())
print(f"Audio duration: {audio_duration:.1f}s ({audio_duration/60:.1f} min)")

# ─── Step 2: Run silence detection ───
print("Running silence detection...")
result = subprocess.run(
    ["ffmpeg", "-i", AUDIO_FILE, "-af", "silencedetect=noise=-30dB:d=0.4",
     "-f", "null", "-"],
    capture_output=True, text=True
)
raw = result.stderr

# Parse silence_start and silence_end
silences = []
starts = re.findall(r'silence_start:\s*([\d.]+)', raw)
ends = re.findall(r'silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)', raw)

for i in range(min(len(starts), len(ends))):
    s = float(starts[i])
    e = float(ends[i][0])
    d = float(ends[i][1])
    silences.append({'start': s, 'end': e, 'duration': d})

print(f"Found {len(silences)} silence gaps")

# ─── Step 3: Load timeline ───
with open(TIMELINE_FILE, 'r', encoding='utf-8') as f:
    timeline = json.load(f)

N = len(timeline)
print(f"Timeline has {N} utterances")

# ─── Step 4: Find major silences (utterance boundaries) ───
# Strategy: We need N-1 boundaries for N utterances.
# Sort silences by duration (descending) and pick the top N-1 longest ones.
# These should correspond to the gaps between utterances.

# But first, filter out very short silences that are just within-word pauses
# and focus on silences > threshold
MIN_SILENCE = 0.6  # minimum silence duration to consider as utterance boundary

major_silences = [s for s in silences if s['duration'] >= MIN_SILENCE]
print(f"Major silences (>={MIN_SILENCE}s): {len(major_silences)}")

# If we still have too many, progressively increase threshold
threshold = MIN_SILENCE
while len(major_silences) > N * 2 and threshold < 3.0:
    threshold += 0.05
    major_silences = [s for s in silences if s['duration'] >= threshold]

print(f"Using threshold {threshold:.2f}s -> {len(major_silences)} silence gaps")

# We need exactly N-1 boundaries. Sort by duration and take the top N-1
if len(major_silences) >= N - 1:
    # Sort by duration (longest first) and take top N-1
    sorted_by_dur = sorted(major_silences, key=lambda s: s['duration'], reverse=True)
    boundaries = sorted(sorted_by_dur[:N-1], key=lambda s: s['end'])
else:
    # Not enough silences found, use what we have
    boundaries = sorted(major_silences, key=lambda s: s['end'])
    print(f"WARNING: Only found {len(boundaries)} boundaries for {N} utterances")

# ─── Step 5: Generate anchors ───
# Utterance 0 starts at the first speech (after initial silence, or at 0)
# Each subsequent utterance starts at the end of each boundary silence

anchors = {}

# Find the first speech start (end of first silence if audio starts silent)
first_speech = 0
for s in silences:
    if s['start'] < 1.0:  # audio starts with silence
        first_speech = s['end']
        break

anchors[0] = int(first_speech * 1000)

for i, boundary in enumerate(boundaries):
    utt_idx = i + 1
    if utt_idx < N:
        anchors[utt_idx] = int(boundary['end'] * 1000)

# ─── Step 6: Output ───
print(f"\n{'='*60}")
print(f"Generated {len(anchors)} anchors for {N} utterances")
print(f"Coverage: {len(anchors)}/{N} = {100*len(anchors)/N:.0f}%")
print(f"{'='*60}\n")

for idx in sorted(anchors.keys()):
    ms = anchors[idx]
    s = ms / 1000
    raw_preview = timeline[idx]['raw'][:40]
    print(f"  [{idx:2d}] {s:7.2f}s  ({int(s//60)}:{int(s%60):02d})  \"{raw_preview}\"")

with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
    json.dump(anchors, f, indent=2)

print(f"\n✅ Wrote {OUTPUT_FILE}")
print(f"""
─────────────────────────────────────────────────────────
NEXT STEPS:

1. Open megamgem-motion-v6.html in your browser
2. Open DevTools → Console (Cmd+Option+J)
3. Paste this:

   localStorage.setItem('megamgem_anchors_v5', '{json.dumps(anchors)}');
   location.reload();

4. Load the audio file and press Play to check sync
5. Fine-tune with the 'A' key if any utterances are off
─────────────────────────────────────────────────────────
""")
