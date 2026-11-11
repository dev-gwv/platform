import { z } from 'zod'
import { sequenceInput } from './crm-sequences'

/**
 * AI tools for leads (owner, 9 Nov): a WhatsApp reply written from what is
 * known about one lead, and a whole follow-up sequence written from what the
 * studio wants to happen. Nothing written here is ever sent without a person
 * pressing Send, and nothing is saved until the studio saves it.
 */

/** The languages a reply or a sequence is written in. */
export const AI_LANGS = ['en', 'hi', 'hinglish'] as const
export const aiLang = z.enum(AI_LANGS)
export type AiLang = z.infer<typeof aiLang>

export const AI_TONES = ['warm', 'premium', 'fun'] as const
export const aiTone = z.enum(AI_TONES)
export type AiTone = z.infer<typeof aiTone>

/** What the reply is for. The screen picks the next sensible one from the lead. */
export const LEAD_REPLY_INTENTS = [
  'first_reply',
  'share_packages',
  'ask_call',
  'no_answer',
  'quote_follow_up',
  'price_too_high',
  'date_check',
  'booked_thanks',
  'win_back',
  'custom',
] as const
export const leadReplyIntent = z.enum(LEAD_REPLY_INTENTS)
export type LeadReplyIntent = z.infer<typeof leadReplyIntent>

export const leadReplyRequest = z.object({
  intent: leadReplyIntent.default('first_reply'),
  language: aiLang.default('en'),
  tone: aiTone.default('warm'),
  /** "Anything to mention?" -- the studio's own words, e.g. an offer or a question. */
  hint: z.string().trim().max(300).default(''),
})
export type LeadReplyRequest = z.input<typeof leadReplyRequest>

export const leadReplyReply = z.object({
  text: z.string(),
  /** Whether the studio's own number can send it now (connected and inside WhatsApp's 24 hours). */
  can_send_direct: z.boolean().default(false),
})
export type LeadReplyReply = z.infer<typeof leadReplyReply>

/** A written reply that went out (opened in WhatsApp, or copied): kept on the lead's timeline. */
export const leadMessagedRequest = z.object({
  text: z.string().trim().min(1).max(4000),
  via: z.enum(['whatsapp_link', 'copied']).default('whatsapp_link'),
})
export type LeadMessagedRequest = z.infer<typeof leadMessagedRequest>

export const leadSendDirectRequest = z.object({ text: z.string().trim().min(1).max(4000) })

/** What happened with the lead, for the sequence maker. */
export const SEQUENCE_GOALS = [
  'new_no_reply',
  'quote_quiet',
  'after_call',
  'price_too_high',
  'after_shoot',
  'win_back',
  'custom',
] as const
export const sequenceGoal = z.enum(SEQUENCE_GOALS)
export type SequenceGoal = z.infer<typeof sequenceGoal>

export const sequenceDraftRequest = z.object({
  goal: sequenceGoal,
  length: z.enum(['week', 'two_weeks', 'month']).default('two_weeks'),
  pace: z.enum(['gentle', 'normal', 'persistent']).default('normal'),
  channels: z.enum(['whatsapp', 'whatsapp_calls', 'whatsapp_calls_email']).default('whatsapp_calls'),
  language: aiLang.default('en'),
  tone: aiTone.default('warm'),
  hint: z.string().trim().max(300).default(''),
})
export type SequenceDraftRequest = z.input<typeof sequenceDraftRequest>
/** The request after its defaults are filled, as the server reads it. */
export type SequenceDraftAsk = z.infer<typeof sequenceDraftRequest>

/** A sequence as the AI wrote it: what the editor opens with, never saved by itself. */
export const sequenceDraft = sequenceInput
export type SequenceDraft = z.input<typeof sequenceDraft>

// ── Social media captions (owner, 10 Nov) ───────────────────────────

export const CAPTION_PLATFORMS = ['instagram', 'facebook', 'whatsapp_status'] as const
export const CAPTION_KINDS = [
  'wedding_post',
  'pre_wedding',
  'reel',
  'behind_the_scenes',
  'testimonial',
  'offer',
  'dates_open',
  'custom',
] as const
export type CaptionKind = (typeof CAPTION_KINDS)[number]
export type CaptionPlatform = (typeof CAPTION_PLATFORMS)[number]

