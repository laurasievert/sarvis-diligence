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

  let contextSummary = '';
  if (dealContext) {
    const { name, entity, location, summary, financials, flags, checklistItems } = dealContext;
    contextSummary = `\nDeal: ${name || 'this business'}`;
    if (entity) contextSummary += ` (${entity})`;
    if (location) contextSummary += `, ${location}`;
    contextSummary += '\n';
    if (summary?.revenueLatestYear) contextSummary += `- Revenue: $${summary.revenueLatestYear.toLocaleString()}\n`;
    if (flags) contextSummary += `- Flags: ${(flags.red||[]).length} red, ${(flags.amber||[]).length} amber\n`;
    if (checklistItems?.length) {
      contextSummary += `\nDiligence checklist (id | item | category):\n`;
      checklistItems.forEach(i => { contextSummary += `${i.id} | ${i.item} | ${i.category}\n`; });
    }
  }

  content.push({
    type: 'text',
    text: `You are reviewing a document uploaded during diligence for an acquisition.${contextSummary}

Analyze the document and respond with ONLY a JSON object in this exact format (no other text):
{
  "summary": "2-3 sentence summary of what this document is and what it shows",
  "findings": ["key finding 1", "key finding 2", "key finding 3"],
  "flags": [{"type": "red|amber|green", "text": "flag description"}],
  "coveredItemIds": ["3.01", "3.02"],
  "narrativeSuggestions": [
    {
      "targetId": "narrative-brief|narrative-headline|narrative-forward",
      "section": "human-readable section name",
      "description": "one-line description of the change",
      "newContent": "full updated paragraph HTML"
    }
  ]
}

coveredItemIds: checklist item IDs this document provides evidence for.
flags: only include if the document reveals genuine red/amber concerns or confirms something positive (green).
narrativeSuggestions: only if the document clearly warrants a change to the deal narrative.
Be concise and analytical.`
  });

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content }]
    });

    const text = response.content[0].text.trim();
    let result;
    try {
      // Strip markdown code fences if present
      const clean = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
      result = JSON.parse(clean);
    } catch {
      result = { summary: text, findings: [], flags: [], coveredItemIds: [], narrativeSuggestions: [] };
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
