import Anthropic from '@anthropic-ai/sdk';

const STANDARD_LINE_ITEMS = [
  {"key": "revenue", "label": "Revenue", "type": "income"},
  {"key": "cogs", "label": "Cost of Goods Sold", "type": "expense"},
  {"key": "grossProfit", "label": "Gross Profit", "type": "subtotal"},
  {"key": "wages", "label": "Wages & Salaries", "type": "expense"},
  {"key": "ficaTaxes", "label": "FICA / Payroll Taxes", "type": "expense"},
  {"key": "software", "label": "Software / IT", "type": "expense"},
  {"key": "car", "label": "Car Expenses", "type": "expense"},
  {"key": "insurance", "label": "Insurance", "type": "expense"},
  {"key": "pension", "label": "Pension / Retirement", "type": "expense"},
  {"key": "rent", "label": "Rent & Occupancy", "type": "expense"},
  {"key": "medicalSupplies", "label": "Medical Supplies", "type": "expense"},
  {"key": "employeeBenefits", "label": "Employee Benefits", "type": "expense"},
  {"key": "interestExpense", "label": "Interest Expense", "type": "expense"},
  {"key": "otherExpenses", "label": "Other Expenses", "type": "expense"},
  {"key": "totalExpenses", "label": "Total Expenses", "type": "subtotal"},
  {"key": "operatingIncome", "label": "Operating Income", "type": "subtotal"},
  {"key": "otherIncome", "label": "Other Income / (Expense)", "type": "income"},
  {"key": "netIncome", "label": "Net Income", "type": "total"}
];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { dealName, files } = req.body;
  if (!files || !files.length) return res.status(400).json({ error: 'files required' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in Vercel environment' });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const content = [];

  for (const file of files) {
    if (file.mediaType === 'application/pdf') {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: file.data }
      });
    } else if (file.mediaType && file.mediaType.startsWith('image/')) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: file.mediaType, data: file.data }
      });
    } else {
      content.push({
        type: 'text',
        text: `[File: ${file.name}]\n${Buffer.from(file.data, 'base64').toString('utf-8')}`
      });
    }
  }

  content.push({
    type: 'text',
    text: `You are extracting structured financial diligence data for the acquisition of "${dealName || 'this business'}".

Extract all financial and business data from the uploaded documents and return a JSON object with the following structure. Use null for any values not found in the documents (never use 0 as a substitute for missing data — only use 0 if the document explicitly shows $0).

Standard line item keys to use:
${STANDARD_LINE_ITEMS.map(li => `- "${li.key}": ${li.label}`).join('\n')}

Period key format:
- Annual: "2023", "2024", "2025"
- Quarterly: "2024-Q1", "2024-Q2", "2024-Q3", "2024-Q4"
- Monthly: "2024-01", "2024-02", ... "2024-12"

Return ONLY a JSON object (no prose before or after) matching this exact structure:

{
  "financials": {
    "lineItems": [/* use the standard list above exactly */],
    "periods": {
      "YYYY": {
        "revenue": number_or_null,
        "cogs": number_or_null,
        "grossProfit": number_or_null,
        "wages": number_or_null,
        "ficaTaxes": number_or_null,
        "software": number_or_null,
        "car": number_or_null,
        "insurance": number_or_null,
        "pension": number_or_null,
        "rent": number_or_null,
        "medicalSupplies": number_or_null,
        "employeeBenefits": number_or_null,
        "interestExpense": number_or_null,
        "otherExpenses": number_or_null,
        "totalExpenses": number_or_null,
        "operatingIncome": number_or_null,
        "otherIncome": number_or_null,
        "netIncome": number_or_null
      }
    }
  },
  "narratives": {
    "brief": "<p>HTML paragraph about business model and revenue structure.</p>",
    "headline": "<p>HTML paragraph about key financial trends and notable changes.</p>",
    "forward": "<p>HTML paragraph about market opportunity and key risks.</p>"
  },
  "flags": {
    "red": [{"text": "<b>Title.</b> Description of serious concern."}],
    "amber": [{"text": "<b>Title.</b> Description of moderate concern."}],
    "green": [{"text": "Positive observation about the business."}]
  },
  "summary": {
    "revenueLatestYear": number_or_null,
    "revenueYTD": number_or_null,
    "ytdLabel": "string like Jan–Mar 2026 or null",
    "operatingMarginLatest": number_or_null,
    "ebitdaEstimate": number_or_null,
    "laborPct": number_or_null
  },
  "market": {
    "description": "string or null",
    "seniorCount": number_or_null,
    "tam": "string or null",
    "competitorCount": "string or null"
  },
  "valuation": {
    "baseNetIncome": number_or_null,
    "interestAddback": number_or_null,
    "ownerWagesAddback": 0,
    "carAddback": 0,
    "otherAddback": 0,
    "replacementSalary": 0,
    "normalizedRent": 0,
    "debt": 0
  }
}

Instructions:
1. Extract every financial period visible in the documents
2. Use the exact lineItem keys listed above
3. Set values to null for line items not found — do NOT invent numbers
4. Generate concise, analytical narratives in HTML paragraph format based on what you observe
5. Flag genuine concerns (red = serious, amber = needs follow-up, green = positive signal)
6. For summary.revenueLatestYear, use the most recent full-year revenue
7. For summary.operatingMarginLatest, calculate as operatingIncome/revenue for most recent full year
8. Return valid JSON only — no markdown code fences, no explanatory text`
  });

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: 'You are a financial diligence analyst extracting structured data from business documents for an acquisition diligence tool. Return only valid JSON.',
      messages: [{ role: 'user', content }]
    });

    const text = response.content[0].text.trim();

    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

    let extracted;
    try {
      extracted = JSON.parse(cleaned);
    } catch (e) {
      // Try to find JSON object in the response
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extracted = JSON.parse(jsonMatch[0]);
      } else {
        return res.status(500).json({ error: 'Failed to parse Claude response as JSON', raw: text.slice(0, 500) });
      }
    }

    // Ensure lineItems is always the standard list
    if (extracted.financials) {
      extracted.financials.lineItems = STANDARD_LINE_ITEMS;
    }

    res.json(extracted);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
