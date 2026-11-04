/**
 * Voice routing (ms4, 2026-11-01). Pure and DOM-free so it is
 * unit-tested by scripts/voice.test.mjs; panel.ts owns capture
 * and executes the returned intent. Design rules:
 *  - Every feature reachable WITHOUT typing is reachable here
 *    (tabs, lenses, corpora, leads, search, ask, navigation).
 *  - Consequential decisions (approve / reject / export / mark)
 *    are NEVER executed by voice: a misheard word must not be
 *    able to approve a finding. Voice explains; the human taps.
 *  - Free questions are staged, never auto-sent, unless the
 *    speaker used the explicit "ask ..." prefix.
 */

export type VoiceTab = 'explore' | 'investigate' | 'search' | 'approve' | 'export';
export type VoiceLens = 'evidence' | 'network' | 'chronology' | 'concepts' | 'custodians' | 'filetypes';

export type VoiceIntent =
  | { kind: 'empty' }
  | { kind: 'presence' }
  | { kind: 'greeting' }
  | { kind: 'help' }
  | { kind: 'cancel' }
  | { kind: 'confirm' }
  | { kind: 'stop' }
  | { kind: 'tab'; tab: VoiceTab }
  | { kind: 'lens'; lens: VoiceLens }
  | { kind: 'corpus'; corpus: 'tradesecret' | 'galaxy' | 'expanded'; galaxyCount?: number }
  | { kind: 'submit-report' }
  | { kind: 'leads' }
  | { kind: 'lead'; index: number }
  | { kind: 'draft' }
  | { kind: 'nav'; action: 'next' | 'prev' | 'page' | 'page-prev' | 'clear' | 'suggest-more' }
  | { kind: 'hit'; index: number }
  | { kind: 'sound'; on: boolean }
  | { kind: 'finding-nav'; action: 'finding-prev' | 'finding-next' }
  | { kind: 'panel'; visible: boolean }
  | { kind: 'scale'; expanded: boolean }
  | { kind: 'search'; term: string }
  | { kind: 'ask'; question: string }
  | { kind: 'tap-only'; what: string }
  | { kind: 'stage'; question: string }
  | { kind: 'scope'; scope: 'hits' | 'universe' }
  | { kind: 'concept-mode'; mode: 'authored' | 'computed' }
  | { kind: 'explore-unknown'; remainder: string }
  | { kind: 'soundscape' }
  | { kind: 'run-typed'; source: 'search' | 'investigate' }
  | { kind: 'run-investigation' }
  | { kind: 'out-of-scope'; heard: string };

/**
 * STT name repair. Wit (and most STT) hears corpus proper nouns
 * approximately ("Elena Reyes" -> "Elena Ray's" — observed live
 * 2026-11-01). Only unambiguous corrections are applied, on
 * word boundaries, preserving the rest of the utterance. Search
 * itself is case-insensitive; this fixes spelling, not case.
 */
