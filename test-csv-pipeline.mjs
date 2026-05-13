// v7 CSV pipeline test harness.
// Mirrors the parser/classifier/aligner logic embedded in megamgem-motion-v7.html
// and runs it against Markers2.csv + timeline_v2.json so we can verify the
// critical rule-3 / rule-4 cases without needing a browser.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- copy of the v7 helpers -------------------------------------------------

function isHebrewLetter(c) {
  if (!c) return false;
  const code = c.charCodeAt(0);
  return code >= 0x05D0 && code <= 0x05EA;
}

function parseAuditionTime(str) {
  const parts = str.split(':');
  if (parts.length === 2) {
    const m = parseInt(parts[0], 10);
    const s = parseFloat(parts[1]);
    if (isNaN(m) || isNaN(s)) return null;
    return Math.round((m * 60 + s) * 1000);
  }
  if (parts.length === 3) {
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const s = parseFloat(parts[2]);
    if (isNaN(h) || isNaN(m) || isNaN(s)) return null;
    return Math.round((h * 3600 + m * 60 + s) * 1000);
  }
  return null;
}

function parseAuditionCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length === 0) return { tokens: [], silences: [] };
  const headerCells = lines[0].split('\t');
  let nameIdx = headerCells.findIndex(h => /^name$/i.test(h.trim()));
  let startIdx = headerCells.findIndex(h => /^start$/i.test(h.trim()));
  if (nameIdx < 0) nameIdx = 0;
  if (startIdx < 0) startIdx = 1;
  const tokens = [];
  const silences = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split('\t');
    const name = (cells[nameIdx] || '').trim();
    const start = (cells[startIdx] || '').trim();
    if (!name || !start) continue;
    const startMs = parseAuditionTime(start);
    if (startMs == null) continue;
    if (/^silence$/i.test(name)) { silences.push({ startMs }); continue; }
    if (/^Marker\s*\d+$/i.test(name)) continue;
    tokens.push({ raw: name, startMs });
  }
  return { tokens, silences };
}

function extractStutters(inner) {
  const out = [];
  const stutters = [];
  let i = 0;
  while (i < inner.length) {
    const c = inner[i];
    if (isHebrewLetter(c) && i + 2 < inner.length && inner[i + 1] === '-') {
      let dashEnd = i + 1;
      while (dashEnd < inner.length && inner[dashEnd] === '-') dashEnd++;
      if (dashEnd < inner.length && inner[dashEnd] === c) {
        const dashCount = dashEnd - (i + 1);
        stutters.push({ type: 'prolong', letter: c, intensity: dashCount, position: out.length });
        out.push(c);
        i = dashEnd + 1;
        continue;
      }
    }
    if (isHebrewLetter(c)) {
      let runEnd = i + 1;
      while (runEnd < inner.length && inner[runEnd] === c) runEnd++;
      const runLen = runEnd - i;
      if (runLen >= 3) {
        stutters.push({ type: 'repeat', letter: c, intensity: runLen, position: out.length });
        out.push(c);
        i = runEnd; continue;
      }
      if (runLen === 2) {
        out.push(c); out.push(c);
        i = runEnd; continue;
      }
    }
    out.push(c);
    i++;
  }
  return { target: out.join(''), stutters };
}

function classifyToken(raw) {
  const leadingMatch = /^-+/.exec(raw);
  const trailingMatch = /-+$/.exec(raw);
  const leadingDashes = leadingMatch ? leadingMatch[0].length : 0;
  const trailingDashes = trailingMatch ? trailingMatch[0].length : 0;
  let inner = raw;
  if (leadingDashes) inner = inner.slice(leadingDashes);
  if (trailingDashes) inner = inner.slice(0, inner.length - trailingDashes);
  const { target, stutters } = extractStutters(inner);
  return { raw, leadingDashes, trailingDashes, inner, target, stutters };
}

