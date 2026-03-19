import Anthropic from '@anthropic-ai/sdk';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body;
  try { body = await req.json(); } catch { return new Response('Bad request', { status: 400 }); }

  const { files, dealContext } = body;
  if (!files || !files.length) return new Response(JSON.stringify({ error: 'files required' }), { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), { status: 500 });

  const client = new Anthropic({ apiKey });

  const content = [];

  for (const file of files) {
    if (file.mediaType === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data } });
    } else if (file.mediaType && file.mediaType.startsWith('image/')) {
      content.push({ type: 'image', source: { type: 'base64', media_type: file.mediaType, data: file.data } });
    } else {
      const text = atob(file.data);
      content.push({ type: 'text', text: `[File: ${file.name}]\n${text}` });
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
      const periods = Object.keys(financials.periods).sort().slice(-3);
      periods.forEach(period => {
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

  // Use streaming so the edge function stays alive for the full response
  const stream = await client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{ role: 'user', content }]
  });

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  (async () => {
    try {
      let text = '';
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
          text += chunk.delta.text;
          // Send progress ping so client knows we're alive
          writer.write(encoder.encode(': ping\n\n'));
        }
      }

      let suggestions = [];
      const match = text.match(/<suggestions>([\s\S]*?)<\/suggestions>/);
      if (match) { try { suggestions = JSON.parse(match[1].trim()); } catch {} }
      const commentary = text.replace(/<suggestions>[\s\S]*?<\/suggestions>/, '').trim();

      writer.write(encoder.encode(`data: ${JSON.stringify({ commentary, suggestions })}\n\n`));
    } catch (e) {
      writer.write(encoder.encode(`data: ${JSON.stringify({ error: e.message })}\n\n`));
    } finally {
      writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    }
  });
}
