import Anthropic from '@anthropic-ai/sdk';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { file, dealContext } = req.body;
  if (!file) return res.status(400).json({ error: 'file required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const client = new Anthropic({ apiKey });

  const content = [];

  if (file.mediaType === 'application/pdf') {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data } });
  } else if (file.mediaType && file.mediaType.startsWith('image/')) {
    content.push({ type: 'image', source: { type: 'base64', media_type: file.mediaType, data: file.data } });
  } else {
    content.push({ type: 'text', text: `[File: ${file.name}]\n${Buffer.from(file.data, 'base64').toString('utf-8')}` });
  }

  let ctx = '';
  if (dealContext) {
    const { name, entity, location, summary, financials, valuation, flags, checklistItems } = dealContext;
    ctx = `\nDeal: ${name || 'this business'}`;
    if (entity) ctx += ` (${entity})`;
    if (location) ctx += `, ${location}`;
    ctx += '\n';
    if (summary?.revenueLatestYear) ctx += `- Current revenue (latest year): $${summary.revenueLatestYear.toLocaleString()}\n`;
    if (summary?.ebitdaEstimate) ctx += `- Current EBITDA estimate: $${summary.ebitdaEstimate.toLocaleString()}\n`;
    if (flags) ctx += `- Flags: ${(flags.red||[]).length} red, ${(flags.amber||[]).length} amber\n`;

    if (financials?.periods) {
      ctx += `\nExisting financial periods (period: revenue | operatingIncome | netIncome):\n`;
      Object.entries(financials.periods).forEach(([period, p]) => {
        ctx += `${period}: $${(p.revenue||0).toLocaleString()} | $${(p.operatingIncome||0).toLocaleString()} | $${(p.netIncome||0).toLocaleString()}\n`;
      });
    }

    if (valuation) {
      ctx += `\nExisting valuation inputs: baseNetIncome=$${(valuation.baseNetIncome||0).toLocaleString()}, interestAddback=$${(valuation.interestAddback||0).toLocaleString()}, ownerWagesAddback=$${(valuation.ownerWagesAddback||0).toLocaleString()}, carAddback=$${(valuation.carAddback||0).toLocaleString()}, replacementSalary=$${(valuation.replacementSalary||0).toLocaleString()}, normalizedRent=$${(valuation.normalizedRent||0).toLocaleString()}\n`;
    }

    if (checklistItems?.length) {
      ctx += `\nDiligence checklist (id | item | category | status):\n`;
      checklistItems.forEach(i => { ctx += `${i.id} | ${i.item} | ${i.category} | ${i.status}\n`; });
    }
  }

  content.push({
    type: 'text',
    text: `You are reviewing a document uploaded during diligence for an acquisition.${ctx}

Analyze the document and respond with ONLY a JSON object in this exact format (no other text):
{
  "summary": "2-3 sentence summary of what this document is and what it shows",
  "flags": [{"type": "red|amber|green", "text": "flag description — cite specific numbers"}],
  "coveredItemIds": ["3.01", "3.02"],
  "financialUpdates": {
    "2024": {"revenue": 1615574, "wages": 1193572, "ficaTaxes": 89451, "operatingIncome": -23925, "netIncome": 6500}
  },
  "summaryUpdates": {
    "revenueLatestYear": 1823928,
    "operatingMarginLatest": 0.119,
    "ebitdaEstimate": 237000,
    "laborPct": 0.68
  },
  "valuationUpdates": {
    "baseNetIncome": 195421,
    "interestAddback": 21167,
    "ownerWagesAddback": 0,
    "carAddback": 0,
    "normalizedRent": 20000
  },
  "diligenceUpdates": [
    {"id": "3.01", "status": "received", "notes": "2024 and 2025 P&L statements uploaded (cash basis)."}
  ],
  "narrativeSuggestions": [
    {
      "targetId": "narrative-brief|narrative-headline|narrative-forward",
      "section": "human-readable section name",
      "description": "one-line description of the change",
      "newContent": "full updated paragraph HTML"
    }
  ]
}

Rules:
- flags: only genuine concerns or confirmed positives. Cite numbers. Omit if none.
- coveredItemIds: ONLY checklist items this document directly provides evidence for. Be conservative.
- financialUpdates: ONLY if this document IS a financial statement. Key by period string (e.g. "2024", "2025", "2026-Q1"). Only include fields you can actually read. Valid fields: revenue, cogs, grossProfit, wages, ficaTaxes, software, car, insurance, pension, rent, medicalSupplies, employeeBenefits, interestExpense, otherExpenses, totalExpenses, operatingIncome, otherIncome, netIncome. Set to null if no financials.
- summaryUpdates: only if document provides better data for top-level KPIs. Set to null if not applicable.
- valuationUpdates: only if document reveals owner compensation, add-backs, or normalized costs that differ from existing values. Set to null if not applicable.
- diligenceUpdates: only mark items as "received" if this document directly satisfies the specific request. "addressed" = fully resolved. Set to null if not applicable.
- narrativeSuggestions: only if document clearly warrants a narrative change. Set to null if not applicable.
Be concise and analytical.`
  });

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content }]
    });

    const text = response.content[0].text.trim();
    let result;
    try {
      const clean = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
      result = JSON.parse(clean);
    } catch {
      result = { summary: text, flags: [], coveredItemIds: [], financialUpdates: null, summaryUpdates: null, valuationUpdates: null, diligenceUpdates: null, narrativeSuggestions: null };
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