function buildEventsFromTokens(tokens) {
  const events = [];
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    const cls = classifyToken(tok.raw);

    if (cls.trailingDashes > 0) {
      const next = tokens[i + 1];
      const nextCls = next ? classifyToken(next.raw) : null;
      if (nextCls && nextCls.leadingDashes > 0) {
        const heldLetter = cls.inner.slice(-1);
        const nextStartsWithHeld = nextCls.inner.length > 0 && nextCls.inner[0] === heldLetter;
        const combinedInner = nextStartsWithHeld
          ? cls.inner + nextCls.inner.slice(1)
          : cls.inner + nextCls.inner;
        const resolved = extractStutters(combinedInner);
        const bridgePosition = Math.max(0, cls.inner.length - 1);
        const bridgeStutter = {
          type: 'prolong-bridge',
          letter: heldLetter,
          intensity: cls.trailingDashes,
          position: bridgePosition,
          holdUntilMs: next.startMs,
        };
        const mergedStutters = [bridgeStutter, ...resolved.stutters.filter(s => s.position !== bridgePosition)];
        events.push({
          kind: 'word',
          target: resolved.target,
          startMs: tok.startMs,
          stutters: mergedStutters,
          rawSource: [tok.raw, next.raw],
        });
        i += 2;
        continue;
      }
      // Rule 4
      const attempts = [tok];
      let j = i + 1;
      while (j < tokens.length) {
        const t = tokens[j];
        attempts.push(t);
        if (!/-+$/.test(t.raw)) { j++; break; }
        j++;
      }
      const finalTok = attempts[attempts.length - 1];
      const finalCls = classifyToken(finalTok.raw);
      const attemptInners = attempts.map(t => classifyToken(t.raw).inner);
      const attemptStarts = attempts.map(t => t.startMs);
      events.push({
        kind: 'rewind',
        target: finalCls.target,
        startMs: tok.startMs,
        attempts: attemptInners,
        attemptStarts,
        finalStutters: finalCls.stutters,
        rawSource: attempts.map(t => t.raw),
      });
      i = j;
      continue;
    }

    if (cls.leadingDashes > 0) {
      events.push({ kind: 'word', target: cls.target, startMs: tok.startMs, stutters: cls.stutters, rawSource: [tok.raw] });
      i++; continue;
    }
    events.push({ kind: 'word', target: cls.target, startMs: tok.startMs, stutters: cls.stutters, rawSource: [tok.raw] });
    i++;
  }
  return events;
}

// ---- run --------------------------------------------------------------------

const csvText = fs.readFileSync(path.join(__dirname, 'Markers2.csv'), 'utf8');
const v2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'timeline_v2.json'), 'utf8'));

const { tokens, silences } = parseAuditionCSV(csvText);
const events = buildEventsFromTokens(tokens);

console.log('=== summary ===');
console.log('tokens:', tokens.length, 'silences:', silences.length, 'events:', events.length);

console.log('\n=== rule 1 (prolong mid-word) ===');
events.filter(e => e.stutters && e.stutters.some(s => s.type === 'prolong')).slice(0, 10).forEach(e => {
  const s = e.stutters.find(s => s.type === 'prolong');
  console.log(`  ${e.target.padEnd(15)} @ ${e.startMs}ms  prolong on ${s.letter} ×${s.intensity} pos=${s.position}  raw=${e.rawSource.join('+')}`);
});

console.log('\n=== rule 2 (repeat) ===');
events.filter(e => e.stutters && e.stutters.some(s => s.type === 'repeat')).forEach(e => {
  const s = e.stutters.find(s => s.type === 'repeat');
  console.log(`  ${e.target.padEnd(15)} @ ${e.startMs}ms  repeat on ${s.letter} ×${s.intensity} pos=${s.position}  raw=${e.rawSource.join('+')}`);
});

console.log('\n=== rule 3 (prolong-bridge) ===');
events.filter(e => e.stutters && e.stutters.some(s => s.type === 'prolong-bridge')).forEach(e => {
  const s = e.stutters.find(s => s.type === 'prolong-bridge');
  console.log(`  ${e.target.padEnd(15)} @ ${e.startMs}ms  bridge ${s.letter} ×${s.intensity} pos=${s.position} hold→${s.holdUntilMs}  raw=${e.rawSource.join('+')}`);
});

console.log('\n=== rule 4 (rewind) ===');
events.filter(e => e.kind === 'rewind').forEach(e => {
  console.log(`  ${e.target.padEnd(15)} @ ${e.startMs}ms  attempts=[${e.attempts.join(', ')}]  starts=[${e.attemptStarts.join(', ')}]`);
});

