#!/usr/bin/env python3
"""
sync_anchors_with_whisper.py
─────────────────────────────────────────────────────────────────────────────
Run this LOCALLY on your Mac to produce perfect anchor timings for the
megamgem-motion player.

WHAT IT DOES
  1. Transcribes your audio with OpenAI Whisper (Hebrew, with word timestamps)
  2. Matches whisper words to the transcript utterances in timeline_v2.json
  3. Outputs `anchors.json` — paste into the player's localStorage
     (or import via the Anchors button in v6 of the player)

REQUIREMENTS
  pip install faster-whisper
  ffmpeg installed (brew install ffmpeg)
  ~5GB disk space for the model on first run
  ~10 min on M1/M2 Mac to transcribe a 17 min audio

USAGE
  python3 sync_anchors_with_whisper.py audio.mp3 timeline_v2.json

OUTPUT
  anchors.json — { "0": 3450, "1": 7220, ... }   (utterance_idx → ms)

─────────────────────────────────────────────────────────────────────────────
"""
import sys
import json
import re
import os
from difflib import SequenceMatcher

if len(sys.argv) < 3:
    print("Usage: python sync_anchors_with_whisper.py <audio.mp3> <timeline_v2.json>")
    sys.exit(1)

AUDIO_PATH = sys.argv[1]
TIMELINE_PATH = sys.argv[2]

# ─────────────────────────────────────────────────────────────────────
# 1. Transcribe with whisper
# ─────────────────────────────────────────────────────────────────────
print("Loading whisper model (first run will download ~500MB)...")
from faster_whisper import WhisperModel

# Use 'small' for speed, 'medium' for better accuracy. 
# 'large-v3' is the most accurate but slow on CPU.
MODEL_SIZE = "medium"   # change to "small" if too slow, or "large-v3" for max accuracy
model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")

print(f"Transcribing {AUDIO_PATH} (this takes ~real-time on CPU)...")
segments, info = model.transcribe(
    AUDIO_PATH,
    language="he",
    word_timestamps=True,
    vad_filter=True,
)

# Collect all words with their timestamps
whisper_words = []
for seg in segments:
    if seg.words:
        for w in seg.words:
            whisper_words.append({
                'text': w.word.strip(),
                'start_ms': int(w.start * 1000),
                'end_ms': int(w.end * 1000),
            })

print(f"Got {len(whisper_words)} words from whisper")

# Write raw whisper output for debugging
with open("whisper_raw.json", "w", encoding="utf-8") as f:
    json.dump(whisper_words, f, ensure_ascii=False, indent=2)

# ─────────────────────────────────────────────────────────────────────
# 2. Load transcript utterances
# ─────────────────────────────────────────────────────────────────────
with open(TIMELINE_PATH, "r", encoding="utf-8") as f:
    timeline = json.load(f)

# For each utterance, get the first 2-3 words (clean, no stutter notation)
def first_clean_words(utt, n=3):
    """Get the first n non-ghost target words from the utterance, cleaning stutter chars."""
    words = []
    for ev in utt['events']:
        if ev['kind'] == 'word' and ev.get('target'):
            target = ev['target']
            # Remove punctuation
            target = re.sub(r"[.,!?:;׳״\']+$", '', target)
            if target:
                words.append(target)
                if len(words) >= n:
                    break
    return words


def normalize_hebrew(s):
    """Lowercase-equivalent for Hebrew comparison: strip nikkud, punctuation, spaces."""
    s = re.sub(r"[\u0591-\u05C7]", "", s)  # strip nikkud/cantillation
    s = re.sub(r"[^\u0590-\u05FF]", "", s)
    return s


# ─────────────────────────────────────────────────────────────────────
# 3. Match each utterance's first words to the whisper word stream
# ─────────────────────────────────────────────────────────────────────
print(f"\nMatching {len(timeline)} utterances to whisper words...")

anchors = {}
last_match_idx = 0   # to ensure we move forward through the audio

for utt in timeline:
    utt_id = utt['utterance_id']
    target_words = first_clean_words(utt, n=3)
    if not target_words:
        continue

    target_phrase = ' '.join(target_words)
    target_norm = normalize_hebrew(target_phrase)
    if not target_norm:
        continue

    # Search forward in whisper_words for the best match
    best_score = 0.0
    best_idx = None
    
    # Window: search next 50 words from last match position
    search_end = min(len(whisper_words), last_match_idx + 80)
    for i in range(last_match_idx, search_end):
        # Build a candidate phrase from i to i+5
        candidate = ' '.join(w['text'] for w in whisper_words[i:i+5])
        cand_norm = normalize_hebrew(candidate)
        if not cand_norm:
            continue
        # SequenceMatcher gives a similarity ratio
        score = SequenceMatcher(None, target_norm[:20], cand_norm[:20]).ratio()
        if score > best_score:
            best_score = score
            best_idx = i

    if best_idx is not None and best_score > 0.45:
        anchors[utt_id] = whisper_words[best_idx]['start_ms']
        last_match_idx = best_idx + 1
        match_text = ' '.join(w['text'] for w in whisper_words[best_idx:best_idx+3])
        print(f"  Utt {utt_id:2d}  @ {whisper_words[best_idx]['start_ms']/1000:6.2f}s  "
              f"score={best_score:.2f}  target='{target_phrase[:30]}'  match='{match_text[:30]}'")
    else:
        print(f"  Utt {utt_id:2d}  ✗ NO MATCH  target='{target_phrase[:30]}'")

# ─────────────────────────────────────────────────────────────────────
# 4. Write anchors.json
# ─────────────────────────────────────────────────────────────────────
out_path = "anchors.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(anchors, f, indent=2)

print(f"\nWrote {len(anchors)} anchors to {out_path}")
print(f"Total utterances: {len(timeline)}")
print(f"Coverage: {len(anchors)}/{len(timeline)} = {100*len(anchors)/len(timeline):.0f}%")

# ─────────────────────────────────────────────────────────────────────
# 5. Instructions
# ─────────────────────────────────────────────────────────────────────
print("""
─────────────────────────────────────────────────────────────────────────
NEXT STEP: load anchors into the player

Open megamgem-motion-v5.html in your browser. Open DevTools → Console.
Run:

    fetch('anchors.json').then(r => r.json()).then(a => {
      localStorage.setItem('megamgem_anchors_v5', JSON.stringify(a));
      location.reload();
    });

(Or open anchors.json, copy the JSON, and run:
   localStorage.setItem('megamgem_anchors_v5', '<paste>'); location.reload();)

For utterances marked NO MATCH above, you'll need to anchor those manually
with the 'A' key in the player.
─────────────────────────────────────────────────────────────────────────
""")
