// Marathi ⇄ English names (D-118). Offline, no outside service: a word list of common Marathi names / surnames /
// villages, the centre's own corrections (learned when a farmer is saved), and phonetic rules for everything else.
//   toMarathi('Ramchandra Patil') → 'रामचंद्र पाटील'      toEnglish('विठ्ठल माने') → 'Vitthal Mane'
//   namesMatch('SHRI VITTHAL MANE', 'Vitthal Mane') → 'match'   (₹1 UPI / bank check: bank names are in English)
// English → Marathi is a SUGGESTION (English spelling of names is loose); the person entering can correct it.

const WORDS = [
  // first names (men)
  ['ramchandra', 'रामचंद्र'], ['vitthal', 'विठ्ठल'], ['vithal', 'विठ्ठल'], ['dattatray', 'दत्तात्रय'], ['dattatraya', 'दत्तात्रय'], ['ganpat', 'गणपत'],
  ['balasaheb', 'बाळासाहेब'], ['tukaram', 'तुकाराम'], ['ganesh', 'गणेश'], ['sanjay', 'संजय'], ['prakash', 'प्रकाश'], ['suresh', 'सुरेश'], ['ramesh', 'रमेश'],
  ['mahesh', 'महेश'], ['dinesh', 'दिनेश'], ['santosh', 'संतोष'], ['sachin', 'सचिन'], ['rahul', 'राहुल'], ['amol', 'अमोल'], ['vijay', 'विजय'], ['ajay', 'अजय'],
  ['anil', 'अनिल'], ['sunil', 'सुनील'], ['raju', 'राजू'], ['raj', 'राज'], ['shivaji', 'शिवाजी'], ['sambhaji', 'संभाजी'], ['pandurang', 'पांडुरंग'],
  ['dnyaneshwar', 'ज्ञानेश्वर'], ['namdev', 'नामदेव'], ['maruti', 'मारुती'], ['hanmant', 'हणमंत'], ['hanumant', 'हणमंत'], ['bhimrao', 'भीमराव'],
  ['shankar', 'शंकर'], ['vishnu', 'विष्णू'], ['rajendra', 'राजेंद्र'], ['nitin', 'नितीन'], ['kiran', 'किरण'], ['datta', 'दत्ता'], ['baban', 'बबन'],
  ['nana', 'नाना'], ['bapu', 'बापू'], ['appa', 'आप्पा'], ['anna', 'अण्णा'], ['bhau', 'भाऊ'], ['kashinath', 'काशीनाथ'], ['dhondiba', 'धोंडिबा'],
  ['govind', 'गोविंद'], ['krishna', 'कृष्णा'], ['lakshman', 'लक्ष्मण'], ['laxman', 'लक्ष्मण'], ['mohan', 'मोहन'], ['sopan', 'सोपान'], ['yashwant', 'यशवंत'],
  ['uttam', 'उत्तम'], ['ashok', 'अशोक'], ['arun', 'अरुण'], ['balu', 'बाळू'], ['bharat', 'भरत'], ['deepak', 'दीपक'], ['dipak', 'दीपक'], ['popat', 'पोपट'],
  ['sitaram', 'सीताराम'], ['siddharth', 'सिद्धार्थ'], ['ravindra', 'रवींद्र'], ['shrikant', 'श्रीकांत'], ['sudhakar', 'सुधाकर'], ['dilip', 'दिलीप'],
  ['vilas', 'विलास'], ['vikas', 'विकास'], ['vinod', 'विनोद'], ['subhash', 'सुभाष'], ['sharad', 'शरद'], ['shivaram', 'शिवराम'], ['raghunath', 'रघुनाथ'],
  ['annasaheb', 'अण्णासाहेब'], ['dadasaheb', 'दादासाहेब'], ['bhausaheb', 'भाऊसाहेब'], ['rao', 'राव'], ['saheb', 'साहेब'], ['abhijit', 'अभिजीत'],
  ['niranjan', 'निरंजन'], ['ram', 'राम'], ['shyam', 'श्याम'], ['hari', 'हरी'], ['mahadev', 'महादेव'], ['pundlik', 'पुंडलिक'], ['narayan', 'नारायण'],
  // first names (women)
  ['sunita', 'सुनीता'], ['shantabai', 'शांताबाई'], ['meera', 'मीरा'], ['mira', 'मीरा'], ['anita', 'अनिता'], ['sangita', 'संगीता'], ['sangeeta', 'संगीता'],
  ['laxmi', 'लक्ष्मी'], ['lakshmi', 'लक्ष्मी'], ['jayshree', 'जयश्री'], ['savita', 'सविता'], ['sunanda', 'सुनंदा'], ['suman', 'सुमन'], ['usha', 'उषा'],
  ['asha', 'आशा'], ['vandana', 'वंदना'], ['rekha', 'रेखा'], ['mangal', 'मंगल'], ['lata', 'लता'], ['sarita', 'सरिता'], ['kavita', 'कविता'], ['manisha', 'मनीषा'],
  ['pooja', 'पूजा'], ['puja', 'पूजा'], ['priya', 'प्रिया'], ['rupali', 'रूपाली'], ['shobha', 'शोभा'], ['kalpana', 'कल्पना'], ['parvati', 'पार्वती'],
  ['kamal', 'कमल'], ['hirabai', 'हिराबाई'], ['sakhubai', 'सखुबाई'], ['indubai', 'इंदुबाई'], ['tarabai', 'ताराबाई'], ['kusum', 'कुसुम'], ['bai', 'बाई'],
  ['sindhu', 'सिंधू'], ['shalan', 'शालन'], ['sushila', 'सुशीला'], ['nanda', 'नंदा'], ['sujata', 'सुजाता'], ['vaishali', 'वैशाली'], ['jyoti', 'ज्योती'],
  // surnames
  ['patil', 'पाटील'], ['jadhav', 'जाधव'], ['pawar', 'पवार'], ['shinde', 'शिंदे'], ['more', 'मोरे'], ['kamble', 'कांबळे'], ['gaikwad', 'गायकवाड'],
  ['chavan', 'चव्हाण'], ['desai', 'देसाई'], ['kulkarni', 'कुलकर्णी'], ['mane', 'माने'], ['salunkhe', 'साळुंखे'], ['salunke', 'साळुंखे'],
  ['deshmukh', 'देशमुख'], ['bhosale', 'भोसले'], ['bhosle', 'भोसले'], ['kadam', 'कदम'], ['sawant', 'सावंत'], ['kale', 'काळे'], ['jagtap', 'जगताप'],
  ['mohite', 'मोहिते'], ['nikam', 'निकम'], ['mali', 'माळी'], ['kumbhar', 'कुंभार'], ['sutar', 'सुतार'], ['lohar', 'लोहार'], ['gavade', 'गावडे'],
  ['shelke', 'शेळके'], ['thorat', 'थोरात'], ['shirke', 'शिर्के'], ['ghorpade', 'घोरपडे'], ['mhaske', 'म्हस्के'], ['waghmare', 'वाघमारे'],
  ['sathe', 'साठे'], ['kharat', 'खरात'], ['bansode', 'बनसोडे'], ['gurav', 'गुरव'], ['dhole', 'ढोले'], ['lokhande', 'लोखंडे'],
  ['suryawanshi', 'सूर्यवंशी'], ['pujari', 'पुजारी'], ['mulla', 'मुल्ला'], ['shaikh', 'शेख'], ['inamdar', 'इनामदार'], ['joshi', 'जोशी'],
  ['deshpande', 'देशपांडे'], ['bhagwat', 'भागवत'], ['mhetre', 'म्हेत्रे'], ['khot', 'खोत'], ['chougule', 'चौगुले'], ['magdum', 'मगदूम'],
  ['upadhye', 'उपाध्ये'], ['kore', 'कोरे'], ['bhandare', 'भंडारे'], ['kshirsagar', 'क्षीरसागर'], ['bokare', 'बोकारे'], ['yadav', 'यादव'],
  ['koli', 'कोळी'], ['naik', 'नाईक'], ['nayak', 'नाईक'], ['gore', 'गोरे'], ['phadtare', 'फडतरे'], ['kokate', 'कोकाटे'], ['dange', 'डांगे'],
  // villages near Arag
  ['arag', 'आरग'], ['bedag', 'बेडग'], ['lingnur', 'लिंगनूर'], ['mhaisal', 'म्हैसाळ'], ['miraj', 'मिरज'], ['sangli', 'सांगली'], ['belanki', 'बेळंकी'],
  ['malgaon', 'मालगाव'], ['erandoli', 'एरंडोली'], ['shindewadi', 'शिंदेवाडी'], ['khanderajuri', 'खंडेराजुरी'], ['kolhapur', 'कोल्हापूर'],
  // more common names / surnames
  ['akash', 'आकाश'], ['tanaji', 'तानाजी'], ['omkar', 'ओंकार'], ['prashant', 'प्रशांत'], ['pravin', 'प्रवीण'], ['praveen', 'प्रवीण'], ['rohit', 'रोहित'],
  ['sneha', 'स्नेहा'], ['swati', 'स्वाती'], ['sudhir', 'सुधीर'], ['pramod', 'प्रमोद'], ['vishwas', 'विश्वास'], ['surekha', 'सुरेखा'], ['amar', 'अमर'],
  ['sagar', 'सागर'], ['nilesh', 'निलेश'], ['yogesh', 'योगेश'], ['tushar', 'तुषार'], ['vaibhav', 'वैभव'], ['pratik', 'प्रतीक'], ['swapnil', 'स्वप्नील'],
  ['aniket', 'अनिकेत'], ['abhishek', 'अभिषेक'], ['akshay', 'अक्षय'], ['ganpati', 'गणपती'], ['malhari', 'मल्हारी'], ['bhagwan', 'भगवान'], ['eknath', 'एकनाथ'],
  ['haribhau', 'हरिभाऊ'], ['kisan', 'किसन'], ['babasaheb', 'बाबासाहेब'], ['shital', 'शीतल'], ['sheetal', 'शीतल'], ['archana', 'अर्चना'], ['ashwini', 'अश्विनी'],
  ['prajakta', 'प्राजक्ता'], ['rani', 'राणी'], ['radha', 'राधा'], ['sarnaik', 'सरनाईक'], ['lad', 'लाड'], ['jamdade', 'जामदाडे'], ['nalawade', 'नलवडे'],
  ['nalvade', 'नलवडे'], ['godse', 'गोडसे'], ['godase', 'गोडसे'], ['hajare', 'हजारे'], ['tavare', 'तावरे'], ['taware', 'तावरे'], ['yewale', 'येवले'],
  ['mohire', 'मोहिरे'], ['bagal', 'बागल'], ['jagdale', 'जगदाळे'], ['kharade', 'खराडे'], ['mane-deshmukh', 'माने-देशमुख'], ['shete', 'शेटे'], ['pol', 'पोळ'],
  // titles
  ['shri', 'श्री'], ['shree', 'श्री'], ['smt', 'श्रीमती'], ['sou', 'सौ'],
];
const EN2MR = new Map(WORDS);
const MR2EN = new Map(); for (const [en, mr] of WORDS) if (!MR2EN.has(mr)) MR2EN.set(mr, en);

