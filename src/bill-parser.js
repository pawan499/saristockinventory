// Conservative candidate parser: name | qty | unit price [| amount], or whitespace rows.
// OCR candidates always require review. Totals/taxes are never inventory items.
export function parseBillText(text, companyName = '') {
  const items = [];
  for (const line of text.split(/\r?\n/)) {
    if (/\b(total|subtotal|gst|cgst|sgst|igst|tax|discount|invoice|date|qty|quantity|amount)\b/i.test(line)) continue;
    const normalized = line.trim().replace(/(?:₹|Rs\.?|INR)\s*/gi, '').replace(/(\d),(?=\d{3}\b)/g, '$1');
    const match = normalized.match(/^(.+?)\s*(?:\||\s{2,})\s*(\d+)\s*(?:\||\s+)\s*(\d+(?:\.\d{1,2})?)(?:\s*(?:\||\s+)\s*\d+(?:\.\d{1,2})?)?\s*$/);
    if (!match) continue;
    const sariName = match[1].replace(/^\d+[.)]?\s+/, '').trim();
    if (!sariName || !/[a-z\u0900-\u097f]/i.test(sariName)) continue;
    items.push({ companyName, sariName, quantity: Number(match[2]), price: Number(match[3]) });
  }
  return items.slice(0, 500);
}