const CORRECTIONS: [RegExp, string][] = [
  [/\belena\s+ray'?s\b/gi, 'Elena Reyes'],
  [/\bray'?s\b/gi, 'Reyes'],
  [/\breyes'?s\b/gi, 'Reyes'],
  [/\bnova\s*chip\b/gi, 'NovaChip'],
  [/\bhelix\s*works\b/gi, 'HelixWorks'],
  [/\blindquist\b/gi, 'Lindqvist'],
  [/\bpetroff\b/gi, 'Petrov'],
  [/\bu\.?\s*s\.?\s*b\.?\b/gi, 'USB'],
  [/\bfal[kc]on\b/gi, 'Falcon'],
  [/\batlas\b/gi, 'Atlas'],
  [/\bpriya\b/gi, 'Priya'],
  // Desktop Web Speech homophones (owner, 2026-11-03): the
  // browser recognizer hears command words approximately.
  [/\bfine\s+(?:the\s+)?(?:leads|leaves|leeds)\b/gi, 'find leads'],
  // "leads" differs from a whole homophone class by one
  // consonant; observed live (2026-11-04): "Find beads.".
  [/\b(find|show|get|discover|investigate|research|explore)\s+(?:the\s+)?(?:leaves|leeds|beads|deeds|needs|feeds|seeds|weeds|pleads)\b/gi, '$1 leads'],
  [/\bconcepts?\s+(?:classes|closters|glusters|clusterss)\b/gi, 'concept clusters'],
  // Observed live mishearings (owner desktop log, 2026-11-03):
  // "find leads" arrived as "friendly", "find AIDS", "leaves".
  [/^friendly$/i, 'find leads'],
  [/\b(find|show|get)\s+aids\b/gi, '$1 leads'],
  [/^(?:leaves|leeds)$/i, 'leads'],
  // Next observed round (same log): "show tools" -> "Joe pools",
  // "explore lead three" -> "explain three".
  [/\b(?:joe|jo)\s+pools\b/gi, 'show tools'],
  [/\bshow\s+(?:pools|tules|tuels)\b/gi, 'show tools'],
  [/^explain\s+(lead|leads|one|two|three|1|2|3)\b/i, 'explore $1'],
  // Recognizer cutoffs of "show tools" / "find leads" leave a
  // bare fragment with no other meaning in this grammar.
  [/^(?:show|tools)[.!?]?$/i, 'show tools'],
  [/^(find|show)\s+lead[.!?]?$/i, '$1 leads'],
  // Recognizer finalized bare "Find." twice (2026-11-04) —
  // a cutoff "find leads", never an AI question.
  [/^find[.!?]?$/i, 'find leads'],
];

export function correctTranscript(raw: string): string {
  let text = raw.trim().replace(/\s+/g, ' ');
  for (const [pattern, replacement] of CORRECTIONS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  '1st': 1, '2nd': 2, '3rd': 3,
};

const QUESTION_WORD = /^(who|what|when|where|why|how|which|did|does|do|was|were|is|are|can|could|would|should)\b/;

/**
 * Strip conversational framing ("Can you please…", "Thanks,
 * let's…", trailing "please") so natural phrasing routes like
 * the bare command. Display/logging keep the original words;
 * only matching and term extraction use the stripped core.
 */
function stripPoliteness(text: string): string {
  let core = text;
  for (let i = 0; i < 3; i += 1) {
    const next = core.replace(
      /^(?:please\s+|can you(?:\s+please)?\s+|could you(?:\s+please)?\s+|would you(?:\s+please)?\s+|thank(?:s| you)[,.]?\s+|let'?s\s+|ok(?:ay)?[,.]?\s+|(?:hello|hi|hey|howdy|greetings|good (?:morning|afternoon|evening))(?:\s+there)?[,.]?\s+(?!there\s*$))/i,
      '',
    );
    if (next === core) break;
    core = next;
  }
  return core.replace(/[, ]*\bplease\s*$/i, '').trim() || text;
}

/**
 * Clean an extracted search term (owner Search session,
 * 2026-11-02): "please search for the term explore" must search
 * `explore` — the framing words ("the term / the phrase / the
 * word", surrounding quotes, trailing punctuation) are never
 * part of the term itself.
 */
export function cleanSearchTerm(raw: string): string {
  return raw
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/^(?:the\s+)?(?:term|phrase|word|words|keyword)\s+/i, '')
    .replace(/^["'“‘]+|["'”’]+$/g, '')
    .trim();
}

/**
 * Spoken-reply gate (owner, 2026-11-02): the assistant speaks
 * only while a voice turn is active. Button presses update the
 * speech log silently — "if I'm just pressing buttons, she
 * doesn't need to talk."
 */
export function shouldSpeakReply(nowMs: number, voiceTurnUntilMs: number): boolean {
  return voiceTurnUntilMs > 0 && nowMs < voiceTurnUntilMs;
}

/**
 * TTS pronunciation repair (owner, 2026-11-02): the speech
 * voice mispronounces "ask" (heard in "Ask my question").
 * Respelling applies ONLY to text sent to the synthesizer —
 * the speech log always shows the real words.
 */
export function forSpokenText(text: string): string {
  return text
    .replace(/\bAsking\b/g, 'Ahsking')
    .replace(/\basking\b/g, 'ahsking')
    .replace(/\bAsks\b/g, 'Ahsks')
    .replace(/\basks\b/g, 'ahsks')
    .replace(/\bAsk\b/g, 'Ahsk')
    .replace(/\bask\b/g, 'ahsk');
}

/** Route one corrected transcript. `hasPending` = a staged question exists. */
function routeExact(raw: string, hasPending: boolean): VoiceIntent {
  const text = correctTranscript(raw);
  if (!text) return { kind: 'empty' };
  const core = stripPoliteness(text);
  const lower = core.toLowerCase().replace(/[.!?,;:]+$/g, '').trim();
  const words = lower.split(/\s+/);

  // Session control first: short utterances only, so a question
  // beginning "Can you confirm whether..." is never swallowed.
  // Presence check (owner, 2026-11-02): "testing voice" /
  // "can you hear me" answers "I'm here and listening." —
  // never a staged AI question. ('can you' is stripped as
  // politeness above, so bare 'hear me' arrives too.)
  if (words.length <= 5 && /^(testing( voice| testing)?|test( voice)?|voice test|hear me|can you hear me|are you there|are you listening|you there)$/.test(lower)) {
    return { kind: 'presence' };
  }
  // Greetings (owner, 2026-11-04): "hello" is the first thing
  // a new user says. A bare greeting is answered warmly and
  // routed to Voice Help (panel.ts) — never staged as an AI
  // question. A greeting in FRONT of a command never reaches
  // here: stripPoliteness removes it so the command routes.
  if (words.length <= 6 && /^(hello|hi|hey|howdy|greetings|good (morning|afternoon|evening))(\s+(there|assistant|everyone|all|team))?(\s+again)?$/.test(lower)) {
    return { kind: 'greeting' };
  }
  if (words.length <= 7 && /^(help|voice help|voice help what can i say|what can i say|commands|list commands)$/.test(lower)) {
    return { kind: 'help' };
  }
  if (words.length <= 4 && /^(cancel|never mind|nevermind|scratch that|forget it|clear that|delete that)$/.test(lower)) {
    return { kind: 'cancel' };
  }
  if (words.length <= 3 && /^(confirm|yes|yeah|yep|ask it|send it|go ahead|run it|ok|okay)$/.test(lower)) {
    return { kind: 'confirm' };
  }
  if (words.length <= 3 && /^(stop|stop ai|halt|cancel run|stop that)$/.test(lower)) {
    return { kind: 'stop' };
  }
  if (words.length <= 4 && /^(mute|voice off|stop talking|be quiet|quiet|silence)$/.test(lower)) {
    return { kind: 'sound', on: false };
  }
  if (words.length <= 4 && /^(unmute|voice on|speak|talk to me|sound on)$/.test(lower)) {
    return { kind: 'sound', on: true };
  }
  // Every-button-by-voice coverage (owner, 2026-11-03): the
  // remaining panel buttons get a voice door with a real
  // result. Session entry/exit stay tap-only with guidance —
  // like approve/export, they change where you ARE.
  if (/\bsoundscape\b/.test(lower) || /\bambient (pad|sound|music)\b/.test(lower)) {
    return { kind: 'soundscape' };
  }
  if (/^(ai\s+)?investigate\s+(the\s+)?trade\s*secret$/.test(lower) || /^ai investigate$/.test(lower)) {
    return { kind: 'run-investigation' };
  }
  if (/^(run|submit|execute)\s+(my\s+)?search$/.test(lower)) {
    return { kind: 'run-typed', source: 'search' };
  }
  if (/^(run|ask)\s+what i (typed|said)$/.test(lower) || /^run my question$/.test(lower)) {
    return { kind: 'run-typed', source: 'investigate' };
  }
  if (words.length <= 6) {
    if (/\b(exit to browser|exit (the )?(app|xr|vr|session)|leave (vr|xr|the app)|quit (vr|xr|the app))\b/.test(lower)) {
      return { kind: 'tap-only', what: 'Exit to Browser' };
    }
    if (/\benter (virtual reality|vr)\b/.test(lower)) return { kind: 'tap-only', what: 'Enter Virtual Reality' };
    if (/\benter (mixed reality|mr|passthrough)\b/.test(lower)) return { kind: 'tap-only', what: 'Enter Mixed Reality (Passthrough)' };
    if (/\bswitch (to )?(vr|mr|virtual reality|mixed reality)\b/.test(lower)) {
      return { kind: 'tap-only', what: 'Switch VR / Mixed Reality' };
    }
  }

  // Tabs — spoken names match the VISIBLE tab labels exactly:
  // Explore / Investigate / Search / Approve / Export.
  const tabMatch = lower.match(
    /^(?:open|show|go to|take me to|bring me to|navigate to|head to|switch to|view|bring up)?\s*(?:the\s+)?(explore|investigate|investigation|search|approve|approval|review|export)\s*(?:tab|page|panel)?$/,
  );
  if (tabMatch && words.length <= 5) {
    const name = tabMatch[1];
    if (name === 'investigate' || name === 'investigation') return { kind: 'tab', tab: 'investigate' };
    if (name === 'approve' || name === 'approval' || name === 'review') return { kind: 'tab', tab: 'approve' };
    return { kind: 'tab', tab: name as VoiceTab };
  }

  // FAILSAFE 3 (owner, 2026-11-01): investigate/research/find
  // out/I-need-to-know prefixes ALWAYS hand the remainder to the
  // Investigate specialist as a staged question — never a lens,
  // never search. Bare "investigate"/"research" opens leads.
  // Placed before lens matching so "investigate the network"
  // investigates instead of switching the lens.
  const invPrefix = core.match(
    /^(?:investigate|research|look into|find out|i need to know)\b\s*(.*)$/i,
  );
  if (invPrefix) {
    const rest = invPrefix[1].trim().replace(/[.!?]+$/, '');
    if (!rest) return { kind: 'leads' };
    // "Investigate leads" IS the leads request (owner desktop,
    // 2026-11-03) — never stage the bare word as a question.
    if (/^(?:the\s+)?leads?$/i.test(rest)) return { kind: 'leads' };
    if (rest.split(/\s+/).length <= 40) return { kind: 'stage', question: correctTranscript(rest) };
  }

  // Investigation scope (owner, 2026-11-01): the user may
  // bound investigation to the highlighted hits or keep the
  // whole universe. Checked before search matching so "search
  // the whole universe" never becomes a keyword search.
  if (/\b(hits only|just (the )?hits|limit to (the )?hits|only (the )?hits|within (the )?hits)\b/.test(lower)) {
    return { kind: 'scope', scope: 'hits' };
  }
  if (/\b(whole universe|entire universe|whole corpus|entire corpus|full universe|all records|whole dataset|entire dataset)\b/.test(lower)) {
    return { kind: 'scope', scope: 'universe' };
  }

  // Consequential actions: voice explains, human taps.
  if (/\b(approve|reject)\b/.test(lower) && /\b(finding|draft|that|this|it|all)\b/.test(lower)) {
    const what = lower.includes('approve')
      ? (/\ball\b/.test(lower) ? 'Approve All Draft Findings' : 'Approve Draft Finding')
      : 'Reject Draft Finding';
    return { kind: 'tap-only', what };
  }
  if (/^export\b/.test(lower)) return { kind: 'tap-only', what: 'Export' };
  if (/^mark\b/.test(lower)) return { kind: 'tap-only', what: 'Mark DocIDs for Export' };

  // Investigate workflow.
  if (/\b(find|show|get|generate|discover|investigate|research|explore)\b[^\n]*\bleads\b/.test(lower) || lower === 'leads') {
    return { kind: 'leads' };
  }
  // "explore lead two" (owner, 2026-11-02): Wit hears "to"
  // for "two", and the old matcher needed a verb + "lead" +
  // number — bare "lead 2" fell through to search. Accept the
  // lead word with or without a lead/explore verb, digits or
  // (misheard) words.
  const leadMatch = lower.match(
    /\b(?:explore|open|show(?: me)?|view|examine|inspect|lead)?\s*(lead|leads)\s+(one|two|three|to|too|1|2|3|first|second|third)\b/,
  );
  if (leadMatch) {
    const word = leadMatch[2] === 'to' || leadMatch[2] === 'too' ? 'two' : leadMatch[2];
    const idx = NUMBER_WORDS[word] - 1;
    if (Number.isFinite(idx) && idx >= 0 && idx <= 2) return { kind: 'lead', index: idx };
  }
  // "Explore one" with the word "lead" dropped by the recognizer.
  const bareExplore = lower.match(/^(?:explore|open|explain)\s+(one|two|three|1|2|3|first|second|third)$/);
  if (bareExplore) {
    const idx = NUMBER_WORDS[bareExplore[1]] - 1;
    if (Number.isFinite(idx) && idx >= 0 && idx <= 2) return { kind: 'lead', index: idx };
  }
  if (/\b(prepare|draft|create|queue)\b[^\n]*\b(draft|finding)\b/.test(lower) || lower === 'draft that finding') {
    return { kind: 'draft' };
  }

  // Explore: lenses (before search so "show concept clusters" wins).
  // Computed/authored concept source (owner, 2026-11-01) —
  // checked before the bare concept branch.
  if (/\bcomputed\b[^.]*\bconcept/.test(lower) || /\bconcept[^.]*\bcomputed\b/.test(lower)
    || /\bmachine\b[^.]*\bcluster/.test(lower)) {
    return { kind: 'concept-mode', mode: 'computed' };
  }
  if (/\bauthored\b[^.]*\bconcept/.test(lower) || /\bconcept[^.]*\bauthored\b/.test(lower)
    || /\btheory\b[^.]*\btag/.test(lower)) {
    return { kind: 'concept-mode', mode: 'authored' };
  }
  // Chronology STT repair (owner session 2026-11-01): Wit hears
  // "chronology" as "technology"/"criminology" in navigation
  // commands. Repaired ONLY with a navigation verb present AND
  // no search verb — "search for technology" must stay a search.
  const NAV_VERB = /\b(show|open|go to|take me to|bring me to|view|display|switch to|navigate to|where is|take us to)\b/;
  const SEARCH_VERB = /\b(search|find|how many|highlight|looking for|look for)\b/;
  const CHRONO_MISHEARD = /\b(chronology|chronological|chronologist|technology|technologies|technological|criminology)\b/;
  if (CHRONO_MISHEARD.test(lower) && NAV_VERB.test(lower) && !SEARCH_VERB.test(lower)) {
    return { kind: 'lens', lens: 'chronology' };
  }
  // Bare/short "clusters" is the Concept Clusters lens with
  // its first word dropped ("Clusters.", "Show such
  // clusters." — owner desktop, 2026-11-04). Explicit search
  // phrasing stays a search.
  if (/\bclusters?\b/.test(lower) && (NAV_VERB.test(lower) || words.length <= 2)
    && !/^(search|find)\b/.test(lower) && !QUESTION_WORD.test(lower)) {
    return { kind: 'lens', lens: 'concepts' };
  }
  if (/\bconcept/.test(lower)) return { kind: 'lens', lens: 'concepts' };
  if (/\bcustodian/.test(lower)) return { kind: 'lens', lens: 'custodians' };
  if (/\bfile\s*types?\b/.test(lower)) return { kind: 'lens', lens: 'filetypes' };
  if (/\b(chronology|timeline|by date)\b/.test(lower) && !SEARCH_VERB.test(lower)) {
    return { kind: 'lens', lens: 'chronology' };
  }
  if (/\bnetwork\b/.test(lower)) return { kind: 'lens', lens: 'network' };
  // Evidence lens, relabelled "by organization" (owner,
  // 2026-11-01): match the bare word in navigation context too,
  // but never inside a question ("what evidence…" investigates).
  if (/\bevidence lens\b/.test(lower) || /\blens\s+evidence\b/.test(lower) || /\bevidence view\b/.test(lower)
    || (/\bevidence\b/.test(lower) && NAV_VERB.test(lower) && !SEARCH_VERB.test(lower)
      && !QUESTION_WORD.test(lower) && !/\b(what|which|who|how|why)\b/.test(lower))) {
    return { kind: 'lens', lens: 'evidence' };
  }

  // Corpora.
  if (/\btrade\s*secret\b/.test(lower)) return { kind: 'corpus', corpus: 'tradesecret' };
  if (/\bgalaxy\b/.test(lower)) {
    const five = /\b(500|five hundred)\b/.test(lower);
    return { kind: 'corpus', corpus: 'galaxy', galaxyCount: five ? 500 : 1000 };
  }
  if (/\bexpanded\b/.test(lower)) return { kind: 'corpus', corpus: 'expanded' };

  // Navigation inside results / drafts.
  // Direct hit exploration from ANY module (owner: hits must
  // not require the Search tab's buttons).
  if (words.length <= 5) {
    if (/^(?:explore|show(?: me)?|view|see)\s+(?:the\s+)?hits?$/.test(lower)) {
      return { kind: 'nav', action: 'next' };
    }
    // Ordinal-before-hit (owner, 2026-11-02): "show me the
    // first hit" previously degraded into a term search for
    // "the first hit" via the show-me search pattern below.
    const ordinalHit = lower.match(
      /^(?:open|show(?: me)?|go to|view|explore|take me to)?\s*(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|1st|2nd|3rd|\d+(?:st|nd|rd|th)?)\s+(?:hit|result)$/,
    );
    if (ordinalHit) {
      if (ordinalHit[1] === 'last') return { kind: 'hit', index: -1 };
      const n = NUMBER_WORDS[ordinalHit[1]]
        ?? Number.parseInt(ordinalHit[1].replace(/(st|nd|rd|th)$/, ''), 10);
      if (Number.isFinite(n) && n >= 1) return { kind: 'hit', index: n - 1 };
    }
    const hitMatch = lower.match(
      /^(?:open|show(?: me)?|go to|view|explore)?\s*(?:the\s+)?(?:hit|result)\s+(one|two|three|four|five|six|seven|eight|nine|ten|first|second|third|fourth|fifth|\d+)$/,
    );
    if (hitMatch) {
      const n = NUMBER_WORDS[hitMatch[1]] ?? Number.parseInt(hitMatch[1], 10);
      if (Number.isFinite(n) && n >= 1) return { kind: 'hit', index: n - 1 };
    }
  }
  if (/\bnext\b[^\n]*\b(draft|finding)\b/.test(lower)) return { kind: 'finding-nav', action: 'finding-next' };
  if (/\b(previous|prev|last)\b[^\n]*\b(draft|finding)\b/.test(lower)) return { kind: 'finding-nav', action: 'finding-prev' };
  if (/\bnext page\b/.test(lower)) return { kind: 'nav', action: 'page' };
  if (/\b(previous|prev) page\b/.test(lower)) return { kind: 'nav', action: 'page-prev' };
  if (/\bnext\b[^\n]*\b(hit|result|document|record)?\s*$/.test(lower) && words.length <= 3) {
    return { kind: 'nav', action: 'next' };
  }
  if (/\b(previous|prev)\b[^\n]*\b(hit|result|document|record)?\s*$/.test(lower) && words.length <= 3) {
    return { kind: 'nav', action: 'prev' };
  }
  if (/\b(clear( the)? search|show all|reset( search)?|show everything)\b/.test(lower)) {
    return { kind: 'nav', action: 'clear' };
  }
  if (/\bsuggestions?\b/.test(lower)
    && /\b(prepare|new|more|refresh|generate|another|different|search)\b/.test(lower)) {
    return { kind: 'nav', action: 'suggest-more' };
  }

  // Panel + scale.
  if (/\b(hide tools|show fewer tools|fewer tools)\b/.test(lower)) return { kind: 'panel', visible: false };
  if (/\b(show\s+(?:me\s+)?(?:the\s+)?(?:more\s+)?tools|more tools)\b/.test(lower)) return { kind: 'panel', visible: true };
  if (/\b(hide|collapse|close) (the )?panel\b/.test(lower)) return { kind: 'panel', visible: false };
  if (/\b(show|open|expand) (the )?panel\b/.test(lower)) return { kind: 'panel', visible: true };
  if (/\bexpand (the )?universe\b/.test(lower)) return { kind: 'scale', expanded: true };
  if (/\b(compact|shrink) (the )?universe\b/.test(lower)) return { kind: 'scale', expanded: false };
  if (words.length <= 5 && /\b(make it )?(bigger|larger)\b|\bzoom in\b/.test(lower)) return { kind: 'scale', expanded: true };
  if (words.length <= 5 && /\b(make it )?(smaller)\b|\bzoom out\b/.test(lower)) return { kind: 'scale', expanded: false };

  // Explicit ask prefix = the speaker's own confirmation.
  const askMatch = core.match(/^ask(?:\s+(?:ai|the ai))?[:\s]+(.+)$/i);
  if (askMatch && askMatch[1].trim().length >= 3) {
    return { kind: 'ask', question: askMatch[1].trim() };
  }

  // Save the current search into the Search Term Hit Report —
  // the Search expert's explicit offer after a hit count
  // (owner, 2026-11-01). Submitting is not approving/exporting.
  if (/\b(add|submit|save)\b[^.]*\b(report|hit count)\b/.test(lower)
    && !QUESTION_WORD.test(lower)) {
    return { kind: 'submit-report' };
  }

  // "How many documents hit on the term Falcon?" = Search expert.
  const howMany = core.match(
    /^how many (?:documents|docs|records|emails|files|hits?)(?:\s+(?:hit on|hits on|mention|contain|relate to|about|for|on))?\s+(?:the term\s+)?(.+)$/i,
  );
  if (howMany) {
    const term = cleanSearchTerm(howMany[1]);
    if (term && term.split(/\s+/).length <= 5 && !QUESTION_WORD.test(term.toLowerCase())) {
      return { kind: 'search', term };
    }
  }

  // "Highlight the documents that hit on Falcon" (owner phrasing).
  const highlightMatch = core.match(
    /^highlight\s+(?:the\s+)?(?:documents|docs|records|emails|files|hits?)?\s*(?:that\s+)?(?:hit on|hits on|mentioning|containing|about|with|for)?\s*(.+)$/i,
  );
  if (highlightMatch) {
    const term = cleanSearchTerm(highlightMatch[1]);
    if (term && term.split(/\s+/).length <= 5 && !QUESTION_WORD.test(term.toLowerCase())) {
      return { kind: 'search', term };
    }
  }

  // Keyword search: "search for X" / "find documents containing X"
  // / "show me documents about X". Question-shaped tails stage.
  // FAILSAFE 1 (owner, 2026-11-01): an explicit search prefix
  // ALWAYS means the Search expert — "search: Falcon",
  // "search - USB", "please search Reyes".
  const searchPrefixed = core.match(/^(?:please\s+)?search\s*[:,\-—]\s*(.+)$/i);
  if (searchPrefixed) {
    const term = cleanSearchTerm(searchPrefixed[1]);
    const termWords = term.split(/\s+/);
    if (term && termWords.length <= 5 && !QUESTION_WORD.test(term.toLowerCase())) {
      return { kind: 'search', term };
    }
  }
  const searchMatch = core.match(
    /^(?:search(?:\s+for)?|find(?:\s+(?:all\s+)?(?:documents|docs|records|emails|files))?(?:\s+(?:containing|with|about|mentioning|for))?|show\s+me(?:\s+(?:all\s+)?(?:documents|docs|records|emails|files))?(?:\s+(?:containing|with|about|mentioning))?|documents\s+containing)\s+(.+)$/i,
  );
  if (searchMatch) {
    const term = cleanSearchTerm(searchMatch[1]);
    const termWords = term.split(/\s+/);
    if (term && termWords.length <= 5 && !QUESTION_WORD.test(term.toLowerCase())) {
      return { kind: 'search', term };
    }
  }

  void hasPending;
  // FAILSAFE 2 (owner, 2026-11-01): explore/show/take-me-to
  // prefixes that matched NO lens, corpus, hit, or panel intent
  // must NOT fall through to a staged AI question. Name the
  // remainder and point at the explorable views instead — unless
  // the remainder is itself question-shaped ("show me what
  // evidence points the other way" investigates, not navigates).
  const explorePrefix = core.match(
    /^(?:explore|show(?: me)?|take me to|bring me to|open|go to)\b\s*(.+)$/i,
  );
  if (explorePrefix) {
    const rest = explorePrefix[1].trim().replace(/[.!?]+$/, '');
    if (rest && rest.split(/\s+/).length <= 8
      && !QUESTION_WORD.test(rest.toLowerCase())
      && !/\b(what|which|who|how|why)\b/.test(rest.toLowerCase())) {
      return { kind: 'explore-unknown', remainder: correctTranscript(rest) };
    }
  }
  // Last resort was "stage as an AI question" for EVERYTHING —
  // diag shows that as the single biggest bucket (34), with
  // users staging then canceling when the staged text plainly
  // was not an evidence question. Scope-guard the fallback:
  // clearly out-of-scope requests get the helpful scope
  // message instead of a wasted AI run (owner, 2026-11-01).
  if (isOutOfScope(lower)) return { kind: 'out-of-scope', heard: text };
  return { kind: 'stage', question: text };
}

/**
 * Fuzzy command matching (owner choice, 2026-11-03): both
 * recognizers mangle SHORT commands on a room microphone
 * ("show Lee", "find AIDS", fragments). Exact routing runs
 * first; only a weak outcome (staged / explore-unknown) on a
 * short, non-question utterance is scored against the known
 * command list, and a clear winner (score + margin) routes
 * as that command. Free questions can never be hijacked:
 * question-shaped lines and dictation (pending) skip fuzzy.
 */
export const FUZZY_COMMANDS = [
  'find leads', 'show leads', 'show tools', 'hide tools',
  'show concept clusters', 'show custodians', 'show file types',
  'chronology', 'show network',
  'explore lead one', 'explore lead two', 'explore lead three',
  'prepare draft finding',
  'next hit', 'previous hit', 'next page', 'previous page',
  'next draft', 'previous draft', 'clear search',
  'open investigate', 'open search', 'open explore', 'open export',
  'voice help', 'soundscape', 'run my search', 'run what i typed',
  'ai investigate trade secret', 'exit to browser',
  'enter virtual reality', 'enter mixed reality',
] as const;

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j += 1) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= a.length; i += 1) {
      const cur = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return dp[a.length];
}
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}
export function fuzzyCommandScore(heard: string, canonical: string): number {
  const h = heard.toLowerCase().trim();
  const c = canonical.toLowerCase();
  const hTokens = h.split(/\s+/);
  const cTokens = c.split(/\s+/);
  const coverage = hTokens.reduce((sum, token) => (
    sum + Math.max(...cTokens.map((ct) => similarity(token, ct)))
  ), 0) / hTokens.length;
  const completeness = 0.82 + 0.18 * Math.min(1, hTokens.length / cTokens.length);
  return (0.5 * similarity(h, c) + 0.5 * coverage) * completeness;
}
export function fuzzyCommand(heard: string): string | undefined {
  const scored = FUZZY_COMMANDS
    .map((phrase) => ({ phrase, score: fuzzyCommandScore(heard, phrase) }))
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (best && best.score >= 0.58 && best.score - (second?.score ?? 0) >= 0.06) {
    return best.phrase;
  }
  return undefined;
}

export function routeTranscript(raw: string, hasPending: boolean): VoiceIntent {
  const exact = routeExact(raw, hasPending);
  if (exact.kind !== 'stage' && exact.kind !== 'explore-unknown') return exact;
  // Dictated replacement questions (stage) skip fuzzy while
  // pending, but an explore/show prefix is navigation by
  // construction — fuzzy-rescue it even with a staged
  // question outstanding, or one bad stage poisons the whole
  // session's navigation (owner desktop, 2026-11-04).
  if (hasPending && exact.kind !== 'explore-unknown') return exact;
  const text = correctTranscript(raw);
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 6) return exact;
  if (QUESTION_WORD.test(words.join(' '))) return exact;
  const canonical = fuzzyCommand(text);
  if (!canonical) return exact;
  const routed = routeExact(canonical, hasPending);
  return routed.kind === 'stage' || routed.kind === 'explore-unknown' ? exact : routed;
}

// Hard-out wins even when evidence words appear (legal
// verdicts; external/destructive actions — "email" the verb
// must not be rescued by "emails" the evidence noun).
const HARD_OUT = /\b(guilty|liable|legal advice|will (we|i|they) win|should (we|i) (sue|settle|plead))\b|\b(send|e-?mail|message|text|call) (this|it|that|him|her|them|my )\b|\b(delete|erase|remove) (the |these |those |all )?(documents|records|files|evidence)\b|\b(upload|order|buy|book (a|me)|play (music|spotify|a song)|open (youtube|google|a website|the browser))\b/;
// Soft-out: general-assistant requests this session cannot do.
const SOFT_OUT = [
  /^(hi|hello|hey|good (morning|afternoon|evening)|how are you|who are you|what(?:'s| is) your name|are you (an? )?(ai|real|human))\b/,
  /\b(what time is it|today'?s date|weather|forecast|news today|headlines)\b/,
  /\b(tell me a joke|sing|write (me )?(a )?(poem|story|song|essay|letter)|poem about|joke about|translate .+ into|recipe|how (do|to) (i )?(cook|make|bake))\b/,
  /^what is \d+\s*(plus|minus|times|divided)/,
  /\b(capital of|president of|meaning of life|who won the|stock price|exchange rate)\b/,
  /\b(send|e-?mail|message|text|call) (this|it|that|him|her|them|my )\b/,
  /\b(delete|erase|remove) (the |these |those |all )?(documents|records|files|evidence)\b/,
  /\b(upload|order|buy|book (a|me)|play (music|spotify|a song)|open (youtube|google|a website|the browser))\b/,
];
// In-scope evidence signals rescue an otherwise ambiguous line.
const IN_SCOPE = /\b(evidence|documents?|records?|e-?mails?|corpus|dataset|data set|custodians?|sender|recipient|hits?|source code|falcon|reyes|elena|novachip|helixworks|usb|escrow|resignation|litigation|atlas|priya|invoice|mara|sana|ines|omar|casey|marcus|sofia|lindqvist|karen doyle|osei|petrov|grace liu|nina brooks|oleg|hannah|delivery date)\b/;

export function isOutOfScope(lower: string): boolean {
  if (HARD_OUT.test(lower)) return true;
  if (IN_SCOPE.test(lower)) return false;
  return SOFT_OUT.some((pattern) => pattern.test(lower));
}

/**
 * Out-of-scope reply (owner exact wording, 2026-11-02): one
 * line, spoken and shown. The source card shows the same line
 * via the voice-status path; the speech log gets one bubble.
 */
export const OUT_OF_SCOPE_MESSAGE =
  'That is out of scope for what voice can do. Please press or say: voice help or show tools for more options.';

/**
 * Voice search outcome tail (owner wording, 2026-11-01): the
 * count sentence comes first at the call site, then hit-stepping,
 * then a clearly separated "Other Suggestions" block. Renderers
 * treat newlines as real paragraph breaks (evidence-ui wrap()).
 */
/**
 * Pick the most actionable recognition alternative (owner
 * desktop, 2026-11-03): Web Speech often ranks a mishearing
 * first ("fine leaves") with the intended command second.
 * Prefer the first alternative that routes to a concrete
 * action; otherwise keep the recognizer's top choice so free
 * questions still stage exactly as heard.
 */
export function pickBestTranscript(alternatives: readonly string[], hasPending: boolean): string {
  const WEAK = new Set(['stage', 'out-of-scope', 'empty', 'explore-unknown']);
  for (const alt of alternatives) {
    const text = alt.trim();
    if (!text) continue;
    if (!WEAK.has(routeTranscript(text, hasPending).kind)) return text;
  }
  return (alternatives.find((a) => a.trim()) ?? '').trim();
}

export const SEARCH_OUTCOME_HITS =
  'Say next or previous hit to explore the source text.\n\n\nOther Suggestions: "organize by file type" (or custodians, chronology…) to rearrange these hits, or "add to report" to save this count to the Search Term Hit Report.';

/**
 * One-line assistant acknowledgement for the speech log, in the
 * owner's words ("Chronology view accessed."). Undefined =
 * caller logs something more specific (confirm) or nothing.
 */
export function describeIntent(intent: VoiceIntent): string | undefined {
  switch (intent.kind) {
    case 'empty': return 'I didn\'t catch that — press X and try again, a little closer to the mic.';
    case 'presence': return "I'm here and listening.";
    case 'greeting': return 'Hello — welcome to the Legal Data Universe. I\'m listening. Say "Find leads" to start the investigation, or "Voice Help" for everything you can say — the full list is on the card.';
    case 'help': return 'Here is everything voice can do:';
    case 'cancel': return 'Discarded — nothing was sent.';
    case 'stop': return 'Stopping the AI run.';
    case 'tab':
      return {
        explore: 'Explore accessed — say a lens or corpus name.',
        investigate: 'Investigate accessed — ask a question by voice.',
        search: 'Search accessed — say "search for …".',
        approve: 'Approval lives in Export — I opened it. Approve a draft, then export.',
        export: 'Export accessed — approve drafts here, then tap an export button.',
      }[intent.tab];
    case 'lens':
      return {
        concepts: 'Explore: Concept clusters view accessed.',
        custodians: 'Explore: Custodians view accessed.',
        filetypes: 'Explore: File types view accessed.',
        chronology: 'Explore: Chronology view accessed.',
        network: 'Explore: Network view accessed.',
        evidence: 'Explore: Evidence view accessed.',
      }[intent.lens];
    case 'corpus':
      // Galaxy 1000's retirement message is pushed by the caller
      // (panel.ts) — no ack here, so it is never announced twice.
      if (intent.corpus === 'galaxy' && (intent.galaxyCount ?? 1000) >= 1000) return undefined;
      return intent.corpus === 'galaxy'
        ? `Galaxy ${intent.galaxyCount ?? 1000} corpus loaded.`
        : {
            tradesecret: 'Trade Secret 3000 corpus loaded.',
            expanded: 'Expanded 112 corpus loaded.',
          }[intent.corpus as 'tradesecret' | 'expanded'];
    case 'submit-report': return 'Search expert: submitted the current search to the Search Term Hit Report.';
    case 'leads': return 'Investigate specialist: looking for leads — they\'ll be listed on the source card.';
    case 'lead': return `Investigate specialist: exploring lead ${intent.index + 1} — its evidence is highlighted.`;
    case 'draft': return 'Investigate specialist: preparing a draft finding for the Export tab.';
    case 'nav':
      return {
        next: 'Moved to the next hit.',
        prev: 'Moved to the previous hit.',
        page: 'Next page of the source card.',
        'page-prev': 'Previous page of the source card.',
        clear: 'Search cleared — all documents visible again.',
        'suggest-more': 'Search expert: preparing new search suggestions…',
      }[intent.action];
    case 'finding-nav':
      return intent.action === 'finding-next'
        ? 'Selected the next draft.'
        : 'Selected the previous draft.';
    case 'panel':
      return intent.visible
        ? 'Tools shown.'
        : 'Tools hidden — tap "Show Tools" or say "show tools" to bring them back.';
    case 'scale': return intent.expanded ? 'Universe expanded.' : 'Universe compacted.';
    case 'search': return `Search expert: searching for "${intent.term}"…`;
    case 'ask': return `Investigate specialist: asking the AI now: "${intent.question}" — watch the source card for the plan and findings. When you're ready, say "prepare draft finding".`;
    case 'tap-only': return `${intent.what} is tap-only, so a mishearing can never do it. Nothing was executed — tap the button when you're ready.`;
    case 'hit': return intent.index >= 0
      ? `Search expert: opening hit ${intent.index + 1}…`
      : 'Search expert: opening the last hit…';
    case 'sound': return undefined;
    case 'soundscape': return undefined;
    case 'run-typed': return intent.source === 'search'
      ? 'Search expert: running the search you typed.'
      : 'Investigate specialist: running what you typed.';
    case 'run-investigation': return 'AI Investigate: running the full Trade Secret investigation — watch the source card.';
    case 'concept-mode':
      return intent.mode === 'computed'
        ? 'Explore: Concept Clusters accessed (computed from shared vocabulary — see the card).'
        : 'The authored-tags lens was removed — Concept Clusters are computed now. Opening them.';
    case 'scope':
      return intent.scope === 'hits'
        ? 'Investigate scope: your HIGHLIGHTED hits. Ask a question and I will stay inside them — say "whole universe" to widen again.'
        : 'Investigate scope: the WHOLE universe. Ask a question and I will search everything — say "hits only" to stay inside highlights.';
    case 'explore-unknown':
      return [
        `I can't take you to "${intent.remainder}" — that view doesn't exist.`,
        'Explorable right now: Evidence, Concept clusters, Custodians, File types, Chronology, Network.',
        'Say "Show tools" to see every lens and corpus button.',
      ].join('\n');
    case 'out-of-scope': {
      // Owner exact line (2026-11-02): spoken and shown, one
      // bubble — no heard-quote prefix, no examples list.
      return OUT_OF_SCOPE_MESSAGE;
    }
    case 'stage': return `Investigate specialist: I heard: "${intent.question}". Nothing sent yet — say CONFIRM or tap "Ask What I Said" to ask it, CANCEL to discard, or just dictate a better question.`;
    case 'confirm': return undefined;
  }
}

export const VOICE_HELP_LINES: string[] = [
  '# Voice Help — what can I say?',
  '## EXECUTIVE SUMMARY',
  'Use voice commands to explore, investigate, search, and export.',
  '',
  '**1.  Explore: Try these examples to explore the data from different perspectives.**',
  'a. "Show concept clusters".',
  'b. "Take me to the custodian view".',
  'c. "Organize this data by file type".',
  '**2.  Investigate: Try these questions to ask about the substance of the evidence.**',
  'a. Try: "Find leads".',
  'b. "Ask who emailed Reyes about Falcon".',
  'c. "Ask what changed about the delivery date".',
  'd. "Ask who knew about the resignation first".',
  '**3.  Search: Try these phrases to find search term counts and review hits.**',
  'a. "Search for Falcon".',
  'b. "How many documents hit on the term Falcon?".',
  'c. "Next hit" and "open hit three".',
  '**4.  Export: Visit the export tool to explore options.**',
  'a. Say "open export" to go there, then tap a download button.',
  'b. Approve, reject, export, and mark never run by voice.',
  '## All tool buttons can be spoken as commands — try "Show tools".',
];

/**
 * Encode mono float samples as 16-bit PCM WAV at `targetRate`,
 * downsampling from `sourceRate` by averaging. Wit.ai accepts
 * WAV unconditionally; MediaRecorder containers (WebM/Ogg-Opus)
 * do not survive the Quest -> Wit hop (Round 4 HTTP 400), so the
 * client always sends WAV and no server transcode is needed.
 */
export function encodeWav16k(samples: Float32Array, sourceRate: number, targetRate = 16000): ArrayBuffer {
  const ratio = sourceRate / targetRate;
  const outLength = Math.max(1, Math.floor(samples.length / ratio));
  const pcm = new Int16Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += samples[j];
    const value = Math.max(-1, Math.min(1, sum / (end - start)));
    pcm[i] = value < 0 ? Math.round(value * 0x8000) : Math.round(value * 0x7fff);
  }
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  new Int16Array(buffer, 44).set(pcm);
  return buffer;
}

/** Root-mean-square level of one capture buffer (VAD input). */
export function bufferRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/**
 * Level normalization before transcription (owner desktop,
 * 2026-11-03): the Realtek mic array delivered buffer RMS
 * 0.21-0.35 — clearly audible to a human, but Wit returned
 * 0-6 characters, while a known-good roundtrip (Wit TTS ->
 * STT) measures RMS ~0.10 / peak ~0.9. Scale hot captures
 * toward RMS 0.10 (peak-capped), lift genuinely quiet ones
 * (max 3x), and pass silence/normal levels through untouched.
 */
export function normalizeSpeechLevels(samples: Float32Array): {
  samples: Float32Array; gain: number; peak: number; rms: number;
} {
  const rms = bufferRms(samples);
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) peak = Math.max(peak, Math.abs(samples[i]));
  let gain = 1;
  if (rms > 0.12) gain = 0.10 / rms;
  if (peak * gain > 0.85) gain = 0.85 / peak;
  if (gain === 1 && peak > 0.02 && peak < 0.5) gain = Math.min(3, 0.7 / peak);
  if (gain === 1) return { samples, gain, peak, rms };
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) out[i] = Math.max(-1, Math.min(1, samples[i] * gain));
  return { samples: out, gain, peak, rms };
}

/**
 * Which captured channel to transcribe (owner desktop,
 * 2026-11-03): a mic array's two channels downmixed to mono
 * can cancel the voice fundamental (loud transients survive,
 * sustained speech does not — Wit returned 0-6 chars). Pick
 * the single channel with the most energy; mono sources
 * (Quest) trivially return channel 0.
 */
export function pickSpeechChannel(channelRms: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < channelRms.length; i += 1) {
    if (channelRms[i] > channelRms[best]) best = i;
  }
  return best;
}