// ---- spot-checks ------------------------------------------------------------
function find(predicate, label) {
  const m = events.find(predicate);
  console.log(`  ${m ? 'OK' : 'FAIL'}  ${label}${m ? '' : ''}`);
  if (!m) console.log('       (no match)');
  return m;
}

console.log('\n=== spot checks ===');
// 1) "מג---" + "-מגם" should produce a single bridge prolong on the second ג of "מגמגם"
const bridgeMgmgm = find(
  e => e.kind === 'word' && e.target === 'מגמגם' && e.stutters?.some(s => s.type === 'prolong-bridge' && s.letter === 'ג'),
  'מג--- + -מגם → bridge on ג in מגמגם'
);
if (bridgeMgmgm) console.log('       startMs=' + bridgeMgmgm.startMs + ' holdUntilMs=' + bridgeMgmgm.stutters[0].holdUntilMs + ' position=' + bridgeMgmgm.stutters[0].position);

// 2) "שכ---" + "-כן" → bridge on כ in שכן
find(
  e => e.target === 'שכן' && e.stutters?.some(s => s.type === 'prolong-bridge' && s.letter === 'כ'),
  'שכ--- + -כן → bridge on כ in שכן'
);

// 3) "ל---" + "-למה" → bridge on ל at start of למה (held letter collapses)
find(
  e => e.target === 'למה' && e.stutters?.some(s => s.type === 'prolong-bridge' && s.letter === 'ל'),
  'ל--- + -למה → bridge on ל in למה'
);

// 4) "מ----" + "-משפט" → bridge on מ at start of משפט
find(
  e => e.target === 'משפט' && e.stutters?.some(s => s.type === 'prolong-bridge' && s.letter === 'מ'),
  'מ---- + -משפט → bridge on מ in משפט'
);

// 5) "כל-" + "כל" → rewind with attempts ["כל","כל"], target = "כל"
find(
  e => e.kind === 'rewind' && e.target === 'כל' && e.attempts?.length === 2,
  'כל- + כל → rewind with 2 attempts, target=כל'
);

// 6) The 5× "ח-" chain followed by "חברתית" → rewind with 6 attempts, target=חברתית
find(
  e => e.kind === 'rewind' && e.target === 'חברתית' && e.attempts?.length === 6,
  '5× ח- + חברתית → rewind with 6 attempts'
);

// 7) The 3× "א-" chain followed by "אני" → rewind with 4 attempts
find(
  e => e.kind === 'rewind' && e.target === 'אני' && e.attempts?.length === 4,
  '3× א- + אני → rewind with 4 attempts'
);

// 8) "ייייודע" → repeat on י with intensity 4
find(
  e => e.target === 'יודע' && e.stutters?.some(s => s.type === 'repeat' && s.letter === 'י' && s.intensity === 4),
  'ייייודע → repeat on י ×4'
);

// 9) "זוווכר" → repeat on ו with intensity 3
find(
  e => e.target === 'זוכר' && e.stutters?.some(s => s.type === 'repeat' && s.letter === 'ו' && s.intensity === 3),
  'זוווכר → repeat on ו ×3'
);

// 10) "ת-" + "ת-" + "ת--תאוריות" → rewind chain, final attempt carries prolong on ת
find(
  e => e.kind === 'rewind' && e.target === 'תאוריות'
    && e.finalStutters?.some(s => s.type === 'prolong' && s.letter === 'ת' && s.intensity === 2),
  '3× ת- → rewind, final attempt prolong on ת ×2'
);

// 11) "אה---ה" → prolong on ה ×3 (held letter collapses → target=אה)
find(
  e => e.target === 'אה' && e.stutters?.some(s => s.type === 'prolong' && s.letter === 'ה' && s.intensity === 3),
  'אה---ה → prolong on ה ×3 (target=אה, held ה collapses)'
);

// 12) "גימ-" + "ג--גי-" + "גימל" → rewind with 3 attempts, target=גימל
find(
  e => e.kind === 'rewind' && e.target === 'גימל' && e.attempts?.length === 3,
  'גימ- + ג--גי- + גימל → rewind with 3 attempts'
);