// ---------------------------------------------------------------- English → Marathi (phonetic rules)
const CONS = [['ksh', 'क्ष'], ['dny', 'ज्ञ'], ['chh', 'छ'], ['ch', 'च'], ['kh', 'ख'], ['gh', 'घ'], ['jh', 'झ'], ['th', 'थ'], ['dh', 'ध'], ['ph', 'फ'], ['bh', 'भ'],
  ['sh', 'श'], ['k', 'क'], ['g', 'ग'], ['c', 'क'], ['j', 'ज'], ['z', 'झ'], ['t', 'त'], ['d', 'द'], ['n', 'न'], ['p', 'प'], ['f', 'फ'], ['b', 'ब'], ['m', 'म'],
  ['y', 'य'], ['r', 'र'], ['l', 'ल'], ['v', 'व'], ['w', 'व'], ['s', 'स'], ['h', 'ह'], ['x', 'क्ष'], ['q', 'क']];
const VOW = [['aa', 'आ', 'ा'], ['ai', 'ऐ', 'ै'], ['au', 'औ', 'ौ'], ['ou', 'औ', 'ौ'], ['ee', 'ई', 'ी'], ['oo', 'ऊ', 'ू'], ['a', 'अ', ''], ['i', 'इ', 'ि'], ['u', 'उ', 'ु'], ['e', 'ए', 'े'], ['o', 'ओ', 'ो']];
const HAL = '्';
const NASAL_BEFORE = /^(k|kh|g|gh|ch|j|t|th|d|dh|p|b|bh)/;

