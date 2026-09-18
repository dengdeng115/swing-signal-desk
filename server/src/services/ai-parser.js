const SIGNAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['symbol', 'action', 'price', 'fraction', 'stopPrice', 'conditional', 'confidence', 'explanation'],
  properties: {
    symbol: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    action: { type: 'string', enum: ['buy', 'sell', 'hold', 'note'] },
    price: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    fraction: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    stopPrice: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    conditional: { type: 'boolean' },
    confidence: { type: 'number' },
    explanation: { type: 'string' }
  }
};

function extractOutputText(response) {
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) return content.text;
    }
  }
  throw new Error('AI response did not contain output_text');
}

export async function parseSignalWithAI(text, config, fetchImpl = fetch) {
  if (!config.enabled) return null;
  const response = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model,
      instructions: [
        'Extract a candidate US stock swing-trading instruction from Chinese chat text.',
        'Do not infer a trade when the message is commentary, observation, or a condition that has not happened.',
        'fraction is a decimal of current position for sells or account equity for buys.',
        'Return uncertainty honestly. This output never authorizes a real order.'
      ].join(' '),
      input: text,
      text: {
        format: {
          type: 'json_schema',
          name: 'trade_signal_candidate',
          strict: true,
          schema: SIGNAL_SCHEMA
        }
      }
    })
  });

  if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
  const payload = await response.json();
  return { ...JSON.parse(extractOutputText(payload)), parser: `openai:${config.model}`, executable: false };
}

export { SIGNAL_SCHEMA };
