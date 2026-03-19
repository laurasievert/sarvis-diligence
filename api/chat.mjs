import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `You are a financial diligence assistant for the acquisition of Darling's Home Care (Darling Apothecary, LLC), a home care business in Warren, PA. Help the buyer think through the deal.

Key financials:
- 2024: Revenue $1.62M, Operating loss –$23.9K, Net income $6.5K (rescued by $34.7K one-time asset sale gain)
- 2025: Revenue $1.82M (+13%), Operating income $216.6K (11.9% margin), Net income $195K
- 2026 YTD (Jan–Mar 14): Revenue $364K, Op. margin 17.9% (~$1.74M annualized)
- Wages + payroll taxes ≈ 78–80% of revenue
- 2025 EBITDA est. $237K; adj. EBITDA depends on owner comp add-backs (unknown)

Key cost changes 2024→2025: Rent –$29.6K (to $322), Car –$19.3K, Software/IT –$14.5K, Insurance –$8.9K; Employee benefits +$21.9K, Interest +$16.8K

Key unknowns: payer mix (all revenue classified as "non-taxable sales"), owner compensation, debt schedule, PA licensure status, caregiver headcount/turnover

Market: Warren County PA, median age 47.4, 23.7% age 65+, ~$54–81M regional TAM, thin competition (~3–6 licensed agencies)

Be concise. Flag additional diligence concerns where relevant.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: 'messages required' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in Vercel environment' });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM,
      messages
    });
    res.json({ message: response.content[0].text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