function wordToMarathi(w) {
  let out = ''; let i = 0; let pendingCons = false; // last thing written was a consonant without its vowel yet
  while (i < w.length) {
    const rest = w.slice(i);
    // anusvara: n / m before a consonant in the middle of a word → ं (Sanjay → संजय, Chandra → चंद्र)
    if (pendingCons === false && i > 0 && (rest[0] === 'n' || rest[0] === 'm') && rest.length > 1 && NASAL_BEFORE.test(rest.slice(1)) && !/[aeiou]/.test(rest[1])) {
      out += 'ं'; i += 1; continue;
    }
    // D-120: 'ow' + consonant (or end) is the औ sound: Chowgule → चौगुले, Gowda; 'ow' + vowel stays ओ + व (Powar → पोवार)
    if (rest.startsWith('ow') && (rest.length === 2 || !/[aeiouy]/.test(rest[2]))) {
      out += pendingCons ? 'ौ' : 'औ'; pendingCons = false; i += 2; continue;
    }
    const v = VOW.find(([r]) => rest.startsWith(r));
    if (v) {
      const [r, ind, mat] = v; const atEnd = i + r.length === w.length;
      if (pendingCons) {
        if (r === 'a') out += atEnd && w.length > 2 ? 'ा' : ''; // final a is long in names (Sunita → सुनीता)
        else if (r === 'i' && atEnd) out += 'ी'; // final i is long (Laxmi → लक्ष्मी)
        else out += mat;
      } else out += r === 'i' && atEnd ? 'ई' : ind;
      pendingCons = false; i += r.length; continue;
    }
    const c = CONS.find(([r]) => rest.startsWith(r));
    if (c) {
      if (pendingCons) out += HAL; // two consonants together → join them
      out += c[1]; pendingCons = true; i += c[0].length;
      if (rest.startsWith(c[0] + c[0])) { /* doubled letter (tt, ll) handled as two consonants */ }
      continue;
    }
    if (pendingCons) pendingCons = false;
    out += rest[0]; i += 1;
  }
  return out;
}

