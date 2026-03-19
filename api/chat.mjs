import Anthropic from '@anthropic-ai/sdk';

function buildSystemPrompt(dealContext) {
  if (!dealContext) {
    return `You are a financial diligence assistant helping evaluate small business acquisitions. Be concise, analytical, and flag additional diligence concerns where relevant.`;
  }

  const { name, entity, location, industry, status, summary, financials, flags, market, narratives } = dealContext;

  let prompt = `You are a financial diligence assistant for the acquisition of ${name || 'this business'}`;
  if (entity) prompt += ` (${entity})`;
  if (location) prompt += `, located in ${location}`;
  if (industry) prompt += `. Industry: ${industry}`;
  prompt += `. Help the buyer think through the deal.\n\n`;

  if (summary) {
    prompt += `Key financial summary:\n`;
    if (summary.revenueLatestYear) prompt += `- Latest annual revenue: $${summary.revenueLatestYear.toLocaleString()}\n`;
    if (summary.revenueYTD && summary.ytdLabel) prompt += `- YTD revenue (${summary.ytdLabel}): $${summary.revenueYTD.toLocaleString()}\n`;
    if (summary.operatingMarginLatest != null) prompt += `- Latest operating margin: ${(summary.operatingMarginLatest * 100).toFixed(1)}%\n`;
    if (summary.ebitdaEstimate) prompt += `- EBITDA estimate: $${summary.ebitdaEstimate.toLocaleString()}\n`;
    if (summary.laborPct) prompt += `- Labor as % of revenue: ${(summary.laborPct * 100).toFixed(0)}%\n`;
    prompt += '\n';
  }

  if (financials && financials.periods) {
    const periods = Object.keys(financials.periods).sort();
    if (periods.length > 0) {
      prompt += `Financial periods available: ${periods.join(', ')}\n`;
      const recentPeriods = periods.slice(-3);
      recentPeriods.forEach(period => {
        const p = financials.periods[period];
        if (p) {
          prompt += `${period}: Revenue $${(p.revenue || 0).toLocaleString()}`;
          if (p.operatingIncome != null) prompt += `, Op. Income $${p.operatingIncome.toLocaleString()}`;
          if (p.netIncome != null) prompt += `, Net Income $${p.netIncome.toLocaleString()}`;
          prompt += '\n';
        }
      });
      prompt += '\n';
    }
  }

  if (market) {
    prompt += `Market context: ${market.description || ''}\n`;
    if (market.tam) prompt += `Regional TAM: ~$${market.tam}\n`;
    if (market.competitorCount) prompt += `Competition: ${market.competitorCount}\n`;
    prompt += '\n';
  }

  if (flags) {
    if (flags.red && flags.red.length > 0) {
      prompt += `Red flags (${flags.red.length}): `;
      prompt += flags.red.map(f => f.text.replace(/<[^>]*>/g, '')).join('; ') + '\n';
    }
    if (flags.amber && flags.amber.length > 0) {
      prompt += `Amber flags (${flags.amber.length}): `;
      prompt += flags.amber.map(f => f.text.replace(/<[^>]*>/g, '')).join('; ') + '\n';
    }
    prompt += '\n';
  }

  prompt += `Be concise and analytical. Flag additional diligence concerns where relevant. Reference specific numbers from the deal data when answering questions.`;

  return prompt;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { messages, dealContext } = req.body;
  if (!messages) return res.status(400).json({ error: 'messages required' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in Vercel environment' });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: buildSystemPrompt(dealContext),
      messages
    });
    res.json({ message: response.content[0].text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
