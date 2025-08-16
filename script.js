// script.js

document.addEventListener('DOMContentLoaded', () => {
   // --- DOM Elements ---
   const dom = {
      // Inputs
      textInput: document.getElementById('textInput'),
      fileInput: document.getElementById('fileInput'),
      dropzone: document.getElementById('dropzone'),
      processBtn: document.getElementById('processBtn'),
        
      // AI & Session Controls
      sessionBtn: document.getElementById('sessionBtn'),
      aiProvider: document.getElementById('aiProvider'),
      apiKey: document.getElementById('apiKey'),

      // Tabs
      tabs: document.querySelector('.tabs'),
      tabContent: document.getElementById('tab-content'),

      // Outputs
      analysisOutput: document.getElementById('analysis-output'),
      sheetOutput: document.getElementById('sheet-output'),
      qcmOutput: document.getElementById('qcm-output'),
      srsOutput: document.getElementById('srs-output'),

      // Chat
      chatInput: document.getElementById('chat-input'),
      chatSend: document.getElementById('chat-send'),
      chatMessages: document.getElementById('chat-messages'),

      // Socratic
      socraticInput: document.getElementById('socratic-input'),
      socraticSend: document.getElementById('socratic-send'),
      socraticMessages: document.getElementById('socratic-messages'),

      // Modal
      sessionModal: document.getElementById('sessionModal'),
      closeModalBtn: document.querySelector('.close-button'),
      saveSessionBtn: document.getElementById('saveSessionBtn'),
      sessionNameInput: document.getElementById('sessionName'),
      sessionList: document.getElementById('sessionList'),
   };

   // --- Minimal Toast (non-bloquant) ---
   const toastHost = document.createElement('div');
   toastHost.id = 'toast-container';
   toastHost.style.position = 'fixed';
   toastHost.style.right = '16px';
   toastHost.style.bottom = '16px';
   toastHost.style.zIndex = '10000';
   toastHost.setAttribute('role','status');
   toastHost.setAttribute('aria-live','polite');
   document.body.appendChild(toastHost);
   function showToast(msg, type='info', ms=2600){
      const t = document.createElement('div');
      t.textContent = String(msg||'');
      t.style.marginTop = '8px';
      t.style.padding = '10px 12px';
      t.style.borderRadius = '10px';
      t.style.boxShadow = '0 6px 20px rgba(20,30,58,.12)';
      t.style.background = type==='success' ? '#ecfdf5' : type==='error' ? '#fef2f2' : type==='warn' ? '#fffbeb' : '#f8fafc';
      t.style.border = '1px solid ' + (type==='success' ? '#a7f3d0' : type==='error' ? '#fecaca' : type==='warn' ? '#fde68a' : '#e5e7f2');
      t.style.color = '#111827';
      toastHost.appendChild(t);
      setTimeout(()=>{ t.style.transition='opacity .25s, transform .25s'; t.style.opacity='0'; t.style.transform='translateY(6px)'; }, Math.max(0, ms-250));
      setTimeout(()=> t.remove(), ms);
   }
   // Expose toast globally for addons
   window.coachToast = showToast;

   // --- Application State ---
   let state = {
      rawText: '',
      analysis: {
         headings: [],
         pedagogicalBlocks: [],
         keyPhrases: [],
         articles: [],
         themes: []
      },
      studySheet: {},
   qcm: [],
   qcmMode: 'pro', // 'pro' (QCM++) or 'classic'
   qcmCount: 12,
   examMode: false,
      srs: [], // Spaced Repetition System items
      chatHistory: [],
      socraticHistory: [],
      currentSession: 'default',
      // Revision Flow
      sessionPlan: {
         durationMin: 45,
         constraints: { qcmPenalty: 1, timeAvailableMin: 45 },
         goals: { themesTarget: 3, scoreTarget: 80, dueDate: null }
      },
      progress: {
         timeSpentMin: 0,
         scores: { qcmCorrect: 0, qcmTotal: 0 },
         srsStability: 0,
         lastReviewedByTheme: {}
      },
      schedulerQueue: [],
      longSheets: []
   };

   // --- NLP & Content Generation ---

   function processText() {
      const text = dom.textInput.value;
      if (!text) {
         showToast("Veuillez fournir un texte de cours.", 'warn');
         return;
      }
      state.rawText = text;

      // 1. Semantic Analysis
      state.analysis.headings = splitByHeadings(text);
      state.analysis.pedagogicalBlocks = extractPedagogicalBlocks(text);
      state.analysis.articles = extractArticles ? extractArticles(text) : [];
      state.analysis.keyPhrases = extractKeyPhrases(text);
      state.analysis.themes = makeThemes ? makeThemes(text) : (state.analysis.headings || []);
      renderAnalysis();

      // 2. Generate Study Sheet + Long Sheets
      state.studySheet = generateStudySheet(state.analysis.themes || state.analysis.headings || []);
      state.longSheets = generateLongSheets(
         state.analysis.themes || [],
         state.analysis.pedagogicalBlocks || [],
         state.analysis.articles || [],
         state.analysis.keyPhrases || []
      );
      renderStudySheet();

   // 3. Generate QCMs (default to upgraded generator with fallback)
   regenerateQCMs();
   renderQCMs();
        
      // 4. Initialize SRS
      state.srs = [];
      renderSRS();

      // 5. Reset chats
      state.chatHistory = [];
      state.socraticHistory = [];
      renderChat();
      renderSocraticChat();
      // Optional: attach guided flow if available
      try {
         if (window.RevisionFlow && state.analysis && Array.isArray(state.analysis.themes)) {
            const external = {
               themes: (state.analysis.themes || []).map((t, i) => ({
                  title: t.title,
                  raw: t.raw,
                  summaryLong: state.studySheet?.children?.[i]?.summary || '',
                  summaryShort: (t.sentences || []).slice(0, 2).join(' '),
                  keywords: t.keyPhrases || [],
                  refs: t.references || [],
                  blocks: (state.analysis.pedagogicalBlocks || []).filter(b => (t.raw||'').includes(b.content))
               }))
            };
            // If addon exposing attach exists, mount UI in Fiche
            if (typeof window.RevisionFlow.attach === 'function') {
               window.RevisionFlow.attach(external, { text: state.rawText, qcm: state.qcm, duration: state.sessionPlan?.durationMin || 60 });
            }
            // If addon exposing start exists, render guided flow in Parcours
            if (typeof window.RevisionFlow.start === 'function') {
               window.RevisionFlow.start(external, { duration: state.sessionPlan?.durationMin || 60, lowConfidence: new Set(), spaced: [] });
            }
         }
      } catch (e) { /* no-op */ }
        
   showToast("Analyse et génération terminées !", 'success');
   }

   function splitByHeadings(text) {
      // Simple heuristic: lines that are short and in ALL CAPS or start with "Titre", "Chapitre", etc.
      const lines = text.split('\n');
      const headings = [];
      let currentContent = [];
      let currentHeading = "Introduction";

      lines.forEach(line => {
         if (/^(TITRE|CHAPITRE|SECTION|PARTIE) \d+/.test(line) || (line.length < 80 && line === line.toUpperCase() && line.trim() !== '')) {
            if (currentContent.length > 0) {
               headings.push({ title: currentHeading, content: currentContent.join('\n') });
            }
            currentHeading = line.trim();
            currentContent = [];
         } else {
            currentContent.push(line);
         }
      });
      headings.push({ title: currentHeading, content: currentContent.join('\n') });
      return headings;
   }

   // --- Advanced NLP Helpers ---
   function splitSentences(text) {
      return (text.match(/[^\.!?\n]+[\.!?]+|[^\.!?\n]+$/g) || []).map(s => s.trim()).filter(Boolean);
   }
   function normalize(s) {
      return (s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
   }
   function extractArticles(text) {
      const regex = /\b(?:Article|Art\.)\s*[A-Z]?[\d]+(?:[\-\.][\w]+)?\b[^\n\r]*/gi;
      const matches = text.match(regex) || [];
      const set = new Set(matches.map(s => s.trim()));
      return Array.from(set);
   }
   function freqNGrams(tokens, n) {
      const map = new Map();
      for (let i = 0; i <= tokens.length - n; i++) {
         const gram = tokens.slice(i, i + n).join(' ');
         if (gram.split(' ').some(w => w.length < 3)) continue;
         map.set(gram, (map.get(gram) || 0) + 1);
      }
      return map;
   }
   function topKeyPhrases(text, limit = 20) {
      const cleaned = normalize(text).replace(/[^a-z0-9\s\-']/g, ' ');
      const tokens = cleaned.split(/\s+/).filter(Boolean);
      const stop = new Set(['le','la','les','de','des','du','un','une','et','ou','a','au','aux','en','dans','pour','par','avec','sans','sur','sous','entre','d\'','l\'','que','qui','quoi','dont','est','sont','ete','été','etre','être','ce','cet','cette','ces']);
      const filtered = tokens.filter(t => !stop.has(t) && t.length > 2);
      const maps = [2,3,4].map(n => freqNGrams(filtered, n));
      const combined = new Map();
      for (const m of maps) {
         for (const [k,v] of m.entries()) combined.set(k, (combined.get(k)||0)+v);
      }
      return Array.from(combined.entries()).sort((a,b)=>b[1]-a[1]).slice(0, limit).map(([k])=>k);
   }
   function makeThemes(text) {
      const sections = splitByHeadings(text);
      return sections.map(s => ({
         title: s.title,
         raw: s.content,
         sentences: splitSentences(s.content),
         keyPhrases: topKeyPhrases(s.content, 8),
         references: extractArticles(s.content),
      }));
   }

   function extractPedagogicalBlocks(text) {
      const blocks = [];
      // Regex for definitions, principles, exceptions
      const patterns = {
         definition: /la définition de (.*?)\s*est/gi,
         principle: /le principe (fondamental|général) est que/gi,
         exception: /l'exception (à ce principe|notable) est/gi,
      };
      for (const type in patterns) {
         let match;
         while ((match = patterns[type].exec(text)) !== null) {
            blocks.push({ type, content: match[0] });
         }
      }
      return blocks;
   }

   function extractKeyPhrases(text) {
      return topKeyPhrases(text, 20);
   }

   function generateStudySheet(themes) {
      // Create a study sheet per theme with longer summary enriched by key phrases and blocks
      const sheet = { title: "Fiche de Synthèse", children: [] };
      const blocks = (state.analysis && state.analysis.pedagogicalBlocks) || [];
      themes.forEach(t => {
         const sents = (t.sentences || []);
         const longSummary = sents.slice(0, 6).join(' ');
         const keywords = (t.keyPhrases || []).slice(0, 5);
         // Attach up to 2 blocks that appear in this theme
         const themeBlocks = blocks.filter(b => (t.raw || '').includes(b.content)).slice(0, 2);
         const blocksText = themeBlocks.map(b => `• ${capitalize(b.type)}: ${b.content}`).join('\n');
         const summary = [
            longSummary,
            keywords.length ? `… Mots-clés: ${keywords.join(', ')}` : '',
            blocksText
         ].filter(Boolean).join('\n');
         sheet.children.push({
            title: t.title,
            summary: summary || (t.raw || '').substring(0, 400) + '...',
            full: t.raw || '',
            confidence: 0
         });
      });
      return sheet;
   }

   function renderStudySheet() {
      dom.sheetOutput.innerHTML = state.studySheet.children.map((item, index) => {
         const long = (state.longSheets[index]?.markdown || '')
            .replace(/^##\s(.+)$/gm, '<h5>$1</h5>')
            .replace(/\n\n/g,'<br><br>')
            .replace(/\n\-/g,'<br>-');
         return `
         <div class="srs-item" data-index="${index}">
            <h4>${item.title}</h4>
            <p class="summary">${(item.summary || '').replace(/\n/g,'<br>')}</p>
            ${item.full ? `<button class="btn toggle" data-action="toggle">Voir plus</button>
            <div class="full hidden">${item.full.substring(0, 2000).replace(/\n/g,'<br>')}</div>` : ''}
            ${long ? `<button class="btn toggle long" data-action="toggle-long">Fiche longue</button>
            <div class="full full-long hidden">${long}</div>` : ''}
            <div class="confidence-rating" data-index="${index}">
               <strong>Évaluez votre confiance :</nstrong>
               ${[1,2,3,4,5].map(i => `<span data-value="${i}">⭐</span>`).join('')}
            </div>
         </div>`;
      }).join('');
   }

   // Long sheet generator (SPEC-002)
   function generateLongSheets(themes = [], blocks = [], articles = [], keyPhrases = []) {
      const byType = type => blocks.filter(b => b.type === type);
      const defs = byType('definition');
      const principles = byType('principle');
      const exceptions = byType('exception');
      return themes.map(t => {
         const inTheme = txt => (t.raw || '').includes(txt);
         const themeDefs = defs.filter(b => inTheme(b.content)).slice(0, 3);
         const themePrinciples = principles.filter(b => inTheme(b.content)).slice(0, 3);
         const themeExceptions = exceptions.filter(b => inTheme(b.content)).slice(0, 3);
         const refs = (t.references && t.references.length ? t.references : articles.filter(a => inTheme(a))).slice(0, 6);
         const sents = (t.sentences || []);
         const exampleSents = sents.filter(s => /exemple|application|illustration/i.test(s)).slice(0, 3);
         const gist = (t.keyPhrases && t.keyPhrases.length ? t.keyPhrases : keyPhrases).slice(0, 8);

         const md = [
            `## ${t.title} — fiche longue`,
            '',
            '### Points essentiels',
            ...gist.map(k => `- ${k}`),
            '',
            themeDefs.length ? '### Définition(s)' : '',
            ...themeDefs.map(d => `- ${d.content}`),
            '',
            (themePrinciples.length || themeExceptions.length) ? '### Règles et exceptions' : '',
            ...themePrinciples.map(p => `- Principe: ${p.content}`),
            ...themeExceptions.map(ex => `- Exception: ${ex.content}`),
            '',
            refs.length ? '### Références' : '',
            ...refs.map(r => `- ${r}`),
            '',
            (exampleSents.length || sents.length) ? '### Exemples et applications' : '',
            ...(exampleSents.length ? exampleSents : sents.slice(0, 2)).map(s => `- ${s}`),
            '',
            '### Quiz éclair',
            ...gist.slice(0, 3).map(q => `- Que signifie: "${q}" ?`),
         ].filter(Boolean).join('\n');

         return { markdown: md };
      });
   }
   function generateQCMs(text, analysis, targetCount = 10) {
      const qcms = [];
      const { keyPhrases, pedagogicalBlocks, themes = [], articles = [] } = analysis;
    
      // --- Fabriques à QCM ---
    
      const createFillInTheBlankQCM = (sentence, answer, allKeyPhrases, allSentences) => {
         if (!sentence || !answer) return null;
         // Distracteurs : autres phrases clés qui ne sont pas dans la phrase actuelle
         const distractors = allKeyPhrases
            .filter(p => p.toLowerCase() !== answer.toLowerCase() && !sentence.toLowerCase().includes(p.toLowerCase()))
            .slice(0, 3);
         // Ajouter une phrase parasite tronquée
         if (allSentences && allSentences.length) {
            const parasite = sliceWords(allSentences[Math.floor(Math.random()*allSentences.length)] || '', 18);
            if (parasite && !distractors.includes(parasite)) distractors.push(parasite);
         }
            
         if (distractors.length < 2) return null; // Il faut au moins 2 fausses réponses
    
         return {
            type: 'fill-in-the-blank',
            question: sentence.replace(new RegExp(answer, 'gi'), '______'),
            options: [answer, ...distractors],
            answer: answer,
            answered: null
         };
      };
    
      const createPedagogicalQCM = (block, allBlocks) => {
         let question = '';
         const answer = block.content;
    
         switch (block.type) {
            case 'definition':
               const termMatch = block.content.match(/définition de (.*?)\s*est/i);
               const term = termMatch ? termMatch[1] : 'ce concept';
               question = `Selon le texte, quelle est la définition de "${term}" ?`;
               break;
            case 'principle':
               question = `Quel principe est énoncé dans le texte ?`;
               break;
            case 'exception':
               question = `Quelle exception à un principe est mentionnée ?`;
               break;
            default: return null;
         }
    
         // Distracteurs : autres blocs du même type, sinon autres blocs
         let distractors = allBlocks
            .filter(b => b.type === block.type && b.content !== answer)
            .map(b => b.content);
            
         if (distractors.length < 2) {
            distractors.push(...allBlocks.filter(b => b.content !== answer).map(b => b.content));
         }
            
         // On s'assure d'avoir des distracteurs uniques et en nombre suffisant
         distractors = [...new Set(distractors)].slice(0, 3);

         if (distractors.length < 1) return null;
    
         return {
            type: block.type,
            question: question,
            options: [answer, ...distractors],
            answer: answer,
            answered: null
         };
      };

      const createDefinitionQCM = (block, allDefs) => {
         // Expect pattern: … définition de (X) est|:
         const m = block.content.match(/d\u00e9finition\s+de\s+([^\n\.:;]+)\s*(est|:)\[\s\-]*([^\n]+)/i);
         const term = m ? m[1].trim() : null;
         const def = m ? m[3].trim() : block.content;
         if (!term) return null;
         let distractors = allDefs.filter(b => b.content !== block.content).map(b => {
            const m2 = b.content.match(/d\u00e9finition\s+de\s+([^\n\.:;]+)\s*(est|:)\[\s\-]*([^\n]+)/i);
            return m2 ? m2[3].trim() : b.content;
         });
         // Add modified variants using key phrases if needed
         if (distractors.length < 3) {
            const pool = Array.from(new Set((keyPhrases || []).concat(themes.flatMap(t => t.keyPhrases||[]))));
            const altered = pool.slice(0,3-distractors.length).map(k => def.replace(new RegExp(k,'i'), (k+' alternatif')));
            distractors = distractors.concat(altered);
         }
         distractors = uniq(distractors).filter(x => x && x !== def).slice(0,3);
         if (distractors.length < 2) return null;
         return {
            type: 'definition',
            question: `Quelle est la bonne définition de "${term}" ?`,
            options: shuffleArray([def, ...distractors]).slice(0,4),
            answer: def,
            answered: null
         };
      };

      const createArticleQCM = (art, allArts) => {
         const distractors = uniq([
            ...variantArticles(art),
            ...shuffleArray(allArts.filter(a => a !== art)).slice(0,3)
         ]).filter(a => a !== art).slice(0,3);
         if (distractors.length < 2) return null;
         return {
            type: 'article',
            question: `Quel article est cité dans le texte ?`,
            options: shuffleArray([art, ...distractors]).slice(0,4),
            answer: art,
            answered: null
         };
      };
    
      // --- Boucle de Génération ---
    
      // 1. Générer à partir des blocs pédagogiques (haute qualité)
      for (const block of pedagogicalBlocks) {
         if (qcms.length >= targetCount) break;
         const qcm = createPedagogicalQCM(block, pedagogicalBlocks);
         if (qcm && !qcms.some(existing => existing.question === qcm.question)) {
            qcms.push(qcm);
         }
      }
    
      // 2. Générer des QCMs d'articles (avec voisins numériques)
      if (qcms.length < targetCount && articles.length > 0) {
         for (const art of articles.slice(0, 10)) {
            if (qcms.length >= targetCount) break;
            const q = createArticleQCM(art, articles);
            if (q) qcms.push(q);
         }
      }

      // 3. Générer des définitions
      if (qcms.length < targetCount) {
         const defs = pedagogicalBlocks.filter(b => b.type === 'definition');
         for (const d of defs) {
            if (qcms.length >= targetCount) break;
            const q = createDefinitionQCM(d, defs);
            if (q) qcms.push(q);
         }
      }

      // 4. Générer des textes à trous si on n'a pas atteint la cible
      if (qcms.length < targetCount) {
         const sentences = splitSentences(text);
         const phrasesSource = (themes.length > 0 ? themes.flatMap(t => t.keyPhrases || []) : keyPhrases);
         for (const phrase of phrasesSource) {
            if (qcms.length >= targetCount) break;
            // Trouver une phrase (pas trop longue) contenant la phrase clé
            const candidateSentence = sentences.find(s => s.length >= 60 && s.length <= 300 && s.toLowerCase().includes(phrase.toLowerCase()));
            if (candidateSentence) {
               const allPhrases = Array.from(new Set(phrasesSource.concat(keyPhrases)));
               const qcm = createFillInTheBlankQCM(candidateSentence, phrase, allPhrases, sentences);
               if (qcm && !qcms.some(existing => existing.question === qcm.question)) {
                  qcms.push(qcm);
               }
            }
         }
      }
        
      return qcms;
   }

   // --- Rendering ---

      function renderAnalysis() {
         const themes = state.analysis.themes || [];
         const articles = state.analysis.articles || [];
         dom.analysisOutput.innerHTML = `
            <h4>Titres Sémantiques Détectés</h4>
            <ul>${state.analysis.headings.map(h => `<li>${h.title}</li>`).join('')}</ul>
            <h4>Thèmes</h4>
            <ul>${themes.map(t => `<li><strong>${t.title}:</strong> ${(t.keyPhrases||[]).slice(0,4).join(', ')}</li>`).join('')}</ul>
            <h4>Références (Articles)</h4>
            <ul>${articles.slice(0,10).map(a => `<li>${a}</li>`).join('')}</ul>
            <h4>Blocs Pédagogiques Clés</h4>
            <ul>${state.analysis.pedagogicalBlocks.map(b => `<li><strong>${b.type}:</strong> ${b.content.substring(0,100)}...</li>`).join('')}</ul>
            <h4>Phrases et Concepts Clés</h4>
            <p>${state.analysis.keyPhrases.join(', ')}</p>
         `;
      }

   // (old renderStudySheet removed in favor of unified one above)

   function renderQCMs() {
      // Toolbar (mode + count + regenerate)
   const toolbar = `
         <div class="chat-input-area" style="gap:8px; border:none; align-items:center">
            <label>Mode
               <select id="qcmMode" class="input" style="min-width:140px; margin-left:6px">
                  <option value="pro" ${state.qcmMode==='pro'?'selected':''}>QCM++</option>
                  <option value="classic" ${state.qcmMode==='classic'?'selected':''}>Classique</option>
               </select>
            </label>
            <label>Nombre
               <select id="qcmCount" class="input" style="min-width:90px; margin-left:6px">
                  ${[6,8,10,12,14,16,20].map(n=>`<option value="${n}" ${state.qcmCount===n?'selected':''}>${n}</option>`).join('')}
               </select>
            </label>
            <label style="margin-left:auto">Affichage
               <select id="qcmView" class="input" style="min-width:140px; margin-left:6px">
                  <option value="learn" ${!state.examMode?'selected':''}>Apprentissage</option>
                  <option value="exam" ${state.examMode?'selected':''}>Examen</option>
               </select>
            </label>
            <button id="qcmRegen" class="btn">Regénérer</button>
            <button id="qcmReset" class="btn">Réinitialiser réponses</button>
         </div>`;

   const list = state.qcm.map((q, index) => `
         <div class="qcm-item" data-index="${index}">
            <p><strong>Q${index + 1}:</strong> ${q.question}</p>
            <div class="qcm-meta">
               <span class="badge">${q.type || 'QCM'}</span>
               <span class="badge ${q.meta?.difficulty||'easy'}">${(q.meta?.difficulty||'easy').toUpperCase()}</span>
               <span class="reliability ${q.meta?.reliability||'red'}">Fiabilité</span>
            </div>
            <div class="qcm-options">
         ${(q._order && q._order.length ? q._order : q.options).map(opt => `
                  <label><input type="radio" name="qcm${index}" value="${opt}"> ${opt}</label>
               `).join('')}
            </div>
      <div class="feedback" role="status" aria-live="polite"></div>
            ${state.examMode ? '' : `
            <div class="proof">
               <button class="btn" data-action="toggle-proof">Voir la preuve</button>
               <div class="proof-text hidden">${escapeHTML(q.meta?.proof||q.explain||'')}</div>
            </div>`}
            <div class="qcm-actions">
               <button class="btn" data-action="flag">Signaler ambigu</button>
            </div>
         </div>
      `).join('');
      dom.qcmOutput.innerHTML = toolbar + list;
   }

   function normalizeProQCMItem(item){
      // Map pro schema -> classic schema used by UI/handlers
      const answerStr = item && Array.isArray(item.options) && typeof item.answer==='number' ? item.options[item.answer] : null;
      return {
         type: item.type || 'pro',
         question: item.q || '',
         options: item.options || [],
         answer: answerStr || '',
         answered: null,
         explain: item.explain || '',
         _pro: { id: item.id, ansIndex: item.answer }
      };
   }

   function regenerateQCMs(){
      const count = Number(state.qcmCount)||10;
      if(state.qcmMode==='pro' && window.QcmUpgrade && typeof window.QcmUpgrade.generate==='function'){
         try{
            const proQs = window.QcmUpgrade.generate(state.analysis, count) || [];
      state.qcm = proQs.map(normalizeProQCMItem).map(q=> applyQCMHeuristics(q, state.analysis));
            return;
         }catch(_e){ /* fallback below */ }
      }
      // fallback to classic
   state.qcm = generateQCMs(state.rawText||'', state.analysis, count).map(q=> applyQCMHeuristics(q, state.analysis));

      // Establish a stable option order per question (seeded in exam mode)
      for (let i=0;i<state.qcm.length;i++){
         const q = state.qcm[i];
         const seed = hashString(String(q.question||'') + '|' + String(q.answer||''));
         q._order = state.examMode ? seededShuffle(q.options, seed) : shuffleArray([...q.options]);
      }
   }
    
   function renderSRS() {
      if (state.srs.length === 0) {
         dom.srsOutput.innerHTML = "<p>Aucun élément à réviser pour le moment. Répondez aux QCM ou évaluez votre confiance sur la fiche pour commencer.</p>";
         return;
      }
      dom.srsOutput.innerHTML = state.srs.map(item => `
         <div class="srs-item">
            <p><strong>À réviser :</strong> ${item.type === 'qcm' ? item.data.question : item.data.title}</p>
            <p><em>Raison : ${item.reason}</em></p>
         </div>
      `).join('');
   }

   function renderChat() {
      dom.chatMessages.innerHTML = state.chatHistory.map(msg => 
         `<div class="chat-message ${msg.role}-message">${msg.content}</div>`
      ).join('');
      dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
   }

   function renderSocraticChat() {
      dom.socraticMessages.innerHTML = state.socraticHistory.map(msg => 
         `<div class="chat-message ${msg.role}-message">${msg.content}</div>`
      ).join('');
      dom.socraticMessages.scrollTop = dom.socraticMessages.scrollHeight;
   }

   // --- Event Handlers ---

   // Tabs
   dom.tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-link');
      if (!btn) return;
      dom.tabs.querySelector('.active')?.classList.remove('active');
      btn.classList.add('active');
      dom.tabContent.querySelector('.active')?.classList.remove('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
   });

   // Process button: route by provider
   dom.processBtn.addEventListener('click', async () => {
      const prov = (dom.aiProvider && dom.aiProvider.value) || 'internal';
      if (prov === 'firecrawl') {
         try { await analyseCoursFirecrawl(); } catch (e) { showToast('Firecrawl: ' + (e?.message||e), 'error'); }
      } else {
         processText();
      }
   });

   // File Handling
   dom.dropzone.addEventListener('click', () => dom.fileInput.click());
   dom.fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
   dom.dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dom.dropzone.classList.add('dragover');
   });
   dom.dropzone.addEventListener('dragleave', () => dom.dropzone.classList.remove('dragover'));
   dom.dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dom.dropzone.classList.remove('dragover');
      handleFile(e.dataTransfer.files[0]);
   });

   function handleFile(file) {
      if (!file) return;
      const reader = new FileReader();
      if (file.name.endsWith('.docx')) {
         reader.onload = (e) => {
            mammoth.extractRawText({ arrayBuffer: e.target.result })
               .then(result => {
                  dom.textInput.value = result.value;
               })
               .catch(err => showToast("Erreur de lecture du .docx", 'error'));
         };
         reader.readAsArrayBuffer(file);
      } else {
         reader.onload = (e) => {
            dom.textInput.value = e.target.result;
         };
         reader.readAsText(file);
      }
   }

   // QCM Interaction
   dom.qcmOutput.addEventListener('change', (e) => {
      // Toolbar interactions
      if(e.target.id==='qcmMode'){
         state.qcmMode = e.target.value==='classic' ? 'classic' : 'pro';
         regenerateQCMs();
         renderQCMs();
         return;
      }
      if(e.target.id==='qcmCount'){
         state.qcmCount = Number(e.target.value)||10;
         regenerateQCMs();
         renderQCMs();
         return;
      }
      if(e.target.id==='qcmView'){
         state.examMode = e.target.value==='exam';
         // Recompute option order deterministically when switching view
         for (let i=0;i<state.qcm.length;i++){
            const q = state.qcm[i];
            const seed = hashString(String(q.question||'') + '|' + String(q.answer||''));
            q._order = state.examMode ? seededShuffle(q.options, seed) : shuffleArray([...q.options]);
         }
         renderQCMs();
         return;
      }
      // Question interactions
      if (e.target.name && e.target.name.startsWith('qcm')) {
         const itemDiv = e.target.closest('.qcm-item');
         const index = parseInt(itemDiv.dataset.index);
         const q = state.qcm[index];
         const feedbackDiv = itemDiv.querySelector('.feedback');
            
         if (e.target.value === q.answer) {
            q.answered = 'correct';
            feedbackDiv.textContent = "Correct !";
            feedbackDiv.className = 'feedback correct';
            itemDiv.classList.remove('is-incorrect');
            itemDiv.classList.add('is-correct');
            try{ (window.coachToast||showToast)('Bien joué !','success'); }catch(_){}
         } else {
            q.answered = 'incorrect';
            feedbackDiv.textContent = `Incorrect. La bonne réponse était : ${q.answer}`;
            feedbackDiv.className = 'feedback incorrect';
            itemDiv.classList.remove('is-correct');
            itemDiv.classList.add('is-incorrect');
            // Add to SRS
            addToSRS({ type: 'qcm', data: q, reason: 'Réponse incorrecte' });
            try{ (window.coachToast||showToast)('On révise et on y retourne ✨','warn'); }catch(_){}
         }
      }
   });
   // Toolbar button (click)
   dom.qcmOutput.addEventListener('click', (e)=>{
      if(e.target && e.target.id==='qcmRegen'){
         regenerateQCMs();
         renderQCMs();
      }
      if(e.target && e.target.id==='qcmReset'){
         // Clear selections and feedback, keep same questions
         state.qcm.forEach(q=>{ q.answered = null; });
         const items = dom.qcmOutput.querySelectorAll('.qcm-item');
         items.forEach(item=>{
            item.querySelectorAll('input[type="radio"]').forEach(r=>{ r.checked=false; });
            const fb=item.querySelector('.feedback'); if(fb){ fb.textContent=''; fb.className='feedback'; }
         });
      }
      const btn = e.target.closest('button');
      if(btn && btn.dataset.action==='toggle-proof'){
         const card = btn.closest('.qcm-item');
         const proof = card.querySelector('.proof-text');
         if(proof){ const hidden = proof.classList.toggle('hidden'); btn.textContent = hidden? 'Voir la preuve':'Masquer la preuve'; }
      }
      if(btn && btn.dataset.action==='flag'){
         const card = btn.closest('.qcm-item');
         const index = parseInt(card.dataset.index);
         const q = state.qcm[index];
         q.flagged = true; q.meta = q.meta || {}; q.meta.reliability = 'red';
         addToSRS({ type: 'qcm', data: q, reason: 'Signalé ambigu' });
         btn.disabled = true; btn.textContent = 'Signalé';
         // Re-render reliability badge
         renderQCMs();
      }
   });

   // --- Heuristics & helpers for QCM reliability ---
   function escapeHTML(s){ return (s||'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
   function tokenize(str){ return (str||'').toLowerCase().normalize('NFD').replace(/[^\p{L}\p{N}\s]/gu,' ').split(/\s+/).filter(Boolean); }
   function jaccard(a,b){ const A=new Set(tokenize(a)), B=new Set(tokenize(b)); if(!A.size && !B.size) return 0; let inter=0; for(const x of A) if(B.has(x)) inter++; return inter/(A.size+B.size-inter); }
   function antiOverlapOptions(options, answer){
      const out=[]; const seen=new Set();
      for(const opt of options){
         const o=String(opt).trim(); if(!o) continue; if(seen.has(o)) continue; if(answer && (o===answer)) { out.push(o); seen.add(o); continue; }
         if(answer){ const sim=jaccard(o, answer); if(sim>0.7 || o.includes(answer) || answer.includes(o)) continue; }
         // avoid near-duplicates with existing
         let dupe=false; for(const e of out){ if(jaccard(e,o)>0.8) { dupe=true; break; } }
         if(!dupe){ out.push(o); seen.add(o); }
      }
      // Ensure the correct answer exists
      if(answer && !out.includes(answer)) out.unshift(answer);
      // Cap to 4
      return out.slice(0,4);
   }
   function bestSentencesPool(analysis){
      const pool=[]; (analysis.themes||[]).forEach(t=> (t.sentences||[]).forEach(s=> pool.push(s)) );
      return pool.length? pool : (state.rawText.split(/\n+/).filter(x=>x.length>30));
   }
   function findBestProofSentence(q, analysis){
      const pool=bestSentencesPool(analysis); const key = q.answer || q.question || '';
      let best='', bs=0; for(const s of pool){ const sc = Math.max(jaccard(s, key), jaccard(s, q.question||'')); if(sc>bs){ bs=sc; best=s; } }
      return { text: best, score: bs };
   }
   function difficultyFrom(q, proof){
      const L=(q.question||'').length + (q.answer||'').length; const lenScore = L>220? 0.6 : L>140? 0.4 : 0.2;
      const sims = (q.options||[]).filter(o=>o!==q.answer).map(o=> jaccard(o, proof.text||''));
      const avg = sims.length? sims.reduce((a,b)=>a+b,0)/sims.length : 0;
      const score = lenScore + avg; // 0..~1
      return score>0.55? 'hard' : score>0.3? 'medium' : 'easy';
   }
   function reliabilityFrom(q, proof){
      const scores = (q.options||[]).map(o=> ({o, s: jaccard(o, proof.text||'')})).sort((a,b)=>b.s-a.s);
      const idx = scores.findIndex(x=>x.o===q.answer);
      const top = scores[0]?.s||0, ans = (scores[idx]?.s)||0, second = scores[idx===0?1:0]?.s||0, gap = Math.max(0, ans - second);
      const level = (ans>=0.7 && gap>=0.25)? 'green' : (ans>=0.5 && gap>=0.1)? 'orange' : 'red';
      return { level, scores };
   }
   function applyQCMHeuristics(q, analysis){
      // Normalize and filter options
      q.options = antiOverlapOptions(q.options||[], q.answer||'');
      // Proof
      const proof = findBestProofSentence(q, analysis);
      // Difficulty & reliability
      const diff = difficultyFrom(q, proof);
      const rel = reliabilityFrom(q, proof);
      q.meta = Object.assign({}, q.meta||{}, { difficulty: diff, reliability: rel.level, proof: proof.text, support: rel.scores });
      return q;
   }

   // Confidence Rating
   dom.sheetOutput.addEventListener('click', (e) => {
      if (e.target.tagName === 'SPAN' && e.target.dataset.value) {
         const ratingDiv = e.target.parentElement;
         const index = parseInt(ratingDiv.dataset.index);
         const value = parseInt(e.target.dataset.value);
         state.studySheet.children[index].confidence = value;

         // Update stars UI
         for (let i = 0; i < 5; i++) {
            ratingDiv.children[i+1].style.color = i < value ? 'var(--primary-color)' : '#555';
         }

         if (value < 3) {
            addToSRS({ type: 'sheet', data: state.studySheet.children[index], reason: `Confiance faible (${value}/5)` });
         }
      }
      if (e.target.classList.contains('toggle')) {
         const card = e.target.closest('.srs-item');
         const action = e.target.dataset.action;
         if (action === 'toggle-long') {
            const fullLong = card.querySelector('.full-long');
            if (fullLong) {
               const hidden = fullLong.classList.toggle('hidden');
               e.target.textContent = hidden ? 'Fiche longue' : 'Fermer';
            }
            return;
         }
         if (action === 'toggle') {
            const full = card.querySelector('.full:not(.full-long)');
            if (full) {
               const hidden = full.classList.toggle('hidden');
               e.target.textContent = hidden ? 'Voir plus' : 'Voir moins';
            }
         }
      }
   });

   // Chat
   dom.chatSend.addEventListener('click', handleInternalChat);
   dom.chatInput.addEventListener('keyup', (e) => e.key === 'Enter' && handleInternalChat());

   function handleInternalChat() {
      const query = dom.chatInput.value.trim();
      if (!query) return;
      state.chatHistory.push({ role: 'user', content: query });
      dom.chatInput.value = '';
      renderChat();

      // Simple internal AI logic
      const response = getInternalResponse(query);
      state.chatHistory.push({ role: 'assistant', content: response });
      renderChat();
   }

   // --- Firecrawl Local RAG integration ---
   async function analyseCoursFirecrawl(){
      const texte = dom.textInput.value.trim();
   if(!texte){ showToast('Veuillez fournir un texte de cours.', 'warn'); return; }
      // Build payload using a fake URL (we pass content separately if your backend supports it)
      const payload = {
         urls: ["https://cours.local/" + Date.now()],
         prompt: "Agis comme un professeur expérimenté. Résume ce texte en trois sections pédagogiques : Notions clés à comprendre, Définitions essentielles, Questions à poser à l’élève pour vérifier sa compréhension.",
         schema: {
            type: 'object',
            properties: {
               notions_cles: { type: 'array', items: { type: 'string' }},
               definitions: { type: 'array', items: { type: 'string' }},
               questions: { type: 'array', items: { type: 'string' }}
            },
            required: ['notions_cles','definitions','questions']
         },
         // Optionally include raw text if your Firecrawl fork supports it
         text: texte
      };
      const res = await fetch('http://localhost:3002/v1/extract', {
         method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      if(!res.ok){ const msg = await res.text(); throw new Error('HTTP '+res.status+': '+msg); }
      const result = await res.json();
      const data = result?.data || result || {};
      // Render into the sheet area and keep rest of pipeline working
      dom.sheetOutput.innerHTML = `
         <h4>📘 Notions Clés</h4>
         <ul>${(data.notions_cles||[]).map(x=>`<li>${escapeHTML(String(x))}</li>`).join('')}</ul>
         <h4>📖 Définitions</h4>
         <ul>${(data.definitions||[]).map(x=>`<li>${escapeHTML(String(x))}</li>`).join('')}</ul>
         <h4>❓ Questions de compréhension</h4>
         <ul>${(data.questions||[]).map(x=>`<li>${escapeHTML(String(x))}</li>`).join('')}</ul>`;
      // Also run local analysis (without re-rendering the sheet) for QCM/SRS/Chats/Parcours
      state.rawText = texte;
      state.analysis.headings = splitByHeadings(texte);
      state.analysis.pedagogicalBlocks = extractPedagogicalBlocks(texte);
      state.analysis.articles = extractArticles ? extractArticles(texte) : [];
      state.analysis.keyPhrases = extractKeyPhrases(texte);
      state.analysis.themes = makeThemes ? makeThemes(texte) : (state.analysis.headings || []);
      renderAnalysis();

      // Prepare study data in state (used by guided flow), but do not overwrite the Firecrawl sheet UI
      state.studySheet = generateStudySheet(state.analysis.themes || state.analysis.headings || []);
      state.longSheets = generateLongSheets(
         state.analysis.themes || [],
         state.analysis.pedagogicalBlocks || [],
         state.analysis.articles || [],
         state.analysis.keyPhrases || []
      );

      // QCM and SRS
      regenerateQCMs();
      renderQCMs();
      state.srs = [];
      renderSRS();

      // Reset chats
      state.chatHistory = [];
      state.socraticHistory = [];
      renderChat();
      renderSocraticChat();

      // Attach/start guided flow if available (matching processText behavior)
      try {
         if (window.RevisionFlow && state.analysis && Array.isArray(state.analysis.themes)) {
            const external = {
               themes: (state.analysis.themes || []).map((t, i) => ({
                  title: t.title,
                  raw: t.raw,
                  summaryLong: state.studySheet?.children?.[i]?.summary || '',
                  summaryShort: (t.sentences || []).slice(0, 2).join(' '),
                  keywords: t.keyPhrases || [],
                  refs: t.references || [],
                  blocks: (state.analysis.pedagogicalBlocks || []).filter(b => (t.raw||'').includes(b.content))
               }))
            };
            if (typeof window.RevisionFlow.attach === 'function') {
               window.RevisionFlow.attach(external, { text: state.rawText, qcm: state.qcm, duration: state.sessionPlan?.durationMin || 60 });
            }
            if (typeof window.RevisionFlow.start === 'function') {
               window.RevisionFlow.start(external, { duration: state.sessionPlan?.durationMin || 60, lowConfidence: new Set(), spaced: [] });
            }
         }
      } catch (e) { /* no-op */ }
   }

   function getInternalResponse(query) {
      // Basic TF-IDF retrieval on theme sentences
      const q = normalize(query);
      const tokens = q.split(/\s+/).filter(Boolean);
      const themes = state.analysis.themes || [];
      const docs = [];
      themes.forEach(t => (t.sentences||[]).forEach(s => docs.push({ theme: t.title, text: s, norm: normalize(s) })));
      if (docs.length === 0) {
         const found = state.analysis.headings.find(h => h.content.toLowerCase().includes(query.toLowerCase()));
         return found ? `Voici ce que j'ai trouvé concernant "${query}":\n\n${found.content.substring(0, 300)}...` : "Désolé, je n'ai pas trouvé d'information pertinente dans le document. Essayez de reformuler.";
      }
      const N = docs.length;
      const df = Object.create(null);
      tokens.forEach(tok => {
         const re = new RegExp(`\\b${escapeRegex(tok)}\\b`,'i');
         df[tok] = docs.reduce((acc,d)=> acc + (re.test(d.norm)?1:0), 0);
      });
      function scoreDoc(d) {
         let score = 0;
         for (const tok of tokens) {
            const tf = (d.norm.match(new RegExp(`\\b${escapeRegex(tok)}\\b`,'gi')) || []).length;
            if (!tf) continue;
            const idf = Math.log((N+1)/((df[tok]||0)+1));
            score += tf * idf;
         }
         // Prefer mid-length sentences
         const len = d.text.length; if (len > 60 && len < 300) score *= 1.2;
         return score;
      }
      const top = docs
         .map(d => ({ d, s: scoreDoc(d) }))
         .sort((a,b)=>b.s-a.s)
         .slice(0,3)
         .filter(x => x.s > 0.0001);
      if (top.length) {
         const theme = top[0].d.theme;
         const answer = top.map(x=>x.d.text).join(' ');
         return `Voici ce que j'ai trouvé (approx.) dans le thème "${theme}" pour "${query}":\n\n${answer}`;
      }
      return "Désolé, je n'ai pas trouvé d'information pertinente dans le document. Essayez de reformuler.";
   }

   // --- Small text helpers ---
   function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
   function uniq(arr) { return Array.from(new Set(arr)); }
   function sliceWords(s, n) {
      const parts = (s||'').split(/\s+/).filter(Boolean).slice(0, n);
      return parts.join(' ');
   }
   function variantArticles(str) {
      // Try to perturb article numbers: 1217 -> 1216, 1218 etc
      const m = String(str).match(/(Article|Art\.)\s*([A-Z]\.)?\s*(\d+)/i);
      if (!m) return [];
      const num = parseInt(m[3], 10);
      const base = str.replace(/\d+/, String(num));
      const neighbors = [num-1, num+1, num+2].filter(x => x > 0).map(n => base.replace(/\d+/, String(n)));
      return neighbors;
   }
   function capitalize(s){ return (s||'').charAt(0).toUpperCase()+ (s||'').slice(1); }

   // Socratic Chat
   dom.socraticSend.addEventListener('click', handleSocraticChat);
   dom.socraticInput.addEventListener('keyup', (e) => e.key === 'Enter' && handleSocraticChat());

   async function handleSocraticChat() {
      const raw = dom.socraticInput.value.trim();
      if (!raw) return;
      const provider = (dom.aiProvider && dom.aiProvider.value) || 'openai';
      const apiKey = dom.apiKey ? dom.apiKey.value.trim() : '';

      // Push user message
      state.socraticHistory.push({ role: 'user', content: raw });
      dom.socraticInput.value = '';
      renderSocraticChat();

      // Disable input + show typing (as a temp assistant message)
      dom.socraticInput.disabled = true; dom.socraticSend.disabled = true;
      state.socraticHistory.push({ role: 'assistant', content: '…' });
      const typingIndex = state.socraticHistory.length - 1;
      renderSocraticChat();

      // Build Socratic prompt
      const socraticPrompt = `Contexte du cours: ${state.rawText.substring(0, 2000)}\n\nHistorique de la conversation:\n${state.socraticHistory.slice(0, -1).map(m => `${m.role}: ${m.content}`).join('\n')}\n\nRôle: Tu es un tuteur socratique. Ne donne JAMAIS de réponse directe. Ton but est de guider l'étudiant vers la réponse par une série de questions. Analyse sa dernière question ("${raw}") et pose UNE SEULE question ouverte qui le pousse à réfléchir.`;

      try {
         const answer = await askAssistantWithProviders(socraticPrompt, provider, apiKey, raw);
         state.socraticHistory[typingIndex].content = answer || "Je n'ai pas pu obtenir de réponse. Essayez à nouveau ou changez de provider.";
      } catch (error) {
         state.socraticHistory[typingIndex].content = `Erreur: ${error.message}`;
      } finally {
         dom.socraticInput.disabled = false; dom.socraticSend.disabled = false;
         renderSocraticChat();
      }
   }

   // --- Unified HTTP + Provider Adapter (Chat Assistant pattern) ---
   async function callHTTPJSON(url, body, { timeoutMs = 20000, headers = {} } = {}) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
         const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body),
            signal: ctrl.signal
         });
         const data = await res.json().catch(() => ({}));
         return { ok: res.ok, data, status: res.status };
      } finally { clearTimeout(t); }
   }

   async function callLLM(prompt, provider, apiKey) {
      try {
         if (provider === 'auto') {
            // Try OpenAI, then Ollama
            const o = await callLLM(prompt, 'openai', apiKey);
            if (o) return o;
            const l = await callLLM(prompt, 'ollama', apiKey);
            return l;
         }

         if (provider === 'picoapps') {
            const url = (window.COACH_PICOAPPS_URL || 'https://backend.buildpicoapps.com/aero/run/llm-api?pk=YOUR_PK');
            const { ok, data } = await callHTTPJSON(url, { prompt }, { timeoutMs: 25000 });
            return ok && (data.status === 'success') ? (data.text || null) : null;
         }

         if (provider === 'openai') {
            if (!apiKey) return null;
            const { ok, data } = await callHTTPJSON('https://api.openai.com/v1/chat/completions', {
               model: 'gpt-3.5-turbo',
               messages: [
                  { role: 'system', content: 'Prof de droit français. Réponds de manière courte et socratique.' },
                  { role: 'user', content: prompt }
               ],
               temperature: 0.2, max_tokens: 600
            }, { timeoutMs: 25000, headers: { Authorization: `Bearer ${apiKey}` } });
            return ok ? (data.choices?.[0]?.message?.content || null) : null;
         }

         if (provider === 'ollama') {
            const { ok, data } = await callHTTPJSON('http://localhost:11434/api/generate', {
               model: 'llama3', prompt, options: { temperature: 0.2 }, stream: false
            }, { timeoutMs: 30000 });
            return ok ? (data.response || null) : null;
         }
      } catch (e) {
         // Swallow to allow fallback
         return null;
      }
      return null;
   }

   async function askAssistant(rawQuestion) {
      const provider = (dom.aiProvider && dom.aiProvider.value) || 'openai';
      const apiKey = dom.apiKey ? dom.apiKey.value.trim() : '';
      const isImage = rawQuestion.startsWith('/image ');
      const q = isImage ? rawQuestion.replace('/image ', '') : rawQuestion;
      if (provider === 'picoapps' && isImage) {
         const url = (window.COACH_PICOAPPS_IMG_URL || 'https://backend.buildpicoapps.com/aero/run/image-generation-api?pk=YOUR_PK');
         const { ok, data } = await callHTTPJSON(url, { prompt: q }, { timeoutMs: 30000 });
         return ok && data.status === 'success' ? `[Image]: ${data.text}` : 'Erreur image.';
      }
      return await callLLM(q, provider, apiKey);
   }

   async function askAssistantWithProviders(prompt, provider, apiKey, raw) {
      // Try selected provider; if null and provider==='auto', fall back inside callLLM
      const ans = await askAssistant(raw?.startsWith('/image ') ? raw : prompt);
      if (ans) return ans;
      // If nothing, fallback to internal guidance question from TF-IDF context
      const internal = getInternalResponse(prompt);
      return internal;
   }

   // --- SRS Logic ---
   function addToSRS(item) {
      // Avoid duplicates
      const existingIndex = state.srs.findIndex(srsItem => 
         srsItem.type === item.type && 
         (srsItem.data.question === item.data.question || srsItem.data.title === item.data.title)
      );
      if (existingIndex === -1) {
         state.srs.push(item);
      }
      renderSRS();
   }

   // --- Session Management ---
   dom.sessionBtn.addEventListener('click', () => {
      renderSessionList();
      dom.sessionModal.style.display = 'block';
   });
   dom.closeModalBtn.addEventListener('click', () => dom.sessionModal.style.display = 'none');
   window.addEventListener('click', (e) => {
      if (e.target == dom.sessionModal) {
         dom.sessionModal.style.display = 'none';
      }
   });

   dom.saveSessionBtn.addEventListener('click', () => {
      const name = dom.sessionNameInput.value.trim();
      if (!name) {
         showToast("Veuillez donner un nom à la session.", 'warn');
         return;
      }
      localStorage.setItem(`coach_session_${name}`, JSON.stringify(state));
      dom.sessionNameInput.value = '';
      renderSessionList();
   });

   dom.sessionList.addEventListener('click', (e) => {
      if (e.target.classList.contains('load-btn')) {
         const name = e.target.dataset.name;
         const savedState = localStorage.getItem(`coach_session_${name}`);
         if (savedState) {
            state = JSON.parse(savedState);
            // Backward-compatible defaults for new prefs
            if (!state.qcmMode) state.qcmMode = 'pro';
            if (!state.qcmCount) state.qcmCount = 12;
            // Backward-compatible defaults for new prefs
            if (typeof state.examMode !== 'boolean') state.examMode = false;
            // Re-render everything
            dom.textInput.value = state.rawText;
            renderAnalysis();
            renderStudySheet();
            regenerateQCMs();
            renderQCMs();
            renderSRS();
            renderChat();
            renderSocraticChat();
            dom.sessionModal.style.display = 'none';
            showToast(`Session "${name}" chargée.`, 'success');
         }
      }
      if (e.target.classList.contains('delete-btn')) {
         const name = e.target.dataset.name;
         if (confirm(`Voulez-vous vraiment supprimer la session "${name}" ?`)) {
            localStorage.removeItem(`coach_session_${name}`);
            renderSessionList();
         }
      }
   });

   function renderSessionList() {
      dom.sessionList.innerHTML = '';
      for (let i = 0; i < localStorage.length; i++) {
         const key = localStorage.key(i);
         if (key.startsWith('coach_session_')) {
            const name = key.replace('coach_session_', '');
            dom.sessionList.innerHTML += `
               <div class="session-item">
                  <span>${name}</span>
                  <div>
                     <button class="btn load-btn" data-name="${name}">Charger</button>
                     <button class="btn delete-btn" data-name="${name}">Suppr.</button>
                  </div>
               </div>
            `;
         }
      }
   }

   // --- Utility ---
   function shuffleArray(array) {
      for (let i = array.length - 1; i > 0; i--) {
         const j = Math.floor(Math.random() * (i + 1));
         [array[i], array[j]] = [array[j], array[i]];
      }
      return array;
   }

   // Deterministic RNG utilities for stable option order in exam mode
   function hashString(str){ let h=2166136261>>>0; for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,16777619)>>>0; } return h>>>0; }
   function lcg(seed){ let s=(seed>>>0)||1; return ()=> (s = (Math.imul(1664525, s) + 1013904223) >>> 0) / 4294967296; }
   function seededShuffle(arr, seed){ const a=[...arr]; const rnd=lcg(seed); for(let i=a.length-1;i>0;i--){ const j=Math.floor(rnd()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

   // --- Initial Load ---
   // Try to load a default session if it exists
   const defaultState = localStorage.getItem('coach_session_default');
   if (defaultState) {
      state = JSON.parse(defaultState);
   if (!state.qcmMode) state.qcmMode = 'pro';
   if (!state.qcmCount) state.qcmCount = 12;
   if (typeof state.examMode !== 'boolean') state.examMode = false;
   dom.textInput.value = state.rawText || '';
   renderAnalysis();
   renderStudySheet();
   regenerateQCMs();
   renderQCMs();
   renderSRS();
   renderChat();
   renderSocraticChat();
   }

   // === UI Addon: Brand header + Flashcards (Quizlet-like) ===
   (function(){
      function escapeHTML2(s){ try{ return escapeHTML ? escapeHTML(s) : (s||'').replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c])); }catch(_){ return String(s||''); } }
      function mountHeader(){
         const mainContainer = document.querySelector('main.container');
         if(!mainContainer || document.querySelector('.app-header')) return;
         const header = document.createElement('div'); header.className='app-header';
         header.innerHTML = `
           <div class="app-brand">
             <span class="logo">${logoSVG()}</span>
             <span>Coach – Académie des Chouettes</span>
           </div>
           <div class="app-tools">
             <button class="theme-toggle" type="button" aria-pressed="false">Thème</button>
           </div>`;
         mainContainer.prepend(header);
         const btn = header.querySelector('.theme-toggle');
         const key='coach_theme_dark';
         const apply = on => document.body.classList.toggle('theme-dark', !!on);
         const cur = localStorage.getItem(key)==='1'; apply(cur); btn.setAttribute('aria-pressed', cur?'true':'false');
         btn.onclick=()=>{ const on = !(localStorage.getItem(key)==='1'); localStorage.setItem(key,on?'1':'0'); btn.setAttribute('aria-pressed', on?'true':'false'); apply(on); };
      }
      function logoSVG(){
         return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 44 44" aria-hidden="true">
           <defs><radialGradient id="g" cx="50%" cy="35%" r="75%"><stop offset="0%" stop-color="#fff"/><stop offset="55%" stop-color="#E7ECFF"/><stop offset="100%" stop-color="#C9D3FF"/></radialGradient></defs>
           <circle cx="22" cy="22" r="20" fill="url(#g)"/>
           <circle cx="16" cy="17" r="4" fill="#0B1020"/><circle cx="28" cy="17" r="4" fill="#0B1020"/>
           <rect x="20" y="21" width="6" height="6" transform="rotate(45 23 24)" fill="#FFD166"/>
         </svg>`;
      }
      function mountFlashcardsPane(){
         const tabs = document.querySelector('.tabs'); const tabContent=document.getElementById('tab-content');
         if(!tabs || !tabContent || document.getElementById('flashcards-pane')) return;
         const link=document.createElement('button'); link.className='tab-link'; link.dataset.tab='flashcards-pane'; link.textContent='Cartes'; tabs.appendChild(link);
         const pane=document.createElement('div'); pane.className='tab-pane'; pane.id='flashcards-pane';
         pane.innerHTML = `
            <div class="fc-toolbar">
              <button class="btn" id="fc-build">Générer depuis QCM</button>
              <button class="btn" id="fc-flip">Retourner (Espace)</button>
              <div class="paw-progress" style="flex:1"><div class="bar"></div></div>
              <div class="fc-stats" aria-live="polite"></div>
            </div>
            <div class="fc-deck" aria-live="polite"></div>
            <div class="fc-actions">
              <button class="btn" id="fc-wrong">Je ne savais pas (2)</button>
              <button class="btn primary" id="fc-right">Je savais (1)</button>
            </div>`;
         tabContent.appendChild(pane);
      }
      function getDeck(){
         const st = window.__coach && window.__coach.getState ? window.__coach.getState() : null;
         const qcm = st && Array.isArray(st.qcm) ? st.qcm : [];
         const deck = qcm.map((q,i)=>({ id:i, front:`Q${i+1}. ${q.question||''}`, back:`${q.answer||''}${q.meta?.proof?`\n\n💡 ${q.meta.proof}`:''}` })).filter(c=>c.front && c.back);
         return deck.length? deck : [{ id:0, front:'Aucune question pour l’instant.', back:'Générez les QCM puis cliquez “Générer depuis QCM”.' }];
      }
      const FC = {
         deck:[], i:0, flipped:false, elDeck:null, elStats:null, elBar:null,
         reset(d){ this.deck=d||[]; this.i=0; this.flipped=false; this.render(); },
         next(){ if(this.i < this.deck.length-1){ this.i++; this.flipped=false; this.render(); } },
         prev(){ if(this.i>0){ this.i--; this.flipped=false; this.render(); } },
         flip(){ this.flipped=!this.flipped; this.render(true); },
         mark(right){ const key='fc_stats'; const s=JSON.parse(localStorage.getItem(key)||'{"right":0,"wrong":0,"total":0}'); right? s.right++ : s.wrong++; s.total++; localStorage.setItem(key, JSON.stringify(s)); try{ (window.coachToast||showToast)( right? 'Bien joué !' : 'On révise et on y retourne ✨', right? 'success':'warn'); }catch(_){} this.updateStats(); this.next(); },
         mount(){ const pane=document.getElementById('flashcards-pane'); if(!pane) return; this.elDeck=pane.querySelector('.fc-deck'); this.elStats=pane.querySelector('.fc-stats'); this.elBar=pane.querySelector('.paw-progress .bar'); this.bind(pane); this.updateStats(); },
         bind(p){ p.querySelector('#fc-build').onclick=()=>{ this.reset(getDeck()); try{ (window.coachToast||showToast)('Cartes générées','success'); }catch(_){} }; p.querySelector('#fc-flip').onclick=()=>this.flip(); p.querySelector('#fc-right').onclick=()=>this.mark(true); p.querySelector('#fc-wrong').onclick=()=>this.mark(false);
            window.addEventListener('keydown',(e)=>{ if(!p.classList.contains('active')) return; if(e.code==='Space'){ e.preventDefault(); this.flip(); } if(e.key==='ArrowRight') this.next(); if(e.key==='ArrowLeft') this.prev(); if(e.key==='1') this.mark(true); if(e.key==='2') this.mark(false); }); },
         render(onlyFlip=false){ if(!this.elDeck) return; const card=this.deck[this.i]||{front:'—',back:''}; const pct=Math.round(((this.i+1)/Math.max(1,this.deck.length))*100); if(!onlyFlip){ this.elDeck.innerHTML=`<article class="fc-card ${this.flipped?'is-flipped':''}" aria-live="polite" aria-label="Carte"><div class="face front"><h3>${escapeHTML2(card.front)}</h3></div><div class="face back"><p>${escapeHTML2(card.back).replace(/\n/g,'<br>')}</p></div></article>`; } else { const el=this.elDeck.querySelector('.fc-card'); if(el) el.classList.toggle('is-flipped', this.flipped); } if(this.elBar) this.elBar.style.width=pct+'%'; this.updateStats(); },
         updateStats(){ const s=JSON.parse(localStorage.getItem('fc_stats')||'{"right":0,"wrong":0,"total":0}'); const info=`${this.i+1}/${Math.max(1,this.deck.length)} • ✔︎ ${s.right} · ✖︎ ${s.wrong}`; if(this.elStats) this.elStats.textContent=info; }
      };
      // Mount after initial renders
      setTimeout(()=>{ mountHeader(); mountFlashcardsPane(); FC.mount(); FC.reset(getDeck()); }, 0);
   })();

   // --- Expose minimal read-only API for addons ---
   window.__coach = {
      getState: () => state,
      onQcmChanged: (fn) => { try { fn(state.qcm || []); } catch(_){} }
   };
});

// === revision-flow-addon (embedded) ===
(function(){
   const STOP = new Set('au aux avec ce ces dans de des du elle en et eux il je la le les leur lui ma mais me même mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous'.split(/\s+/));
   function normalize(text){ return (text||'').toLowerCase().normalize('NFD').replace(/[^\p{L}\s]/gu,' '); }
   function splitSentences(text){ return (text||'').replace(/([.!?])+/g,'$1|').split('|').map(s=>s.trim()).filter(Boolean); }
   function uniq(arr){ return [...new Set((arr||[]).map(x=>String(x).trim()).filter(Boolean))]; }
   function topKeyPhrases(text,k=15){
      const words=normalize(text).split(/\s+/).filter(Boolean);
      const phrases=[]; let cur=[];
      for(const w of words){ if(STOP.has(w)){ if(cur.length){phrases.push(cur); cur=[];} } else cur.push(w); }
      if(cur.length) phrases.push(cur);
      const freq=new Map(), degree=new Map();
      for(const ph of phrases){
         const uniqW=new Set(ph);
         for(const w of ph){ freq.set(w,(freq.get(w)||0)+1); degree.set(w,(degree.get(w)||0)+(ph.length-1)); }
         for(const w of uniqW){ degree.set(w,(degree.get(w)||0)+(uniqW.size-1)); }
      }
      const scoreWord=new Map(); for(const [w,f] of freq.entries()){ scoreWord.set(w,(degree.get(w)||0)/f); }
      const phraseScores=phrases.map(ph=>({p:ph.join(' '),score:ph.reduce((s,w)=>s+(scoreWord.get(w)||0),0)}));
      return uniq(phraseScores.sort((a,b)=>b.score-a.score).map(x=>x.p)).slice(0,k);
   }
   function rankSentences(text, keywords){
      const sents=splitSentences(text), norm=sents.map(s=>normalize(s)), total=sents.length, idf=new Map();
      for(const k of (keywords||[])){ const r=new RegExp(`\\b${k}\\b`,'i'); const c=norm.filter(s=>r.test(s)).length; idf.set(k, Math.log((1+total)/(1+c))+1); }
      const scored=sents.map((s,i)=>{ let score=0; const n=norm[i]; for(const k of (keywords||[])){ const m=n.match(new RegExp(`\\b${k}\\b`,'gi')); if(m) score+=m.length*(idf.get(k)||1); } return {s,score}; });
      return scored.sort((a,b)=>b.score-a.score).map(x=>x.s);
   }
   function htmlEscape(str){return (str||'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}

   function buildLongSheet(theme){
      const text = theme.raw || '';
      const sents = splitSentences(text);
      const kws = theme.keywords?.length ? theme.keywords : topKeyPhrases(text, 15);
      const pick = (re, max) => sents.filter(s=>re.test(s)).slice(0,max);
      const join = arr => arr.join(' ');
      const ranked = rankSentences(text, kws||[]);
      const ensure = (arr,min,pool=ranked)=> (arr.length>=min?arr:arr.concat(pool.filter(s=>!arr.includes(s)).slice(0,min-arr.length)));

      const def   = ensure(pick(/\b(définition|se définit|est|consiste)\b/i,6),4);
      const princ = ensure(pick(/\b(principe|en règle|en principe)\b/i,8),6);
      const exc   = ensure(pick(/\b(exception|sauf|sauf si|sauf lorsque)\b/i,8),4);
      const juris = ensure(pick(/\b(arr[êe]t|cour de cassation|conseil d[’']état|ce\b|cjue|jurisprudence)\b/i,10),6);
      const ex    = ensure(pick(/\b(par exemple|exemple|illustration|cas pratique)\b/i,8),4);
      const piege = ensure(pick(/\b(attention|ne pas confondre|confusion|pi[eè]ge)\b/i,6),3);

      const mk = [
         `# ${theme.title||'Thème'}`,
         `## Définition`, join(def),
         `## Principe`, join(princ),
         `## Exceptions`, join(exc)||'—',
         `## Jurisprudence clé`, join(juris)||'—',
         `## Exemples`, join(ex)||'—',
         `## Pièges fréquents`, join(piege)||'—',
         `## Questions-types d’examen`,
         ['- Expliquez la notion.','- Donnez une exception et sa justification.','- Illustrez par un cas pratique bref.','- Quelle portée jurisprudentielle ?'].join('\n'),
         `## Mots-clés`, (kws||[]).slice(0,20).join(', ')||'—',
         `## Articles cités`, (theme.refs||[]).slice(0,12).join(', ')||'—'
      ].join('\n\n');
      return mk;
   }
   function buildLongSheetHTML(theme){
      const md = buildLongSheet(theme);
      const html = md
         .replace(/^# (.*)$/mg,'<h3>$1</h3>')
         .replace(/^## (.*)$/mg,'<h4>$1</h4>')
         .replace(/^- (.*)$/mg,'<li>$1</li>')
         .replace(/\n{2,}/g,'</p><p>')
         .replace(/\n/g,'<br>');
      return `<article class="qcm-item"><p>${html}</p></article>`;
   }

   function themeDifficultyIndex(analysis, state){
      const arr = (analysis.themes||[]).map((t,i)=>({i,title:t.title||'',score:0}));
      const spaced = state?.spaced || [];
      const low = new Set(state?.lowConfidence||[]);
      arr.forEach(x=>{
         if(low.has(x.title)) x.score+=2;
         const hits = spaced.filter(q =>
            ((q.explain||'').toLowerCase().includes((x.title||'').toLowerCase())) ||
            ((q.q||'').toLowerCase().includes((x.title||'').toLowerCase()))
         ).length;
         x.score += Math.min(3,hits);
      });
      return arr.sort((a,b)=>b.score-a.score).map(x=>x.i);
   }
   function buildSessionPlan(analysis, state){
      const dur = Number((state?.duration)||60);
      const themeIdx = themeDifficultyIndex(analysis, state).slice(0, Math.max(2, Math.floor(dur/20)));
      const perThemeLearnMin = Math.max(6, Math.floor(dur/(3*Math.max(2,themeIdx.length||1))));
      const steps = [{type:'diagnostic', size:5}];
      for(const i of themeIdx){
         steps.push({type:'learn', theme:i, minutes:perThemeLearnMin});
         steps.push({type:'practice', theme:i, size:4});
         steps.push({type:'recall', theme:i, prompts:3});
      }
      steps.push({type:'test', size:8});
      return steps;
   }
   function renderStepLabel(analysis, s){
      const t = (i)=> htmlEscape(analysis.themes[i]?.title||'');
      if(s.type==='diagnostic') return `<li>Diagnostic (QCM rapides ×${s.size})</li>`;
      if(s.type==='learn') return `<li>Apprentissage – ${t(s.theme)} (${s.minutes} min)</li>`;
      if(s.type==='practice') return `<li>Pratique QCM – ${t(s.theme)} (×${s.size})</li>`;
      if(s.type==='recall') return `<li>Rappel actif – ${t(s.theme)} (3 réponses ouvertes)</li>`;
      if(s.type==='test') return `<li>Test final (×${s.size})</li>`;
      return `<li>${s.type}</li>`;
   }
   function renderFlow(analysis, state){
      const container = document.getElementById('flow-output');
      if(!container) return;
      const plan = buildSessionPlan(analysis, state);
      container.innerHTML = `
         <div class="chat-input-area" style="gap:8px; border:none; align-items:center">
            <label>Durée (min)
               <select id="flowDuration" class="input" style="min-width:90px; margin-left:6px">
                  ${[30,45,60,75,90].map(n=>`<option value="${n}" ${Number(state.duration)===n?'selected':''}>${n}</option>`).join('')}
               </select>
            </label>
            <button id="flowUpdate" class="btn">Mettre à jour</button>
            <button id="startFlow" class="btn primary" style="margin-left:auto">Démarrer</button>
         </div>
         <ol class="plan">${plan.map(s=>renderStepLabel(analysis,s)).join('')}</ol>
         <div id="flowStage" style="margin-top:10px"></div>`;
      document.getElementById('startFlow').onclick = ()=> runFlow(analysis, state, plan);
      document.getElementById('flowUpdate').onclick = ()=>{
         const sel = document.getElementById('flowDuration');
         const val = Number(sel && sel.value || state.duration || 60);
         const next = { ...state, duration: val };
         window.__coach_state = next;
         renderFlow(analysis, next);
      };
   }
   function renderRecallBlock(theme){
      const prompts = [
         'Donnez la définition.',
         'Citez une exception et sa justification.',
         'Illustrez par un cas pratique bref.'
      ].map(p=>`<div class="qcm-item"><b>${p}</b><br><textarea placeholder="Répondez ici…"></textarea></div>`).join('');
      return `<h4>Rappel actif – ${htmlEscape(theme.title||'')}</h4>${prompts}<div class="warn" style="margin-top:8px">Comparez ensuite avec la fiche longue pour vous auto-corriger.</div>`;
   }
   function runFlow(analysis, state, steps){
      let i=0; const stage=document.getElementById('flowStage');
      const nextBtn = document.createElement('button'); nextBtn.textContent='Suivant'; nextBtn.className='btn';
      nextBtn.onclick = ()=>{ i++; doStep(); };
      function doStep(){
         if(i>=steps.length){ stage.innerHTML='<div class="qcm-item" style="border-left:4px solid #28a745">Session terminée 🎉</div>'; return; }
         const s=steps[i];
         if(s.type==='learn'){
            stage.innerHTML = buildLongSheetHTML(analysis.themes[s.theme]); stage.appendChild(nextBtn);
         }else if(s.type==='practice'){
            stage.innerHTML = `<div class="qcm-item">Répondez aux QCM dans l’onglet “QCM” pour « ${htmlEscape(analysis.themes[s.theme].title||'')} », puis cliquez Suivant.</div>`; stage.appendChild(nextBtn);
         }else if(s.type==='diagnostic'){
            stage.innerHTML = `<div class="qcm-item">Diagnostic lancé (préparez quelques QCM dans l’onglet “QCM”), puis cliquez Suivant.</div>`; stage.appendChild(nextBtn);
         }else if(s.type==='recall'){
            stage.innerHTML = renderRecallBlock(analysis.themes[s.theme]); stage.appendChild(nextBtn);
         }else if(s.type==='test'){
            stage.innerHTML = `<div class="qcm-item">Test final : faites un lot de QCM dans l’onglet “QCM”.</div>`; stage.appendChild(nextBtn);
         }
      }
      doStep();
   }
   function mountLongSheetUI(analysis){
      const sheetRoot = document.getElementById('sheet-output'); if(!sheetRoot) return;
      const sel = document.createElement('select'); sel.className='input'; sel.style.minWidth='260px';
      sel.innerHTML = (analysis.themes||[]).map((t,i)=>`<option value="${i}">${htmlEscape(t.title||('Thème '+(i+1)))}</option>`).join('');
      const toggle = document.createElement('label'); toggle.className='btn'; toggle.style.marginLeft='8px';
      toggle.innerHTML = `<input type="checkbox" id="longMode" style="margin-right:6px">Fiche longue`;
      const wrap = document.createElement('div'); wrap.id='longSheetWrap'; wrap.style.marginTop='8px';
      sheetRoot.innerHTML=''; const row = document.createElement('div'); row.className='chat-input-area'; row.style.border='none'; row.append(sel, toggle); sheetRoot.append(row, wrap);
      function show(i){
         const t=analysis.themes[i];
         const isLong = document.getElementById('longMode').checked;
         if(isLong) wrap.innerHTML = buildLongSheetHTML(t);
         else wrap.innerHTML = `<article class="qcm-item"><h4>${htmlEscape(t.title||'')}</h4><p>${htmlEscape(t.summaryLong||t.summaryShort||'')}</p></article>`;
      }
      sel.onchange = ()=> show(Number(sel.value));
      sheetRoot.addEventListener('change', (e)=>{ if(e.target && e.target.id==='longMode') show(Number(sel.value)); });
      show(0);
   }
   window.RevisionFlow = {
      attach(analysis, { text='', qcm=[], lowConfidence=[], spaced=[], duration=60 } = {}){
         window.__coach_state = { text, qcm, lowConfidence, spaced, duration };
         mountLongSheetUI(analysis);
         renderFlow(analysis, window.__coach_state);
      },
      update(analysis, stateOverrides={}){
         const next = { ...(window.__coach_state||{}), ...(stateOverrides||{}) };
         window.__coach_state = next;
         renderFlow(analysis, next);
      },
      reset(){
         const stage = document.getElementById('flowStage'); if(stage) stage.innerHTML='';
      }
   };
   document.addEventListener('click', (e)=>{
      const b = e.target.closest('.tab-link'); if(!b || !b.dataset.tab) return;
      const tab = b.dataset.tab;
      document.querySelectorAll('.tab-link').forEach(x=>x.classList.toggle('active', x===b));
      document.querySelectorAll('.tab-pane').forEach(p=>p.classList.toggle('active', p.id===tab));
   });
})();

// === QCM++ & Parcours add-on (drop-in, plug-and-play) ===
(function(){
   const STOP=new Set('au aux avec ce ces dans de des du elle en et eux il je la le les leur lui ma mais me même mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous'.split(/\s+/));
   const N=s=> (s||'').toLowerCase().normalize('NFD').replace(/[^\p{L}\s]/gu,' ');
   const uniq=a=>[...new Set((a||[]).map(x=>String(x).trim()).filter(Boolean))];
   const splitS=t=>(t||'').replace(/([.!?])+/g,'$1|').split('|').map(s=>s.trim()).filter(Boolean);
   const sliceWords=(s,n)=>(s||'').split(/\s+/).slice(0,n).join(' ');
   const shuffle=a=>{const arr=[...a];for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}return arr};

   function topKeyPhrases(text,k=15){
      const w=N(text).split(/\s+/).filter(Boolean), phrases=[]; let cur=[];
      for(const x of w){ if(STOP.has(x)){ if(cur.length){phrases.push(cur);cur=[];} } else cur.push(x); }
      if(cur.length) phrases.push(cur);
      const f=new Map(), d=new Map();
      for(const ph of phrases){ const U=new Set(ph);
         for(const x of ph){ f.set(x,(f.get(x)||0)+1); d.set(x,(d.get(x)||0)+(ph.length-1)); }
         for(const x of U){ d.set(x,(d.get(x)||0)+(U.size-1)); }
      }
      const scoreW=new Map(); for(const [x,c] of f.entries()) scoreW.set(x,(d.get(x)||0)/c);
      const scored=phrases.map(ph=>({p:ph.join(' '),score:ph.reduce((s,x)=>s+(scoreW.get(x)||0),0)}));
      return uniq(scored.sort((a,b)=>b.score-a.score).map(x=>x.p)).slice(0,k);
   }
   function rankSentences(text,kws){
      const s=splitS(text), norm=s.map(N), total=s.length, idf=new Map();
      for(const k of (kws||[])){ const r=new RegExp(`\\b${k}\\b`,'i'); const c=norm.filter(x=>r.test(x)).length; idf.set(k, Math.log((1+total)/(1+c))+1); }
      return s.map((sent,i)=>({sent,score:(kws||[]).reduce((acc,k)=> acc+((norm[i].match(new RegExp(`\\b${k}\\b`,'gi'))||[]).length*(idf.get(k)||1)),0)}))
                  .sort((a,b)=>b.score-a.score).map(x=>x.sent);
   }
   function extractArticlesPro(text){
      const arts = text.match(/\b(?:art(?:\.|icle)?)\s*[A-Z]?\s*(?:L|R|D)?\s*\.?\s*\d+(?:-\d+)?\b/gi) || [];
      const nums = text.match(/\b\d{3,4}(?:-\d+)?\b/g) || [];
      return uniq([...arts.map(a=>a.replace(/\s+/g,' ').trim()), ...nums]);
   }
   function buildFactMCQPro(sentence,keywords,idx,all=[],otherKeywords=[]){
      const pool=(keywords||[]).filter(k=>new RegExp(`\\b${k}\\b`,'i').test(sentence));
      const key=(pool[0]||keywords?.[0]||'').toString(); if(!key) return null;
      const correct=sentence.replace(/\s+/g,' ').trim();
      const k2=(otherKeywords||[]).filter(k=>k!==key).slice(0,6);
      const variants=k2.map(k=>correct.replace(new RegExp(`\\b${key}\\b`,'i'), k));
      const neg=correct.replace(/\b(ne|pas|aucun|sans)\b/gi,'').replace(/\s+/g,' ');
      const short=correct.replace(/[,;:–-].*$/, '');
      const distractors=uniq([ ...variants, neg, short ]).filter(x=>x!==correct).slice(0,6);
      const options=shuffle(uniq([correct,...distractors])).slice(0,4);
      return { id:'qf'+idx, type:'fact', q:'Quelle formulation est correcte ?', options, answer: options.indexOf(correct), explain:`Source: « ${sliceWords(correct,25)}… »` };
   }
   function buildArticleMCQPro(sentence,art,idx){
      const m=String(art).match(/(L|R|D)?\.?\s*(\d+)(?:-(\d+))?/i);
      let pool=[String(art)];
      if(m){ const prefix=m[1]?(m[1].toUpperCase()+'. '):''; const n=parseInt(m[2],10); [n-2,n-1,n+1,n+2].forEach(k=>{ if(k>0) pool.push(`${prefix}${k}`); }); }
      const options=shuffle(uniq(pool)).slice(0,4);
      return { id:'qa'+idx, type:'article', q:`Quel article complète: « ${sentence} » ?`, options, answer: options.indexOf(String(art)) };
   }
   function genQCMPro(analysis, target=14){
      let idx=0, out=[];
      const themes=analysis?.themes||[];
      const sents=themes.flatMap(t=> splitS(t.raw||t.summaryLong||t.summaryShort||'').map(s=>({s,t})) ).filter(x=>x.s.length>40).slice(0,120);
      const all=sents.map(x=>x.s), allKw=uniq(themes.flatMap(t=>t.keywords||[]));
      for(const t of themes){
         const blocks=t.blocks||[];
         const def=blocks.find(b=>/définition/i.test(b.type||''))?.content;
         if(def && out.length<target){
            const opts=shuffle(uniq([def, t.summaryShort, sliceWords(t.summaryLong||'',25), sliceWords(all[0]||'',20)])).slice(0,4);
            out.push({id:'qd'+(idx++),type:'definition',q:`Quelle est la bonne définition de « ${t.title} » ?`,options:opts,answer:opts.indexOf(def),explain:`Source: ${sliceWords(def,20)}…`});
         }
         const exc=(t.blocks||[]).find(b=>/exception/i.test(b.type||''))?.content;
         if(exc && out.length<target){
            const wrong=(t.blocks||[]).filter(b=>/principe|jurisprudence/i.test(b.type||'')).map(b=>b.content);
            const opts=shuffle(uniq([exc,...wrong,sliceWords(t.summaryLong||'',20)])).slice(0,4);
            out.push({id:'qe'+(idx++),type:'exception',q:`Laquelle est une exception liée à « ${t.title} » ?`,options:opts,answer:opts.indexOf(exc)});
         }
         const juris=(t.blocks||[]).find(b=>/jurisprudence/i.test(b.type||''))?.content;
         if(juris && out.length<target){
            const opts=shuffle(uniq([juris,sliceWords(t.summaryLong||'',20),sliceWords(all[1]||'',20),sliceWords(all[2]||'',20)])).slice(0,4);
            out.push({id:'qj'+(idx++),type:'juris',q:`Quelle mention correspond à la jurisprudence clé ?`,options:opts,answer:opts.indexOf(juris)});
         }
      }
      for(const {s,t} of sents){ if(out.length>=target) break; const q=buildFactMCQPro(s,t.keywords||[],idx++,all,allKw); if(q) out.push(q); }
      const arts=uniq(themes.flatMap(t=>extractArticlesPro(t.raw||'')));
      for(const art of arts){ if(out.length>=target) break; const host=sents.find(x=>x.s.includes(art)); if(host) out.push(buildArticleMCQPro(host.s,art,idx++)); }
      return out.slice(0,target);
   }
   function renderQcmInline(root, qs){
      root.innerHTML='';
      qs.forEach(q=>{
         const div=document.createElement('div'); div.className='qcm-item';
         div.innerHTML=`<div>${q.q}</div><div class="qcm-options">${q.options.map((o,i)=>`<label data-i="i">${o}</label>`).join('')}</div><div class="feedback hidden"></div>`;
         root.appendChild(div);
         div.querySelectorAll('label').forEach(l=>l.addEventListener('click',()=>{
            if(div.dataset.done) return;
            const i=Number(l.dataset.i), fb=div.querySelector('.feedback'); div.dataset.done=1;
            if(i===q.answer){ fb.className='feedback correct'; fb.textContent='✔️ Correct'; }
            else { fb.className='feedback incorrect'; fb.textContent='❌ Incorrect'; q.due=Date.now()+24*60*60*1000; }
            fb.classList.remove('hidden');
         }));
      });
   }
   function countdown(ms, container){
      const el=document.createElement('div'); el.style.opacity='.7'; el.style.fontFamily='monospace'; container.appendChild(el);
      const tick=()=>{ if(ms<=0){ el.textContent='⏱️ temps écoulé'; return; } el.textContent=`⏱️ ${Math.ceil(ms/60000)} min restantes`; ms-=30000; setTimeout(tick,30000); };
      tick(); return ()=> el.remove();
   }
   function buildSessionPlan(analysis, durationMin=60, lowConfidence=new Set(), spaced=[]){
      const themes=analysis.themes||[];
      const score=t=> (lowConfidence.has(t.title)?2:0) + Math.min(3, spaced.filter(q => ((q.due||0)<=Date.now()) && (((q.explain||'').toLowerCase().includes((t.title||'').toLowerCase()))||((q.q||'').toLowerCase().includes((t.title||'').toLowerCase())))).length);
      const order=themes.map((t,i)=>({i,sc:score(t)})).sort((a,b)=>b.sc-a.sc).map(x=>x.i);
      const pick=order.slice(0, Math.max(2, Math.floor(durationMin/20)));
      const perTheme=Math.max(6, Math.floor(durationMin/(3*Math.max(2,pick.length||1))));
      const steps=[{type:'diagnostic',size:5}];
      for(const i of pick){ steps.push({type:'learn',theme:i,minutes:perTheme}); steps.push({type:'practice',theme:i,size:4}); steps.push({type:'recall',theme:i,prompts:3}); }
      steps.push({type:'test',size:8});
      return steps;
   }
   function renderStepLabel(analysis,s){
      const t=i=> (analysis.themes[i]?.title||'').replace(/</g,'&lt;');
      if(s.type==='diagnostic') return `<li>Diagnostic (QCM ×${s.size})</li>`;
      if(s.type==='learn') return `<li>Apprentissage – ${t(s.theme)} (${s.minutes} min)</li>`;
      if(s.type==='practice') return `<li>Pratique QCM – ${t(s.theme)} (×${s.size})</li>`;
      if(s.type==='recall') return `<li>Rappel actif – ${t(s.theme)} (3 réponses ouvertes)</li>`;
      if(s.type==='test') return `<li>Test final (×${s.size})</li>`; return `<li>${s.type}</li>`;
   }
   function startFlow(analysis,{duration=60,lowConfidence=new Set(),spaced=[]}={}){
      const host=document.getElementById('flow-output'); if(!host) return;
      const steps=buildSessionPlan(analysis,duration,lowConfidence,spaced);
      host.innerHTML=`<ol class="plan">${steps.map(s=>renderStepLabel(analysis,s)).join('')}</ol><button id="startFlow" class="btn primary">Démarrer</button><div id="flowStage" style="margin-top:10px"></div>`;
      document.getElementById('startFlow').onclick=()=>{
         let i=0; const stage=document.getElementById('flowStage');
         function doStep(){
            if(i>=steps.length){ stage.innerHTML='<div class="qcm-item" style="border-left:4px solid var(--success-color)">Session terminée 🎉</div>'; return; }
            stage.innerHTML=''; const s=steps[i]; let stop=()=>{}; if(s.minutes){ stop=countdown(s.minutes*60*1000,stage); }
            if(s.type==='learn'){
               const t=analysis.themes[s.theme]; stage.innerHTML=`<div class="qcm-item"><h3>${t.title||''}</h3><p>${(t.summaryLong||t.summaryShort||'').replace(/</g,'&lt;')}</p></div>`;
               const nxt=document.createElement('button'); nxt.className='btn'; nxt.textContent='Suivant'; nxt.onclick=()=>{stop();i++;doStep();}; stage.appendChild(nxt);
            }else if(s.type==='practice'){
               const qs=genQCMPro({themes:[analysis.themes[s.theme]]}, s.size); const box=document.createElement('div'); stage.appendChild(box); renderQcmInline(box, qs);
               const gate=document.createElement('div'); gate.className='qcm-item'; stage.appendChild(gate);
               const btn=document.createElement('button'); btn.className='btn'; btn.textContent='Valider étape'; btn.disabled=true; stage.appendChild(btn);
               const refresh=()=>{ const done=[...box.querySelectorAll('.qcm-item')].filter(x=>x.dataset.done).length; gate.textContent=`Progression: ${done}/${qs.length}`; btn.disabled=done<qs.length; };
               const mo=new MutationObserver(refresh); mo.observe(box,{subtree:true,attributes:true,attributeFilter:['data-done']}); refresh();
               btn.onclick=()=>{mo.disconnect();stop();i++;doStep();};
            }else if(s.type==='recall'){
               const t=analysis.themes[s.theme];
               stage.innerHTML=`<div class="qcm-item"><h3>Rappel actif – ${t.title||''}</h3>
                  <p><b>Définition :</b><br><textarea placeholder="Votre réponse..."></textarea></p>
                  <p><b>Exception :</b><br><textarea placeholder="Votre réponse..."></textarea></p>
                  <p><b>Cas pratique bref :</b><br><textarea placeholder="Votre réponse..."></textarea></p></div>`;
               const nxt=document.createElement('button'); nxt.className='btn'; nxt.textContent='Suivant'; nxt.onclick=()=>{stop();i++;doStep();}; stage.appendChild(nxt);
            }else{ // diagnostic / test
               const qs=genQCMPro(analysis, s.size); const box=document.createElement('div'); stage.appendChild(box); renderQcmInline(box, qs);
               const gate=document.createElement('div'); gate.className='qcm-item'; stage.appendChild(gate);
               const btn=document.createElement('button'); btn.className='btn'; btn.textContent='Valider étape'; btn.disabled=true; stage.appendChild(btn);
               const refresh=()=>{ const done=[...box.querySelectorAll('.qcm-item')].filter(x=>x.dataset.done).length; gate.textContent=`Progression: ${done}/${qs.length}`; btn.disabled=done<qs.length; };
               const mo=new MutationObserver(refresh); mo.observe(box,{subtree:true,attributes:true,attributeFilter:['data-done']}); refresh();
               btn.onclick=()=>{mo.disconnect();stop();i++;doStep();};
            }
         }
         doStep();
      };
   }
   window.QcmUpgrade={ generate: genQCMPro };
   window.RevisionFlow = Object.assign(window.RevisionFlow||{}, { start: startFlow });
})();