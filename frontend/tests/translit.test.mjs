// D-118: Marathi ⇄ English names — suggestions, the centre's learned spellings, comparing the bank's name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { toMarathi, toEnglish, namesMatch, learnPairs, marathiChoices } = await import('../public/src/lib/translit.js');
const { api } = await import('../public/src/api/mock.js');

test('English → Marathi', () => {
  assert.equal(toMarathi('Ramchandra Patil'), 'रामचंद्र पाटील');
  assert.equal(toMarathi('sunita jadhav'), 'सुनीता जाधव');
  assert.equal(toMarathi('Sanjay Shinde'), 'संजय शिंदे');
  assert.equal(toMarathi('Ravi Kumbhar'), 'रवी कुंभार', 'rules for words not in the list');
  assert.equal(toMarathi('Ramu Xyz', { ramu: 'रामू' }), 'रामू क्ष्य्झ', 'learned words win');
});
test('Marathi → English', () => {
  assert.equal(toEnglish('विठ्ठल माने'), 'Vitthal Mane');
  assert.equal(toEnglish('लक्ष्मी साळुंखे'), 'Laxmi Salunkhe');
  assert.equal(toEnglish('रोहित जामदाडे'), 'Rohit Jamdade', 'rules for words not in the list');
  assert.equal(toEnglish('सुरेखा नलवडे'), 'Surekha Nalawade');
});
test("bank's name vs ours", () => {
  assert.equal(namesMatch('SHRI VITTHAL MANE', 'Vitthal Mane'), 'match');
  assert.equal(namesMatch('SMT SALUNKHE LAXMI', 'Lakshmi Salunkhe'), 'match', 'Laxmi = Lakshmi, title ignored');
  assert.equal(namesMatch('VITTHAL PATIL', 'Vitthal Mane'), 'partial');
  assert.equal(namesMatch('VITHAL MANE', 'Vitthal Mane'), 'match', 'spelling variations');
  assert.equal(namesMatch('SANGITA MORE', 'Sunita Jadhav'), 'no');
});
test('learning: a corrected spelling is used for the next farmer', async () => {
  assert.deepEqual(learnPairs('आकाश लांडगे', 'Akash Landge'), [['landge', 'लांडगे']]);
  await api.login('u-owner', '1234');
  const code = await api.nextFarmerCode();
  const f = await api.saveFarmer({ code, name: 'आकाश लांडगे', nameEn: 'Akash Landge', village: 'आरग', milkTypes: ['cow'], aadhaar: '512345678911' });
  assert.equal(f.nameEn, 'Akash Landge');
  assert.equal((await api.nameWords()).landge, 'लांडगे');
  assert.equal(toMarathi('Sunil Landge', await api.nameWords()), 'सुनील लांडगे');
  // existing farmers got an English name, marked "to check"
  const old = (await api.farmers()).find((x) => x.code === 103);
  assert.equal(old.nameEn, 'Vitthal Mane'); assert.equal(old.nameEnAuto, true);
});

test('spelling variations use the known name (D-120)', () => {
  assert.equal(toMarathi('prashant chouwgule'), 'प्रशांत चौगुले');
  assert.equal(toMarathi('Chowgule'), 'चौगुले');
  assert.equal(toMarathi('Ganesh Jadav'), 'गणेश जाधव');
  assert.equal(toMarathi('Gourav'), 'गौरव');
  assert.equal(toMarathi('Ravi'), 'रवी'); // short names: no guessing
  const c = marathiChoices('Prashant Chouwgule');
  assert.equal(c[1].options[0], 'चौगुले'); assert.ok(c[1].options.length > 1);
});
