import Anthropic from '@anthropic-ai/sdk';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { files } = req.body;
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
    text: `You are reviewing documents uploaded during diligence for the acquisition of Darling's Home Care (Darling Apothecary, LLC), a home care business in Warren, PA.

Current known financials:
- 2024: Revenue $1.62M, Operating loss –$23.9K
- 2025: Revenue $1.82M, Operating income $216.6K (11.9% margin)
- 2026 YTD: $364K revenue, 17.9% op. margin (~$1.74M annualized)
- Labor (wages + payroll taxes) ≈ 78–80% of revenue
- Key unknowns: payer mix, owner compensation, debt schedule, caregiver turnover

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
