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