// 13) "בסו-" + "ב-בסוף" → rewind, target=בסוף, final attempt has internal prolong on ב
find(
  e => e.kind === 'rewind' && e.target === 'בסוף' && e.attempts?.length === 2
    && e.finalStutters?.some(s => s.type === 'prolong' && s.letter === 'ב'),
  'בסו- + ב-בסוף → rewind, final prolong on ב'
);

// 14) "ככה" alone → NOT a stutter (natural Hebrew double letter)
find(
  e => e.target === 'ככה' && (!e.stutters || e.stutters.length === 0),
  'ככה → plain word, no stutter'
);

console.log('\n=== alignment to v2 utterance buckets ===');
function normalizeWord(s) {
  if (!s) return '';
  return s
    .replace(/[\.,!?:;'"\u05F3\u05F4()]/g, '')
    .replace(/\u05DA/g, '\u05DB')
    .replace(/\u05DD/g, '\u05DE')
    .replace(/\u05DF/g, '\u05E0')
    .replace(/\u05E3/g, '\u05E4')
    .replace(/\u05E5/g, '\u05E6')
    .replace(/\s+/g, ' ')
    .trim();
}
function wordsMatch(a, b) {
  if (!a || !b) return false;
  const an = normalizeWord(a);
  const bn = normalizeWord(b);
  if (an === bn) return true;
  const aTokens = an.split(' ');
  const bTokens = bn.split(' ');
  if (aTokens.includes(bn) || bTokens.includes(an)) return true;
  if (an.length >= 2 && bn.length >= 2 && (an.startsWith(bn) || bn.startsWith(an))) return true;
  return false;
}

function alignToTranscript(events, timelineV2) {
  const result = [];
  let evIdx = 0;
  function matchesUpcomingBucket(csvTarget, fromBucketIdx) {
    for (let b = fromBucketIdx; b < Math.min(fromBucketIdx + 2, timelineV2.length); b++) {
      const v2utt = timelineV2[b];
      const peekCount = Math.min(3, v2utt.events.length);
      for (let k = 0; k < peekCount; k++) {
        const tgt = v2utt.events[k].target || v2utt.events[k].text || '';
        if (wordsMatch(csvTarget, tgt)) return true;
      }
    }
    return false;
  }
  for (let bIdx = 0; bIdx < timelineV2.length; bIdx++) {
    const v2utt = timelineV2[bIdx];
    const bucket = { utterance_id: v2utt.utterance_id, raw: v2utt.raw, events: [] };
    const unmatched = v2utt.events.map(e => ({ ...e }));
    while (unmatched.length > 0 && evIdx < events.length) {
      const csvEv = events[evIdx];
      const csvTarget = csvEv.target || '';
      const expected = unmatched[0];
      const expectedTarget = expected.target || expected.text || '';
      if (wordsMatch(csvTarget, expectedTarget)) {
        if (expected.kind === 'ghost') {
          bucket.events.push({ kind: 'ghost', text: expected.text, startMs: csvEv.startMs });
        } else {
          bucket.events.push(csvEv);
        }
        unmatched.shift();
        const csvSubTokens = normalizeWord(csvTarget).split(' ').filter(t => t.length > 0);
        for (let k = 1; k < csvSubTokens.length && unmatched.length > 0; k++) {
          const nextV2 = normalizeWord(unmatched[0].target || unmatched[0].text || '');
          if (csvSubTokens[k] === nextV2 ||
              (nextV2.length >= 2 && (csvSubTokens[k].startsWith(nextV2) || nextV2.startsWith(csvSubTokens[k])))) {
            unmatched.shift();
          } else {
            break;
          }
        }
        evIdx++; continue;
      }
      if (unmatched.length >= 2) {
        const nextExpected = unmatched[1].target || unmatched[1].text || '';
        if (wordsMatch(csvTarget, nextExpected)) { unmatched.shift(); continue; }
      }
      if (matchesUpcomingBucket(csvTarget, bIdx + 1)) {
        break;
      }
      if (evIdx + 1 < events.length) {
        const nextCsv = events[evIdx + 1].target || '';
        if (wordsMatch(nextCsv, expectedTarget)) {
          bucket.events.push({ ...csvEv, kind: 'filler' });
          evIdx++; continue;
        }
      }
      bucket.events.push({ ...csvEv, kind: 'filler' });
      evIdx++;
    }
    unmatched.forEach(e => bucket.events.push({ ...e }));
    result.push(bucket);
    if (evIdx >= events.length) {
      for (let k = bIdx + 1; k < timelineV2.length; k++) {
        result.push({ utterance_id: timelineV2[k].utterance_id, raw: timelineV2[k].raw, events: timelineV2[k].events.map(e => ({ ...e })) });
      }
      break;
    }
  }
  return result;
}

const aligned = alignToTranscript(events, v2);
const anchoredCount = aligned.filter(u => u.events.some(e => e.startMs != null)).length;
console.log('  utterances total:', aligned.length);
console.log('  utterances with at least one CSV-anchored event:', anchoredCount);
console.log('  fillers across whole timeline:', aligned.reduce((n, u) => n + u.events.filter(e => e.kind === 'filler').length, 0));

console.log('\n=== anchored summary by utterance ===');
aligned.forEach((u, i) => {
  const anchored = u.events.filter(e => e.startMs != null);
  const fillers = u.events.filter(e => e.kind === 'filler').length;
  const rewinds = u.events.filter(e => e.kind === 'rewind').length;
  const bridges = u.events.filter(e => (e.stutters || []).some(s => s.type === 'prolong-bridge')).length;
  if (anchored.length > 0) {
    const t0 = anchored[0].startMs / 1000;
    const tN = anchored[anchored.length - 1].startMs / 1000;
    console.log(`  utt ${String(i).padStart(2)}: ${u.events.length.toString().padStart(3)} events  ${anchored.length.toString().padStart(3)} anchored  ${fillers ? fillers + ' filler' : ''}${rewinds ? '  ' + rewinds + ' rewind' : ''}${bridges ? '  ' + bridges + ' bridge' : ''}  [${t0.toFixed(1)}s..${tN.toFixed(1)}s]`);
  } else {
    console.log(`  utt ${String(i).padStart(2)}: ${u.events.length.toString().padStart(3)} events  (no CSV anchor — legacy v2 events)`);
  }
});

console.log('\n=== utt 5 events (long, has ghosts) ===');
[5].forEach(idx => {
  const u = aligned[idx];
  console.log(`\n  utt ${u.utterance_id}: "${u.raw}"`);
  u.events.forEach(e => {
    const tag = e.kind === 'rewind' ? '↩'
      : e.kind === 'ghost' ? '👻'
      : e.kind === 'filler' ? '∗'
      : '·';
    const stutterDesc = (e.stutters || []).map(s => `[${s.type}:${s.letter}×${s.intensity}]`).join('');
    const ms = e.startMs != null ? `${(e.startMs / 1000).toFixed(3)}s` : '——';
    const target = e.target || e.text || e.attempts?.join('|') || '?';
    console.log(`    ${tag} ${ms.padStart(8)}  ${target.padEnd(20)} ${stutterDesc}`);
  });
});

// v7: write the produced timeline_v3.json so we can inspect it on disk
const cleaned = aligned.map(u => ({
  utterance_id: u.utterance_id,
  raw: u.raw,
  events: u.events.map(e => {
    const out = { ...e };
    delete out.rawSource;
    return out;
  }),
}));
fs.writeFileSync(path.join(__dirname, 'timeline_v3.json'), JSON.stringify(cleaned, null, 2), 'utf8');
console.log('\n=== wrote timeline_v3.json ===');

console.log('\n=== first 8 aligned utterances (events) ===');
aligned.slice(0, 8).forEach(u => {
  console.log(`\n  utt ${u.utterance_id}: "${u.raw}"`);
  u.events.forEach(e => {
    const tag = e.kind === 'rewind' ? '↩'
      : e.kind === 'ghost' ? '👻'
      : e.kind === 'filler' ? '∗'
      : '·';
    const stutterDesc = (e.stutters || []).map(s => `[${s.type}:${s.letter}×${s.intensity}]`).join('');
    const ms = e.startMs != null ? `${(e.startMs / 1000).toFixed(3)}s` : '——';
    const target = e.target || e.text || e.attempts?.join('|') || '?';
    console.log(`    ${tag} ${ms.padStart(8)}  ${target.padEnd(18)} ${stutterDesc}`);
  });
});