/** English (Latin) name → Marathi suggestion. `learned` = { english word: marathi word } from the centre's corrections. */
/** Loose form of an English spelling, so variations of one name compare equal (Chouwgule ~ Chougule, Jadav ~ Jadhav). */
const loose = (w) => w.toLowerCase().replace(/[^a-z]/g, '').replace(/ou|ow|au/g, 'o').replace(/ee|ii/g, 'i').replace(/oo|uu/g, 'u').replace(/aa/g, 'a')
  .replace(/w/g, 'v').replace(/ph/g, 'f').replace(/([bcdgjkpt])h/g, '$1').replace(/sh/g, 's').replace(/x/g, 'ks').replace(/z/g, 'j').replace(/y$/g, 'i').replace(/(.)\1+/g, '$1');
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
let LOOSE = null; // loose spelling → [english key, marathi]
function looseIndex(learned) {
  if (!LOOSE) { LOOSE = new Map(); for (const [en, mr] of WORDS) if (!LOOSE.has(loose(en))) LOOSE.set(loose(en), [en, mr]); }
  const extra = Object.entries(learned || {}).map(([en, mr]) => [loose(en), [en, mr]]);
  return extra.length ? new Map([...LOOSE, ...extra]) : LOOSE;
}
/** Known names close to this spelling, nearest first: [{ mr, en, d }] (d = how many letters differ). */
function nearNames(word, learned) {
  const w = loose(word); if (w.length < 3) return [];
  const max = w.length >= 9 ? 2 : w.length >= 6 ? 1 : 0; // short names (Ravi / Rani) only match when spelt the same way
  const out = [];
  for (const [k, [en, mr]] of looseIndex(learned)) { const d = k === w ? 0 : editDistance(w, k); if (d <= max) out.push({ mr, en, d }); }
  return out.sort((a, b) => a.d - b.d || a.en.length - b.en.length);
}
function wordOptions(word, learned = {}) {
  const k = word.toLowerCase();
  const exact = learned[k] || EN2MR.get(k);
  const opts = [];
  if (exact) opts.push(exact);
  for (const n of nearNames(k, learned)) if (!opts.includes(n.mr)) opts.push(n.mr);
  const rule = wordToMarathi(k);
  if (!opts.includes(rule)) opts.push(rule);
  return opts.slice(0, 3);
}
/** English (Latin) name → Marathi suggestion. `learned` = { english word: marathi word } from the centre's corrections. */
export function toMarathi(text, learned = {}) {
  return String(text || '').replace(/[A-Za-z]+/g, (word) => wordOptions(word, learned)[0]).replace(/\s+/g, ' ');
}
/**
 * For the form: each English word with its Marathi choices, best first, e.g.
 * marathiChoices('Prashant Chouwgule') → [{ en: 'Prashant', options: ['प्रशांत'] }, { en: 'Chouwgule', options: ['चौगुले', 'चौव्गुले'] }]
 */
export function marathiChoices(text, learned = {}) {
  return (String(text || '').match(/[A-Za-z]+/g) || []).map((w) => ({ en: w, options: wordOptions(w, learned), known: !!(learned[w.toLowerCase()] || EN2MR.get(w.toLowerCase())) }));
}

// ---------------------------------------------------------------- Marathi → English
const C2L = { 'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n', 'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n', 'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh', 'ष': 'sh',
  'स': 's', 'ह': 'h', 'ळ': 'l', 'क़': 'q', 'ज़': 'z', 'फ़': 'f' };
