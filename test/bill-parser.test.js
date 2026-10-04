import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBillText } from '../src/bill-parser.js';

test('invoice maps slash names, Pcs quantity and Rate, excludes packing and totals', () => {
  const text = `Name of Product/Services HSN SAC UOM Pcs Mtr Rate Amount
1 GOLDEN ZOYA/MISHRI. 540752 Pcs 6 416.00 2496.00 0.00 0.00
2 DEV SHREE/MISHRI. 540752 Pcs 6 431.00 2586.00
3 BANSURI/JAY BHARAT 540752 Pcs 4 213.00 852.00
4 SUPER FAST/RAJLAXMI 540752 Pcs 4 0.00 231.00 924.00
6 CALCIUM/211VSC 540752 Pcs 4 914.00 3656.00
7 PAVITRA/211VSC 540752 Pcs 6 1144.00 6864.00
8 JALSA/28 VSC 540752 Pcs 6 491.00 2946.00
9 AARUSHI/MISHRI. 540752 Pcs 6 660.00 3960.00
10 FLORA/ANMOL 540752 Pcs 5 527.00 2635.00
11 HAWALA/SVS. 540752 Pcs 6 432.00 2592.00
12 DAMINI/127 VSC 540752 Pcs 6 1092.00 6552.00
13 KRANTI/502 VSC 540752 Pcs 6 439.00 2634.00
14 SAAS BAHU/MISHRI. 540752 Pcs 6 455.00 2730.00
15 RAS VATIKA/MISHRI. 540752 Pcs 8 405.00 3240.00
16 PACKING/PACKING 998540 Pcs 2 130.00 260.00
Total 87 48599.00
CGST 2.5 100.00`;
  const items = parseBillText(text, 'Fallback');
  assert.equal(items.length, 14);
  assert.deepEqual(items[0], { companyName: 'MISHRI', sariName: 'GOLDEN ZOYA', quantity: 6, price: 416 });
  assert.deepEqual(items[2], { companyName: 'JAY BHARAT', sariName: 'BANSURI', quantity: 4, price: 213 });
  assert.equal(items[3].price, 231);
  assert.equal(items.at(-1).quantity, 8);
});
test('table separators, comma prices, and numeric company prefixes survive', () => {
  assert.deepEqual(parseBillText('12 | DAMINI/127 VSC | 540752 | Pcs | 6 | 1,092.00 | 6,552.00'), [{ companyName: '127 VSC', sariName: 'DAMINI', quantity: 6, price: 1092 }]);
});
test('uncertain OCR numbers are not guessed', () => {
  assert.deepEqual(parseBillText(`1 A/B 540752 Pcs B 416.00 2496.00
2 C/D 540752 Pcs 6 41600 249600
4 G 540752 Pcs 6 416.00 2496.00`), []);
});
test('legacy simple rows preserve pre-tax rates and split names when available', () => {
  assert.deepEqual(parseBillText('Silk/Company | 2 | 450.50 | 901.00'), [{ companyName: 'Company', sariName: 'Silk', quantity: 2, price: 450.5 }]);
});

test('printed Rate wins when the amount differs', () => {
  const [item] = parseBillText('3 E/F 540752 Pcs 4 231.00 524.00');
  assert.equal(item.price, 231);
});
