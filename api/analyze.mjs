import Anthropic from '@anthropic-ai/sdk';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { files, dealContext } = req.body;
  if (!files || !files.length) return res.status(400).json({ error: 'files required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const client = new Anthropic({ apiKey });

  const content = [];

  for (const file of files) {
    if (file.mediaType === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data } });
    } else if (file.mediaType && file.mediaType.startsWith('image/')) {
      content.push({ type: 'image', source: { type: 'base64', media_type: file.mediaType, data: file.data } });
    } else {
      content.push({ type: 'text', text: `[File: ${file.name}]\n${Buffer.from(file.data, 'base64').toString('utf-8')}` });
    }
  }

  let contextSummary = '';
  if (dealContext) {
    const { name, entity, location, summary, financials, flags, checklistItems } = dealContext;
    contextSummary = `\nCurrent deal: ${name || 'this business'}`;
    if (entity) contextSummary += ` (${entity})`;
    if (location) contextSummary += `, ${location}`;
    contextSummary += '\n';
    if (summary) {
      if (summary.revenueLatestYear) contextSummary += `- Latest annual revenue: $${summary.revenueLatestYear.toLocaleString()}\n`;
      if (summary.operatingMarginLatest != null) contextSummary += `- Operating margin: ${(summary.operatingMarginLatest * 100).toFixed(1)}%\n`;
    }
    if (financials && financials.periods) {
      Object.keys(financials.periods).sort().slice(-3).forEach(period => {
        const p = financials.periods[period];
        if (p) contextSummary += `${period}: Revenue $${(p.revenue || 0).toLocaleString()}\n`;
      });
    }
    if (flags) contextSummary += `Flags: ${(flags.red||[]).length} red, ${(flags.amber||[]).length} amber\n`;
    if (checklistItems && checklistItems.length) {
      contextSummary += `\nDiligence checklist (id | item | category):\n`;
      checklistItems.forEach(i => { contextSummary += `${i.id} | ${i.item} | ${i.category}\n`; });
    }
  }

  content.push({
    type: 'text',
    text: `You are reviewing documents uploaded during diligence for an acquisition.${contextSummary}

Analyze the uploaded document(s) and provide:
1. A brief summary of the document
2. Key findings — what does this confirm, contradict, or add to the current analysis?
3. Specific recommended changes to the diligence report

Then output a JSON block using exactly this format:
<suggestions>
[
  {
    "id": "suggestion-1",
    "targetId": "narrative-brief|narrative-headline|narrative-forward",
    "section": "human-readable section name",
    "description": "one-line description of the change",
    "newContent": "full updated paragraph HTML",
    "coveredItemIds": ["3.01", "3.02"]
  }
]
</suggestions>

coveredItemIds: list checklist item IDs this document provides evidence for.
Only suggest changes with clear document evidence. Be concise and analytical.`
  });

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content }]
    });

    const text = response.content[0].text;
    let suggestions = [];
    const match = text.match(/<suggestions>([\s\S]*?)<\/suggestions>/);
    if (match) { try { suggestions = JSON.parse(match[1].trim()); } catch {} }
    const commentary = text.replace(/<suggestions>[\s\S]*?<\/suggestions>/, '').trim();
    res.json({ commentary, suggestions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
