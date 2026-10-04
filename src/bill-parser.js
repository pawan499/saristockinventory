// Prices here are the printed, pre-GST Rate per piece. The review screen adds
// 5% GST exactly once when confirming stock. Never use Amount as unit price.
export function parseBillText(text, companyName = '') {
  const items = [];
  for (const line of text.split(/\r?\n/)) {
    if (/\b(total|subtotal|gst|cgst|sgst|igst|tax|discount|invoice|date|qty|quantity|amount|packing|freight)\b/i.test(line)) continue;
    const normalized = line.trim().replace(/(?:₹|Rs\.?|INR)\s*/gi, '').replace(/(\d),(?=\d{3}\b)/g, '$1');
    // Invoice columns: product/company, HSN, UOM, Pcs, optional Mtr, Rate, Amount.
    const table = normalized.replace(/[|¦\[\]{}()]/g, ' ').match(/^\s*\d*[.)]?\s*(.+?)\s+\d{6,8}\s+Pcs\s+(\d+)\s+(.+)$/i);
    if (table) {
      const name = table[1].replace(/^[\s[\]{}]+/, '').trim();
      const slash = name.indexOf('/');
      if (slash < 1) continue; // Do not invent a company from the invoice header.
      const sariName = name.slice(0, slash).trim();
      const rowCompany = name.slice(slash + 1).trim().replace(/[.,]+$/, '');
      const values = table[3].trim().split(/\s+/);
      const quantity = Number(table[2]);
      // A blank Mtr cell disappears in OCR; a populated Mtr cell remains.
      let price;
      for (const offset of [0, 1]) {
        const [rate, amount] = values.slice(offset, offset + 2);
        if (!/^\d+\.\d{2}$/.test(rate || '') || !/^\d+\.\d{2}$/.test(amount || '')) continue;
        if (offset === 1 && !/^\d+(?:\.\d{1,2})?$/.test(values[0])) continue;
        if (quantity > 0 && Math.abs(Number(rate) * quantity - Number(amount)) <= 0.05) {
          price = Number(rate);
          break;
        }
      }
      // Amount may include discounts or OCR errors. The printed Rate remains
      // authoritative when it is readable; never replace it with Amount / Pcs.
      if (price === undefined && /^\d+\.\d{2}$/.test(values[0] || '')) {
        price = Number(values[0]);
      }
      if (price === undefined || !rowCompany || !/[a-z\u0900-\u097f]/i.test(sariName)) continue;
      items.push({ companyName: rowCompany, sariName, quantity, price });
      continue;
    }
    // Older simple bills remain supported, but damaged invoice rows must not
    // fall back to interpreting HSN/Pcs/Amount as a price.
    if (/\bpcs\b|\b\d{6,8}\b/i.test(normalized)) continue;
    const match = normalized.match(/^(.+?)\s*(?:\||\s{2,})\s*(\d+)\s*(?:\||\s+)\s*(\d+(?:\.\d{1,2})?)(?:\s*(?:\||\s+)\s*\d+(?:\.\d{1,2})?)?\s*$/);
    if (!match) continue;
    const name = match[1].replace(/^\d+[.)]?\s+/, '').trim();
    const slash = name.indexOf('/');
    const sariName = slash > 0 ? name.slice(0, slash).trim() : name;
    const rowCompany = slash > 0 ? name.slice(slash + 1).trim().replace(/[.,]+$/, '') : companyName;
    if (!sariName || !/[a-z\u0900-\u097f]/i.test(sariName)) continue;
    items.push({ companyName: rowCompany, sariName, quantity: Number(match[2]), price: Number(match[3]) });
  }
  return items.slice(0, 500);
}