export const captionRequest = z.object({
  platform: z.enum(CAPTION_PLATFORMS).default('instagram'),
  kind: z.enum(CAPTION_KINDS),
  /** What the post is: couple, place, the moment, an offer -- the studio's own words. */
  details: z.string().trim().max(600).default(''),
  studio: z.string().trim().max(120).default(''),
  /** The studio's handle or city for a sign-off and local hashtags. */
  city: z.string().trim().max(80).default(''),
  language: aiLang.default('en'),
  tone: aiTone.default('warm'),
  hashtags: z.boolean().default(true),
  emojis: z.boolean().default(true),
})
export type CaptionRequest = z.input<typeof captionRequest>
export type CaptionAsk = z.infer<typeof captionRequest>

export const caption = z.object({ text: z.string(), hashtags: z.array(z.string()) })
export type Caption = z.infer<typeof caption>
export const captionReply = z.object({ captions: z.array(caption) })
export type CaptionReply = z.infer<typeof captionReply>

// ── Ad scripts (owner, 10 Nov) ──────────────────────────────────────
// A studio's Meta ad, read to camera by a model in under a minute. The studio
// gives the facts; the AI writes the words and never invents a number.

export const AD_ANGLES = ['invite', 'how_to_choose', 'mistakes', 'myth', 'story', 'dates_offer'] as const
export type AdAngle = (typeof AD_ANGLES)[number]
/** What the studio asks for: one angle, or three different ones. */
export const AD_ASKS = [...AD_ANGLES, 'mix'] as const
export type AdAsk = (typeof AD_ASKS)[number]
export const AD_SPEAKERS = ['female', 'male', 'couple', 'owner'] as const
export type AdSpeaker = (typeof AD_SPEAKERS)[number]
export const AD_CTAS = ['get_quote', 'whatsapp', 'call'] as const
export type AdCta = (typeof AD_CTAS)[number]
export const AD_LENGTHS = [30, 45, 60] as const

/** The angles three different scripts take when the studio lets the AI pick. */
export const AD_MIX: readonly AdAngle[] = ['how_to_choose', 'invite', 'story']

const optionalCount = (max: number) =>
  z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().int().min(0).max(max).optional())

export const adScriptRequest = z.object({
  studio: z.string().trim().min(1).max(120),
  city: z.string().trim().max(80).default(''),
  weddings: optionalCount(100000),
  years: optionalCount(80),
  rating: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.coerce.number().min(1).max(5).optional(),
  ),
  strengths: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
  /** Anything else true about the studio, in its own words. */
  extra: z.string().trim().max(400).default(''),
  speaker: z.enum(AD_SPEAKERS).default('female'),
  angle: z.enum(AD_ASKS).default('mix'),
  /** How many scripts: three, or one when a single script is written again. */
  count: z.coerce.number().int().min(1).max(3).default(3),
  language: aiLang.default('hi'),
  tone: aiTone.default('warm'),
  seconds: z.coerce.number().refine((n) => (AD_LENGTHS as readonly number[]).includes(n)).default(60),
  cta: z.enum(AD_CTAS).default('get_quote'),
  offer: z.string().trim().max(200).default(''),
})
export type AdScriptRequest = z.input<typeof adScriptRequest>
export type AdScriptAsk = z.infer<typeof adScriptRequest>

export const adScriptPart = z.object({ at: z.string(), text: z.string() })
export type AdScriptPart = z.infer<typeof adScriptPart>
export const adScript = z.object({
  angle: z.enum(AD_ANGLES),
  /** A short name for the script, e.g. "Don't judge by Instagram". */
  title: z.string(),
  /** What is said in the first three seconds: the line that stops the scroll. */
  hook: z.string(),
  /** The rest, in timed parts ("3–15 s"). */
  parts: z.array(adScriptPart),
  /** Short lines the editor puts on screen. */
  on_screen: z.array(z.string()),
  /** For the model: expression, pace, pauses, which shots to cut to. */
  model_notes: z.string(),
  words: z.number(),
  /** Spoken length, worked out from the words. */
  seconds: z.number(),
})
export type AdScript = z.infer<typeof adScript>
export const adScriptReply = z.object({ scripts: z.array(adScript) })
export type AdScriptReply = z.infer<typeof adScriptReply>
