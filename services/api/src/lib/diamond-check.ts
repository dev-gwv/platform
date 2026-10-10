import Anthropic from '@anthropic-ai/sdk'

/**
 * Does this screenshot show the "IPC Diamonds - Premium" WhatsApp group?
 *
 * The owner's rule for who is an IPC Diamond member: they are in that group,
 * and a screenshot of it is the proof. Claude reads the chat's title off the
 * image and says whether the screen is a WhatsApp group chat. We decide from
 * what it read, not from its opinion, so the rule stays the owner's: the group
 * title must say IPC Diamonds Premium.
 *
 * A doctored screenshot can pass. That is accepted: every approval is listed
 * in the platform inbox with the image, and the owner can revoke it.
 */

interface DiamondReading {
  is_whatsapp_group_chat: boolean
  group_title: string | null
  confidence: 'high' | 'medium' | 'low'
}

type DiamondVerdict =
  | { decision: 'approve'; reading: DiamondReading }
  | { decision: 'reject'; reason: string; reading: DiamondReading | null }
  /** Nothing could be read (no key, a network failure, a refusal): a person decides. */
  | { decision: 'manual'; reason: string }

const DIAMOND_GROUP = 'IPC Diamonds - Premium'
const TITLE = /IPC\s*Diamonds?\s*[-–—:|]?\s*Premium/i

type ImageType = 'image/png' | 'image/jpeg' | 'image/webp'
const IMAGE_TYPES = new Set<string>(['image/png', 'image/jpeg', 'image/webp'])

const SCHEMA = {
  type: 'object',
  properties: {
    is_whatsapp_group_chat: {
      type: 'boolean',
      description: 'True if the image is a screenshot of a WhatsApp group chat (app or web), false otherwise.',
    },
    group_title: {
      type: ['string', 'null'],
      description: "The group chat's name exactly as shown in the chat header, emoji removed. Null if there is none.",
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['is_whatsapp_group_chat', 'group_title', 'confidence'],
  additionalProperties: false,
} as const

const PROMPT =
  'This is a screenshot someone uploaded to prove they are in a particular WhatsApp group. ' +
  'Report what the image shows: whether it is a WhatsApp group chat screen, and the group name in the chat header, ' +
  'copied exactly as written (leave out emoji). Report only what is visible; do not guess a name that is not there.'

/** The decision from what was read. Pure, so the rule can be tested without the API. */
export function judge(reading: DiamondReading): DiamondVerdict {
  if (!reading.is_whatsapp_group_chat) {
    return { decision: 'reject', reason: 'This does not look like a WhatsApp group chat.', reading }
  }
  if (!reading.group_title || !TITLE.test(reading.group_title)) {
    const seen = reading.group_title ? `the group name we read was "${reading.group_title.slice(0, 80)}"` : 'we could not read a group name'
    return { decision: 'reject', reason: `This is not the ${DIAMOND_GROUP} group: ${seen}.`, reading }
  }
  if (reading.confidence === 'low') {
    return { decision: 'reject', reason: 'The group name was hard to read. Try a clearer screenshot of the chat header.', reading }
  }
  return { decision: 'approve', reading }
}

/** The part of the SDK we use; a stand-in replaces it in tests. */
export interface MessagesClient {
  beta: { messages: { create: Anthropic['beta']['messages']['create'] } }
}

export async function checkDiamondScreenshot(
  apiKey: string | undefined,
  image: { mime: string; bytes: Uint8Array },
  client?: MessagesClient,
): Promise<DiamondVerdict> {
  if (!IMAGE_TYPES.has(image.mime)) return { decision: 'reject', reason: 'Upload a PNG, JPEG or WEBP screenshot.', reading: null }
  if (!client && !apiKey) return { decision: 'manual', reason: 'Automatic checking is not switched on; the team will look at it.' }
  const api = client ?? new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 })

  try {
    const res = await api.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 1024,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: image.mime as ImageType, data: Buffer.from(image.bytes).toString('base64') },
            },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    })
    if (res.stop_reason === 'refusal') return { decision: 'manual', reason: 'The screenshot could not be checked automatically; the team will look at it.' }
    const text = res.content.find((b) => b.type === 'text')
    if (!text || text.type !== 'text') return { decision: 'manual', reason: 'The screenshot could not be read; the team will look at it.' }
    const reading = JSON.parse(text.text) as DiamondReading
    return judge(reading)
  } catch (e) {
    console.error('[diamond] check failed', e instanceof Error ? e.message : e)
    return { decision: 'manual', reason: 'The screenshot could not be checked right now; the team will look at it.' }
  }
}
