/**
 * Durable tests for voice routing (ms4, 2026-11-01). These prove
 * the deterministic transcript -> intent contract only; microphone
 * capture and live STT are verified on-device (docs/53 checklist).
 * Run: node scripts/voice.test.mjs
 */
import { readFileSync } from 'node:fs';
import { routeTranscript, correctTranscript, describeIntent, encodeWav16k, bufferRms, normalizeSpeechLevels, pickBestTranscript, pickSpeechChannel, shouldSpeakReply, forSpokenText, OUT_OF_SCOPE_MESSAGE, SEARCH_OUTCOME_HITS, VOICE_HELP_LINES } from '../src/voice.ts';

let failures = 0;
const check = (name, condition) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}`);
  if (!condition) failures += 1;
};
const intent = (text, pending = false) => routeTranscript(text, pending);
const is = (text, kind, extra = {}) => {
  const got = intent(text, extra.pending ?? false);
  const ok = got.kind === kind && Object.entries(extra)
    .filter(([k]) => k !== 'pending')
    .every(([k, v]) => got[k] === v);
  if (!ok) console.log(`   "${text}" -> ${JSON.stringify(got)} (wanted ${kind} ${JSON.stringify(extra)})`);
  return ok;
};

// STT repair (live-observed Wit outputs, 2026-11-01).
check('repairs "Elena Ray\'s" to Elena Reyes', correctTranscript("Who did Elena Ray's email about the Falcon source code?").includes('Elena Reyes'));
check('repairs bare Ray\'s', correctTranscript("show me ray's documents").includes('Reyes'));
check('repairs U.S.B. spelling', correctTranscript('find u s b events').includes('USB'));

// Session control.
check('confirm with pending', is('Confirm', 'confirm', { pending: true }));
check('cancel discards', is('never mind', 'cancel'));
check('stop halts', is('stop', 'stop'));
check('help lists commands', is('what can i say', 'help'));
check('long confirm-question is staged, not swallowed',
  is('Can you confirm whether Reyes resigned in June', 'stage'));

// Tabs use the VISIBLE labels.
check('open investigate', is('open investigate', 'tab', { tab: 'investigate' }));
check('open search is the Search tab', is('open search', 'tab', { tab: 'search' }));
check('go to approve', is('go to approve', 'tab', { tab: 'approve' }));
check('show export tab', is('show the export tab', 'tab', { tab: 'export' }));
check('bare explore', is('explore', 'tab', { tab: 'explore' }));

// Consequential decisions are never voice-executed.
check('approve finding is tap-only', is('approve that finding', 'tap-only'));
check('reject draft is tap-only', is('reject this draft', 'tap-only'));
check('export all is tap-only', is('export everything as zip', 'tap-only'));
check('mark is tap-only', is('mark those documents', 'tap-only'));

// Investigate + Explore.
check('find leads', is('find leads', 'leads'));
check('investigate leads opens leads (never staged)', is('investigate leads', 'leads'));
check('homophone fine leaves repairs to find leads', is('fine leaves', 'leads'));
check('observed mishearings: friendly / find AIDS / bare leaves',
  is('friendly', 'leads') && is('find AIDS', 'leads') && is('leaves', 'leads'));
check('explore one (lead word dropped) opens lead 1', is('explore one', 'lead', { index: 0 }));
check('observed mishearings: Joe pools / explain three',
  is('Joe pools', 'panel', { visible: true })
  && is('explain three', 'lead', { index: 2 })
  && is('show tools', 'panel', { visible: true }));
check('fuzzy command matching rescues near-miss commands only',
  is('show Lee', 'leads')
  && is('explore tree', 'lead', { index: 2 })
  && is('show', 'panel', { visible: true })
  && is('tools', 'panel', { visible: true })
  && is('show me the tools please', 'panel', { visible: true })
  && is('find lead', 'leads')
  && is('who emailed Reyes about Falcon', 'stage'));
check('best alternative wins over a staged top choice',
  pickBestTranscript(['what about the leads over there', 'find leads'], false) === 'find leads'
  && pickBestTranscript(['who emailed Reyes'], false) === 'who emailed Reyes');
// Desktop regression (owner live diag, 2026-11-04): Web Speech
// returned these exact transcripts on the room mic. "Find
// beads." became a keyword search, bare "Find." staged an AI
// question, and once staged, pending state disabled the fuzzy
// rescue so follow-up navigation also failed.
check('observed desktop mishearings: find beads / bare Find / bare Clusters',
  is('Find beads.', 'leads')
  && is('find needs', 'leads')
  && is('Find.', 'leads')
  && is('Clusters.', 'lens', { lens: 'concepts' }));
check('navigation still routes while a question is pending',
  is('Show clusters.', 'lens', { lens: 'concepts', pending: true })
  && is('Show such clusters.', 'lens', { lens: 'concepts', pending: true })
  && is('who emailed Reyes about Falcon', 'stage', { pending: true }));
check('explicit search for clusters stays a search',
  is('search for clusters', 'search', { term: 'clusters' }));
{
  const panelSrc = readFileSync(new URL('../src/panel.ts', import.meta.url), 'utf8');
  const drainBody = panelSrc.slice(panelSrc.indexOf('private drainTts()'), panelSrc.indexOf('update(): void {'));
  const onresultBody = panelSrc.slice(panelSrc.indexOf('rec.onresult'), panelSrc.indexOf('rec.onerror'));
  check('webspeech silence endpoint uses interim text (no 6s lag after speaking)',
    onresultBody.includes('finalText || interimText'));
  check('TTS never starts while voice capture is active (speaker self-hearing)',
    drainBody.includes('captureActive')
    && panelSrc.indexOf('speakQueue.length = 0', panelSrc.indexOf('const startVoice')) > panelSrc.indexOf('const startVoice'));
}
check('explore lead two', is('explore lead two', 'lead', { index: 1 }));
check('lead 3', is('open lead 3', 'lead', { index: 2 }));
check('prepare draft finding', is('prepare draft finding', 'draft'));
check('concept clusters lens', is('show concept clusters', 'lens', { lens: 'concepts' }));
check('custodians lens', is('custodians lens', 'lens', { lens: 'custodians' }));
check('file types lens', is('file types', 'lens', { lens: 'filetypes' }));
check('timeline is chronology', is('show the timeline', 'lens', { lens: 'chronology' }));
check('network lens', is('network lens', 'lens', { lens: 'network' }));
check('trade secret corpus', is('load the trade secret corpus', 'corpus', { corpus: 'tradesecret' }));
check('galaxy 500', is('galaxy 500', 'corpus', { corpus: 'galaxy', galaxyCount: 500 }));
check('galaxy defaults 1000', is('galaxy one thousand', 'corpus', { corpus: 'galaxy', galaxyCount: 1000 }));

// Navigation + panel.
check('next hit', is('next hit', 'nav', { action: 'next' }));
// Menu page strip pages the source card (owner, 2026-11-02:
// canvas planes cut, menu strip kept).
check('next page turns the card', is('next page', 'nav', { action: 'page' }));
check('previous page turns the card', is('previous page', 'nav', { action: 'page-prev' }));
// Explore-lead repair (owner, 2026-11-02): "explore lead 2"
// must open lead 2, never a search for "to".
check('explore lead two opens lead 2', is('explore lead two', 'lead', { index: 1 }));
check('explore lead to (misheard) opens lead 2', is('explore lead to', 'lead', { index: 1 }));
check('bare lead 2 opens lead 2', is('lead 2', 'lead', { index: 1 }));
check('next draft', is('next draft', 'finding-nav', { action: 'finding-next' }));
check('clear search', is('clear search', 'nav', { action: 'clear' }));
check('prepare new search suggestions', is('prepare new search suggestions', 'nav', { action: 'suggest-more' }));
check('prepare search suggestions', is('prepare search suggestions', 'nav', { action: 'suggest-more' }));
check('hide panel', is('hide panel', 'panel', { visible: false }));
check('show more tools expands tools', is('show more tools', 'panel', { visible: true }));
check('hide tools compresses tools', is('hide tools', 'panel', { visible: false }));
check('expand universe', is('expand universe', 'scale', { expanded: true }));

// Search + ask.
check('search for source code', is('Search for source code.', 'search', { term: 'source code' }));
check('find documents containing x', is('find documents containing source code', 'search', { term: 'source code' }));
check('search Reyes after repair', is("search ray's", 'search', { term: 'Reyes' }));
check('ask prefix runs at once', is('Ask who emailed Reyes about Falcon', 'ask'));
check('ask prefix keeps question', intent('Ask who emailed Reyes about Falcon').question === 'who emailed Reyes about Falcon');
check('plain question is staged', is('Who did Elena Reyes email about the Falcon source code?', 'stage'));
check('question-shaped find is staged, not keyword search', is('find who sent the Falcon files externally', 'stage'));
check('empty transcript', is('   ', 'empty'));

// Owner's exact example utterances (2026-11-01 speech-log request).
check('owner ex1: polite chronology request', is('Please show me the chronology view of this data set?', 'lens', { lens: 'chronology' }));
check('owner ex2: polite highlight request', is('Can you please highlight the documents that hit on falcon?', 'search', { term: 'Falcon' }));
check('owner ex3: thanks + change to concepts', is("Thanks, let's change to concept clusters, please.", 'lens', { lens: 'concepts' }));
check('bare highlight term', is('highlight USB', 'search', { term: 'USB' }));
check('please confirm still confirms', is('please confirm', 'confirm', { pending: true }));

// Speech-log acknowledgements name the responding specialist.
check('ack chronology', describeIntent(intent('show chronology')) === 'Explore: Chronology view accessed.');
check('ack concepts', describeIntent(intent('concept clusters')) === 'Explore: Concept clusters view accessed.');
check('ack search is in-progress (outcome adds count)', describeIntent(intent('search for Falcon')) === 'Search expert: searching for "Falcon"…');
check('ack stage shows the exact question + CONFIRM', (describeIntent(intent('Who resigned in June?')) ?? '').includes('CONFIRM'));
check('ack ask announces immediate run', (describeIntent(intent('Ask who resigned')) ?? '').startsWith('Investigate specialist: asking'));
check('how many hit on term = search', is('How many documents hit on the term Falcon?', 'search', { term: 'Falcon' }));
check('organize by file type = lens', is('Great, now organize that by file type for me, please?', 'lens', { lens: 'filetypes' }));
check('add to report submits', is('add that to the search term report', 'submit-report'));
check('approve routes to export ack', (describeIntent(intent('open approve')) ?? '').includes('Export'));
check('open hit three', is('open hit three', 'hit', { index: 2 }));
check('first hit', is('first hit', 'hit', { index: 0 }));
check('last hit', is('last hit', 'hit', { index: -1 }));
check('explore the hits starts stepping', is('explore the hits', 'nav', { action: 'next' }));
check('out of scope: time', is('What time is it?', 'out-of-scope'));
check('out of scope: joke', is('Tell me a joke', 'out-of-scope'));
check('out of scope: greeting/identity', is('Who are you?', 'out-of-scope'));
check('out of scope: external send', is('Email this to my boss', 'out-of-scope'));
check('out of scope: legal verdict even with corpus name', is('Is Elena Reyes guilty?', 'out-of-scope'));
check('in scope: evidence question still stages', is('Who knew about the resignation first?', 'stage'));
check('in scope: person question still stages', is('Who is Reyes?', 'stage'));
check('make it bigger expands', is('make it bigger', 'scale', { expanded: true }));
check('mute', is('mute', 'sound', { on: false }));
check('voice on', is('voice on', 'sound', { on: true }));

// Owner wording session 2026-11-01.
// 1) Search outcome: hit-stepping first, then a clearly
//    separated "Other Suggestions" block with blank lines.
check('search outcome names next/previous hit stepping',
  SEARCH_OUTCOME_HITS.startsWith('Say next or previous hit to explore the source text.'));
check('search outcome separates Other Suggestions with blank lines',
  SEARCH_OUTCOME_HITS.includes('\n\n\nOther Suggestions:'));
// 2) Out-of-scope (e.g. a joke): the owner-exact one-line
//    reply — spoken and shown, never a stub.
check('out-of-scope message is the owner-exact line',
  OUT_OF_SCOPE_MESSAGE === 'That is out of scope for what voice can do. Please press or say: voice help or show tools for more options.');
// Owner session 2026-11-01 fixes.
// 3) Out-of-scope ack is the same one-line reply.
check('out-of-scope ack is the single owner line',
  describeIntent(intent('Tell me a joke')) === OUT_OF_SCOPE_MESSAGE);
check('clear-search accepts natural phrasings',
  is('clear the search', 'nav', { action: 'clear' })
  && is('please clear the search', 'nav', { action: 'clear' })
  && is('can you please clear the search', 'nav', { action: 'clear' }));
check('help card keeps the memo skeleton (title/summary/4 numbered sections + spoken footer)',
  VOICE_HELP_LINES[0] === '# Voice Help — what can I say?'
  && VOICE_HELP_LINES.includes('## EXECUTIVE SUMMARY')
  && VOICE_HELP_LINES.some((l) => l.startsWith('## EXECUTIVE SUMMARY') || l.includes('Use voice commands to explore, investigate, search, and export'))
  && VOICE_HELP_LINES.filter((line) => /^\*\*[1-4]\./.test(line)).length === 4
  && VOICE_HELP_LINES.filter((line) => /^[a-c]\./.test(line)).length >= 8
  && VOICE_HELP_LINES[VOICE_HELP_LINES.length - 1].includes('All tool buttons can be spoken'));

// Owner session 2026-11-01, round 2: failsafe prefixes +
// investigate scope. The Search expert owns search-prefixed
// asks; Explore owns explore/show/take-me-to; Investigate owns
// investigate/research/find-out/I-need-to-know.
check('failsafe: "search: Falcon" is a search', is('search: Falcon', 'search', { term: 'Falcon' }));
check('failsafe: "please search Reyes" is a search', is('please search Reyes', 'search', { term: 'Reyes' }));
check('failsafe: "investigate Reyes" stages the remainder', is('investigate Reyes', 'stage', { question: 'Reyes' }));
check('failsafe: "research Falcon USB" stages', is('research the Falcon USB transfers', 'stage'));
check('failsafe: "find out who resigned" stages', is('find out who resigned in June', 'stage'));
check('failsafe: "I need to know" stages', is('I need to know who approved the escrow', 'stage'));
check('failsafe: bare "research" opens leads', is('research', 'leads'));
check('failsafe: unknown view is guidance, not a staged question',
  is('explore the settings page', 'explore-unknown') && (describeIntent(intent('explore the settings page')) ?? '').includes("doesn't exist"));
check('failsafe: known lens still wins over explore prefix', is('explore custodians', 'lens', { lens: 'custodians' }));
check('scope: "hits only" bounds investigation', is('limit it to hits only', 'scope', { scope: 'hits' }));
check('scope: "whole universe" widens', is('search the whole universe', 'scope', { scope: 'universe' }));
check('scope ack names the bound', (describeIntent(intent('hits only')) ?? '').includes('HIGHLIGHTED'));

// Owner session 2026-11-01, round 3: Explore-module fixes.
// Chronology STT repair — navigation only, never search.
check('misheard "technology" navigates to chronology',
  is('take me to the technology view', 'lens', { lens: 'chronology' }));
check('misheard "criminology" navigates to chronology',
  is('take me to the criminology view', 'lens', { lens: 'chronology' }));
check('"search for technology" stays a search',
  is('search for technology', 'search', { term: 'technology' }));
check('evidence bare-word navigates in nav context', is('show evidence', 'lens', { lens: 'evidence' }));
check('evidence question still investigates',
  is('show me what evidence points the other way', 'stage'));
check('retired Galaxy 1000 has no load ack', describeIntent(intent('galaxy one thousand')) === undefined);
check('galaxy 500 still loads (fallback)', (describeIntent(intent('galaxy 500')) ?? '').includes('Galaxy 500'));
// Option C (2026-11-01): authored/computed concept source toggle.
check('computed concepts switches overlay', is('show me computed concepts', 'concept-mode', { mode: 'computed' }));
check('machine clusters switches overlay', is('use machine clusters', 'concept-mode', { mode: 'computed' }));
check('authored concepts switches back', is('back to authored concepts', 'concept-mode', { mode: 'authored' }));
check('concept-mode ack states computed clusters', (describeIntent(intent('computed concepts')) ?? '').includes('Concept Clusters'));
check('authored concepts ack explains removal', (describeIntent(intent('authored concepts')) ?? '').includes('removed'));  

// WAV encoding: header + decodable length.
{
  const samples = new Float32Array(4800); // 0.1s at 48kHz silence+tick
  samples[2400] = 0.5;
  const wav = encodeWav16k(samples, 48000);
  const view = new DataView(wav);
  const tag = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  check('wav has RIFF header', tag === 'RIFF');
  check('wav declares 16kHz', view.getUint32(24, true) === 16000);
  check('wav downsamples 48k -> 1600 samples', view.getUint32(40, true) === 1600 * 2);
  check('rms of silence is 0', bufferRms(new Float32Array(128)) === 0);
  check('rms of DC 0.5 is 0.5', Math.abs(bufferRms(new Float32Array(128).fill(0.5)) - 0.5) < 1e-6);
  // Level normalization (owner desktop, 2026-11-03): hot mic-array
  // captures (buffer RMS 0.21-0.35) made Wit return 0-6 chars on
  // clearly audible speech; the known-good range is RMS ~0.10.
  const hot = normalizeSpeechLevels(new Float32Array(4800).fill(0.9));
  const quiet = normalizeSpeechLevels(new Float32Array(4800).fill(0.05));
  const goodSine = Float32Array.from({ length: 4800 }, (_, i) => 0.22 * Math.sin(i / 10));
  const good = normalizeSpeechLevels(goodSine);
  check('hot capture is scaled toward the proven STT range',
    hot.gain < 0.2 && Math.abs(bufferRms(hot.samples) - 0.10) < 0.02);
  check('quiet capture is lifted, silence is untouched',
    quiet.gain > 2 && Math.abs(bufferRms(quiet.samples) - 0.15) < 0.05
    && normalizeSpeechLevels(new Float32Array(128)).gain === 1);
  check('already-good levels pass through near unity',
    Math.abs(good.gain - 1) < 0.6 && bufferRms(good.samples) <= 0.13);
  check('speech channel pick: stronger channel wins, mono stays 0',
    pickSpeechChannel([0.03, 0.2]) === 1
    && pickSpeechChannel([0.2, 0.03]) === 0
    && pickSpeechChannel([0.1]) === 0
    && pickSpeechChannel([]) === 0);
}

// Owner Search session 2026-11-02 (post-crash pickup).
// 1) "please search for the term explore" must run the TERM
//    search for `explore` — never search the words "the term",
//    never the Investigator.
check('search for the term X searches X only',
  is('please search for the term explore', 'search', { term: 'explore' }));
check('search for the phrase X keeps the phrase only',
  is('search for the phrase clean room', 'search', { term: 'clean room' }));
check('quoted search term drops the quotes',
  is('search for the term "Falcon"', 'search', { term: 'Falcon' }));
check('how-many with "the term" also cleans',
  is('How many documents hit on the term escrow?', 'search', { term: 'escrow' }));
// 2) Spoken replies only inside an active voice turn: button
//    presses (no voice turn / expired turn) never speak.
check('no voice turn means no spoken reply', shouldSpeakReply(1000, 0) === false);
check('inside a voice turn replies speak', shouldSpeakReply(1000, 5000) === true);
check('after a voice turn replies go silent', shouldSpeakReply(6000, 5000) === false);
// 3) UI source contracts (no UIKit DOM harness exists): the
//    menu page strip sits above the tab row and stays visible
//    when tools are collapsed (owner, 2026-11-02; the canvas
//    PREV/NEXT planes were the cut part, not this strip);
//    node picking uses the IWSDK-posed
//    ray spaces and accepts controller squeeze as well as
//    trigger; the Search tab's typed NL field routes through
//    the same intent router as voice.
{
  const ui = readFileSync(new URL('../public/ui/welcome.uikitml', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('../src/panel.ts', import.meta.url), 'utf8');
  const evidence = readFileSync(new URL('../src/evidence-ui.ts', import.meta.url), 'utf8');
  check('page strip is above the tab row in the panel',
    ui.indexOf('id="page-strip"') >= 0 && ui.indexOf('id="page-strip"') < ui.indexOf('id="tab-row"'));
  check('page strip stays visible when tools are collapsed',
    /'page-strip'\)\?\.setProperties\(\{\s*display: 'flex'/.test(panel));
  check('an AI-working indicator exists in the panel markup',
    ui.includes('id="ai-working"'));
  check('typed Search NL routes through the intent router',
    panel.includes("routeTypedSearch") && panel.includes("wireAction('inv-ai-ask'"));
  check('picking uses IWSDK raySpaces (not only three controller groups)',
    evidence.includes('raySpaces'));
  check('controller squeeze also picks nodes',
    evidence.includes("'squeezestart'") || evidence.includes('"squeezestart"'));
  check('selected-record arrow + Record label exist',
    evidence.includes('hit-arrow') && evidence.includes('Record'));
}

// Owner headset round 2026-11-02 (later): ordinal-before-hit
// phrasings and a voice presence check.
check('show me the first hit opens hit 1', is('show me the first hit', 'hit', { index: 0 }));
check('show me the last hit opens last', is('show me the last hit', 'hit', { index: -1 }));
check('second hit opens hit 2', is('second hit', 'hit', { index: 1 }));
check('open the third hit', is('open the third hit', 'hit', { index: 2 }));
check('show the first result', is('show the first result', 'hit', { index: 0 }));
check('first-hit phrasing never degrades to a term search',
  intent('show me the first hit').kind !== 'search');
check('testing voice is a presence check', is('testing voice', 'presence'));
check('can you hear me is a presence check', is('can you hear me', 'presence'));
check('are you there is a presence check', is('are you there?', 'presence'));
check('presence ack is exactly the owner line',
  describeIntent(intent('testing voice')) === "I'm here and listening.");

// Owner final QoL round 2026-11-04: greetings are the first
// thing a new user says. A bare greeting must be answered
// warmly and routed to Voice Help — never staged as an AI
// question — and a greeting in front of a command must not
// block the command.
check('hello is a greeting', is('hello', 'greeting'));
check('hi there is a greeting', is('hi there', 'greeting'));
check('good morning is a greeting', is('good morning', 'greeting'));
check('hey is a greeting', is('hey', 'greeting'));
check('a greeting never becomes a staged question',
  intent('hello').kind !== 'stage' && intent('good evening').kind !== 'stage');
check('greeting ack says hello and points at Find leads + Voice Help',
  (describeIntent(intent('hello')) ?? '').startsWith('Hello')
  && (describeIntent(intent('hello')) ?? '').includes('Find leads')
  && (describeIntent(intent('hello')) ?? '').includes('Voice Help'));
check('hello find leads still routes to leads', is('Hello, find leads', 'leads'));
check('hi show tools still routes', intent('Hi, show tools').kind !== 'stage'
  && intent('Hi, show tools').kind !== 'greeting');
check('approve all is tap-only naming the Approve All button',
  is('approve all draft findings', 'tap-only', { what: 'Approve All Draft Findings' }));

// Headset regression (owner, 2026-11-04): "Hello." routed as
// greeting (diag voice-transcript intent=greeting) but the
// spoken reply never played — update() drained the TTS queue
// (starting the ack fetch) and THEN processed the same turn's
// flush signal, whose token bump silently discarded the fetch
// result. The flush must be consumed BEFORE drainTts in update.
{
  const panelSrc = readFileSync(new URL('../src/panel.ts', import.meta.url), 'utf8');
  const updateBody = panelSrc.slice(panelSrc.indexOf('update(): void {'), panelSrc.indexOf('init(): void {'));
  check('speech flush is processed before TTS drain in update() (greeting ack race)',
    updateBody.length > 0
    && updateBody.indexOf('speakFlushSignal.nonce') >= 0
    && updateBody.indexOf('speakFlushSignal.nonce') < updateBody.indexOf('this.drainTts()'));
}

// Owner headset round 2026-11-02 (round 4).
check('take me to investigate opens Investigate', is('take me to investigate', 'tab', { tab: 'investigate' }));
check('take me to search opens Search', is('take me to search', 'tab', { tab: 'search' }));
check('bring me to explore opens Explore', is('bring me to explore', 'tab', { tab: 'explore' }));
check('export help wording points at the export tool',
  VOICE_HELP_LINES.some((l) => l.includes('Visit the export tool to explore options')));
check('spoken text respells Ask for TTS pronunciation',
  forSpokenText('Ask my question') === 'Ahsk my question'
  && forSpokenText('asking the AI now') === 'ahsking the AI now'
  && forSpokenText('Falcon search') === 'Falcon search');

// Full voice coverage (owner requirement, 2026-11-03): every
// phrase on the Voice Help card and EVERY panel button must
// produce a result by voice (tap-only counts: it answers with
// the exact button to tap). Buttons are enumerated from the
// real uikitml so a future button cannot silently lack a door.
{
  const WEAK = new Set(['stage', 'out-of-scope', 'explore-unknown', 'empty']);
  const helpPhrases = VOICE_HELP_LINES.flatMap((line) => [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  const helpGaps = helpPhrases.filter((p) => WEAK.has(routeTranscript(p, false).kind));
  check(`every Voice Help card phrase routes (${helpPhrases.length} phrases)`, helpGaps.length === 0);
  if (helpGaps.length) console.log('  help gaps:', helpGaps.join(' | '));

  const uikitml = readFileSync(new URL('../public/ui/welcome.uikitml', import.meta.url), 'utf8');
  const buttons = [...uikitml.matchAll(/<Button id="([^"]+)"[^>]*>(?:\s*<[^>]+>)*?\s*<ButtonLabel[^>]*>([^<]+)<\/ButtonLabel>/g)]
    .map((m) => ({ id: m[1], label: m[2].trim() }));
  // The voice trigger itself cannot be spoken into existence;
  // two buttons are spoken by their natural command, not their
  // state-announcing label.
  const SKIP = new Set(['voice-button']);
  const SPOKEN = { 'ai-working': 'stop ai', 'voice-help': 'voice help' };
  const spoken = (b) => SPOKEN[b.id] ?? b.label
    .replace(/\([^)]*\)/g, ' ').replace(/:/g, ' ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const gaps = buttons
    .filter((b) => !SKIP.has(b.id))
    .filter((b) => WEAK.has(routeTranscript(spoken(b), false).kind))
    .map((b) => `${b.id} "${spoken(b)}"`);
  check(`every panel button yields a voice result (${buttons.length} buttons)`, gaps.length === 0);
  if (gaps.length) console.log('  button gaps:', gaps.join(' | '));
}

console.log(failures === 0 ? '\nAll voice tests passed.' : `\n${failures} voice test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