const V2L = { 'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u', 'ऋ': 'ru', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ॲ': 'a', 'ऑ': 'o' };
const M2L = { 'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ru', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॅ': 'a', 'ॉ': 'o' };

function wordToEnglish(w) {
  if (MR2EN.has(w)) return MR2EN.get(w);
  // syllables: consonant (+ halant) / consonant + vowel sign / independent vowel
  const sy = []; const ch = [...w];
  for (let i = 0; i < ch.length; i++) {
    const x = ch[i];
    if (C2L[x] !== undefined) {
      const next = ch[i + 1];
      if (next === '्') { sy.push({ c: C2L[x], v: '' , half: true }); i++; }
      else if (M2L[next] !== undefined) { sy.push({ c: C2L[x], v: M2L[next] }); i++; }
      else sy.push({ c: C2L[x], v: 'a', inherent: true });
    } else if (V2L[x] !== undefined) sy.push({ c: '', v: V2L[x] });
    else if (x === 'ं' || x === 'ँ') sy.push({ c: 'n', v: '', nasal: true });
    else if (x === 'ः') sy.push({ c: 'h', v: '' });
  }
  // schwa deletion: drop the inherent 'a' at the end of a word, and in V C(a) C V (Ramchandra, Sangita stays)
  for (let i = 0; i < sy.length; i++) {
    const s = sy[i]; if (!s.inherent) continue;
    const last = i === sy.length - 1;
    const prevV = i > 0 && sy[i - 1].v && !sy[i - 1].half;
    const next = sy[i + 1]; const nextHasV = next && next.c && next.v && !next.half && !(i + 2 === sy.length && next.inherent);
    if ((last && sy.length > 1) || (prevV && nextHasV && i > 0 && i < sy.length - 2)) s.v = '';
  }
  let out = sy.map((s, i) => (s.nasal && /^[pbm]/.test(sy[i + 1]?.c || '') ? 'm' : s.c) + s.v).join('');
  out = out.replace(/kshm/g, 'xm').replace(/^ksh/, 'x').replace(/ksh/g, 'x'); // लक्ष्मी → laxmi
  return out;
}

const cap = (w) => (w ? w[0].toUpperCase() + w.slice(1) : w);
/** Marathi name → English (Latin), each word capitalised. `learned` = { marathi word: english word }. */
export function toEnglish(text, learned = {}) {
  return String(text || '').replace(/[ऀ-ॿ]+/g, (word) => cap(learned[word] || wordToEnglish(word))).replace(/\s+/g, ' ').trim();
}

export const hasLatin = (s) => /[A-Za-z]/.test(String(s || ''));
export const hasDevanagari = (s) => /[ऀ-ॿ]/.test(String(s || ''));

// ---------------------------------------------------------------- comparing a bank's name with ours
const TITLES = new Set(['SHRI', 'SHREE', 'SRI', 'SMT', 'SOU', 'MR', 'MRS', 'MS', 'MISS', 'KUMARI', 'KU', 'DR']);
const fold = (w) => w.toUpperCase().replace(/[^A-Z]/g, '').replace(/AA/g, 'A').replace(/EE|II|Y$/g, 'I').replace(/OO|UU/g, 'U').replace(/W/g, 'V')
  .replace(/TH/g, 'T').replace(/DH/g, 'D').replace(/PH/g, 'F').replace(/SH/g, 'S').replace(/X/g, 'KS').replace(/(.)\1+/g, '$1').replace(/H/g, '');
const tokens = (s) => String(s || '').toUpperCase().split(/[^A-Z]+/).filter((w) => w && !TITLES.has(w)).map(fold).filter(Boolean);
/** 'match' (every word of our name is in the bank's name), 'partial' (some words) or 'no'. */
export function namesMatch(bankName, ourName) {
  const a = new Set(tokens(bankName)); const b = tokens(ourName);
  if (!a.size || !b.length) return 'no';
  const hit = b.filter((w) => a.has(w)).length;
  return hit === b.length ? 'match' : hit ? 'partial' : 'no';
}

/** Word-by-word corrections to remember when a farmer is saved with both names (same number of words). */
export function learnPairs(nameMr, nameEn) {
  const m = String(nameMr || '').trim().split(/\s+/); const e = String(nameEn || '').trim().split(/\s+/);
  if (!m[0] || m.length !== e.length || !hasDevanagari(nameMr) || !hasLatin(nameEn)) return [];
  return m.map((mr, i) => [e[i].toLowerCase(), mr]).filter(([en, mr]) => /^[a-z]+$/.test(en) && hasDevanagari(mr) && (EN2MR.get(en) || wordToMarathi(en)) !== mr);
}
