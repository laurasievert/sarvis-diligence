import Anthropic from '@anthropic-ai/sdk';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { files, dealContext } = req.body;
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

  let contextSummary = '';
  if (dealContext) {
    const { name, entity, location, summary, financials, flags } = dealContext;
    contextSummary = `\nCurrent deal: ${name || 'this business'}`;
    if (entity) contextSummary += ` (${entity})`;
    if (location) contextSummary += `, ${location}`;
    contextSummary += '\n';
    if (summary) {
      if (summary.revenueLatestYear) contextSummary += `- Latest annual revenue: $${summary.revenueLatestYear.toLocaleString()}\n`;
      if (summary.operatingMarginLatest != null) contextSummary += `- Operating margin: ${(summary.operatingMarginLatest * 100).toFixed(1)}%\n`;
      if (summary.ebitdaEstimate) contextSummary += `- EBITDA estimate: $${summary.ebitdaEstimate.toLocaleString()}\n`;
    }
    if (financials && financials.periods) {
      const periods = Object.keys(financials.periods).sort();
      if (periods.length > 0) {
        const recentPeriods = periods.slice(-3);
        recentPeriods.forEach(period => {
          const p = financials.periods[period];
          if (p) {
            contextSummary += `${period}: Revenue $${(p.revenue || 0).toLocaleString()}`;
            if (p.operatingIncome != null) contextSummary += `, Op. Income $${p.operatingIncome.toLocaleString()}`;
            contextSummary += '\n';
          }
        });
      }
    }
    if (flags) {
      const redCount = (flags.red || []).length;
      const amberCount = (flags.amber || []).length;
      contextSummary += `Current flags: ${redCount} red, ${amberCount} amber\n`;
    }
  }

  content.push({
    type: 'text',
    text: `You are reviewing documents uploaded during diligence for an acquisition.${contextSummary}

Analyze the uploaded document(s) and provide:
1. A brief summary of the document
2. Key findings — what does this confirm, contradict, or add to the current analysis?
3. Specific recommended changes to the diligence report

Then output a JSON block of suggestions using exactly this format:
<suggestions>
[
  {
    "id": "suggestion-1",
    "targetId": "narrative-brief|narrative-headline|narrative-forward",
    "section": "human-readable section name",
    "description": "one-line description of the change",
    "newContent": "full updated paragraph HTML to replace the current content of the target block"
  }
]
</suggestions>

Valid targetId values: "narrative-brief", "narrative-headline", "narrative-forward".
Only include suggestions where the document provides clear evidence for a specific change. Keep the writing style consistent with the existing report: concise, analytical, no fluff.`
  });

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content }]
    });

    const text = response.content[0].text;

    let suggestions = [];
    const match = text.match(/<suggestions>([\s\S]*?)<\/suggestions>/);
    if (match) {
      try { suggestions = JSON.parse(match[1].trim()); } catch (e) {}
    }

    const commentary = text.replace(/<suggestions>[\s\S]*?<\/suggestions>/, '').trim();
    res.json({ commentary, suggestions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
