/**
 * The starter library of crew agreements.
 *
 * Static, and deliberately not in the database: these are drafts to copy from,
 * not the studio's terms. "Use this template" writes a company-owned copy that
 * they then own and edit — the library never changes under them afterwards.
 *
 * The bodies carry {{variables}} substituted at send time, and every one ends
 * with a note to have a lawyer look at it. They are business-protection
 * drafts, not legal advice.
 */
import type { TeamTermsCategory, TeamTermsMode } from '@ipc/contracts'

type LibraryCategory = TeamTermsCategory

export const CATEGORY_LABELS: Record<LibraryCategory, string> = {
  pre_production: 'Pre-production',
  production: 'Production / Shoot Day',
  post_production: 'Post-production',
  general: 'General',
  business_protection: 'Business Protection',
}

interface LibraryTemplate {
  key: string
  title: string
  description: string
  category: LibraryCategory
  mode: TeamTermsMode
  validity_days: number | null
  best_for: string[]
  body: string
}

const LEGAL_NOTE = `Legal review note: This template is a business protection draft and should be reviewed by a legal advisor before operational use. Enforceability of any restriction is subject to applicable law.`

const HEADER = (subject: string) => `${subject}

This undertaking is executed on {{agreement_date}} between {{company_name}}, having its office at {{company_address}} (the "Company"), and {{team_member_name}} (the "Team Member"), assigned as {{role}} for {{shoot_name}} under project {{project_name}} scheduled on {{shoot_date}}.`

const SIGN_BLOCK = `Acknowledgement
By acknowledging this document electronically through the secure link provided by the Company, the Team Member confirms that they have read, understood, and agreed to all terms above.

Accepted and acknowledged by: {{team_member_name}}
Role: {{role}}
Date: {{agreement_date}}

${LEGAL_NOTE}`

const CLAUSE = {
  confidentiality: `Confidential Information
The Team Member acknowledges that during this assignment they may access confidential and proprietary information of the Company, including client names, family details, contact numbers, event details, pricing, quotation structures, vendor information, team lists, SOPs, workflows, editing processes, presets, scripts, sales processes, internal templates, project documents, data management systems, and business strategy. The Team Member shall maintain strict confidentiality of all such information and shall not disclose, copy, or use it for any purpose other than performing the assignment.`,
  nonCircumvention: `No Client Bypassing / Non-Circumvention
The Team Member shall not directly or indirectly bypass the Company and shall not approach, contact, negotiate with, accept work from, provide services to, or receive payment from any client, client family member, lead, vendor, planner, or project contact introduced through the Company, except through the Company's authorised channels.`,
  noContactExchange: `No Contact Exchange
The Team Member shall not exchange personal phone numbers, email IDs, Instagram handles, portfolio links, business cards, rate cards, QR codes, payment details, or direct service offers with any client, client family member, event planner, vendor, or project contact for the purpose of future direct work or bypassing the Company.`,
  restrictedDealing: `Restricted Client Dealing Period
For a period of 24 months from the date of last assignment or association with the Company, the Team Member shall not directly or indirectly solicit, approach, accept work from, or provide similar services to any client, lead, client family member, planner, vendor, or project contact introduced by or through the Company. This restriction is intended to protect the Company's legitimate business interests and is subject to applicable law.`,
  noMisuseSystems: `No Misuse of Company Systems
The Team Member shall not copy, reproduce, adapt, disclose, teach, sell, or commercially exploit the Company's SOPs, workflows, client-handling systems, pricing strategy, templates, scripts, editing process, project management system, team structure, vendor network, or internal business methods for personal or competing business purposes.`,
  nonSolicitation: `Non-Solicitation of Team and Vendors
The Team Member shall not solicit, hire, induce, or divert any employee, freelancer, photographer, editor, vendor, manager, or team member associated with the Company for personal work, competing work, or a separate business, during the assignment and for 24 months thereafter, subject to applicable law.`,
  unfairCompetition: `No Unfair Competition Using Company Information
The Team Member remains free to carry on their lawful profession independently. However, the Team Member shall not use the Company's confidential information, client relationships, project data, workflows, pricing, templates, systems, vendor network, team network, training, brand goodwill, or Company-introduced contacts to directly or indirectly bypass, compete unfairly with, solicit from, or cause commercial loss to the Company.`,
  dataIp: `Data and IP Ownership
All raw footage, photographs, edited files, project files, working files, reels, films, albums, designs, presets, LUTs, data copies, and creative output created or handled during the assignment shall remain the property of the Company and/or the client as applicable. The Team Member shall not retain, reuse, publish, sell, or share any project data without prior written permission from the Company.`,
  social: `Social Media and Portfolio Restriction
The Team Member shall not post, publish, use, or showcase any client or project work on social media, portfolio, website, WhatsApp status, Instagram, YouTube, or any public or private platform without prior written permission from the Company.`,
  conduct: `Professional Conduct
The Team Member shall report on time as per {{reporting_time}}, follow the prescribed dress code, behave professionally with the client, family, guests, and vendors at all times, and follow the lead coordinator's or senior crew member's instructions on site.`,
  payment: `Payment and Completion Conditions
Any payment of {{payment_amount}} or as separately agreed shall become due only upon (a) full completion of the assigned scope, (b) handover of all raw and working data to the Company, and (c) compliance with the obligations under this undertaking. The Company reserves the right to withhold or adjust dues in case of breach.`,
  breach: `Breach Consequences and Remedies
In case of breach of any term of this undertaking, the Company may initiate appropriate legal action, seek injunctive relief, recover losses, damages, unpaid dues adjustments, reputation loss, and legal costs, and pursue any other remedies available under applicable law.`,
}

function compose(parts: string[]): string {
  return parts.filter(Boolean).join('\n\n')
}

export const TEMPLATE_LIBRARY: LibraryTemplate[] = [
  {
    key: 'pre_coordinator',
    title: 'Pre-Production Coordinator Undertaking',
    description:
      'For coordinators and planners who handle client communication and shoot logistics before the event.',
    category: 'pre_production',
    mode: 'acknowledgement_required',
    validity_days: 60,
    best_for: [
      'Client Coordinator',
      'Production Coordinator',
      'Creative Director',
      'Event Planner Liaison',
    ],
    body: compose([
      HEADER('Pre-Production Coordinator Undertaking'),
      "Scope of Engagement\nThe Team Member is engaged to coordinate planning, scheduling, vendor communication, and client servicing for the above project under the Company's direction.",
      CLAUSE.conduct,
      CLAUSE.confidentiality,
      'Client Communication Rules\nAll communication with the client, family, vendors, and planners shall be conducted through Company-approved channels. The Team Member shall not promise deliverables, deadlines, pricing, discounts, or commercial terms to any client without prior written approval from the Company.',
      CLAUSE.nonCircumvention,
      CLAUSE.noContactExchange,
      'Planning Data Confidentiality\nShoot timelines, family details, location access notes, vendor contacts, and internal planning documents are confidential and shall not be shared outside Company-approved channels.',
      CLAUSE.dataIp,
      CLAUSE.breach,
      SIGN_BLOCK,
    ]),
  },
  {
    key: 'non_circumvention',
    title: 'Client Communication & Non-Circumvention Undertaking',
    description:
      'Strong business-protection undertaking for any team member with direct client access.',
    category: 'business_protection',
    mode: 'acknowledgement_required',
    validity_days: 90,
    best_for: [
      'Coordinator',
      'Client Servicing',
      'Creative Director',
      'Shoot Planner',
      'Sales / Operations',
    ],
    body: compose([
      HEADER('Client Communication & Non-Circumvention Undertaking'),
      CLAUSE.confidentiality,
      CLAUSE.nonCircumvention,
      CLAUSE.noContactExchange,
      'No Direct Negotiation\nThe Team Member shall not negotiate fees, packages, discounts, deliverables, or timelines directly with any client or client representative without prior written approval from the Company.',
      'No Referral to Competitors\nThe Team Member shall not refer, recommend, or route any Company client, lead, or project to a competing studio, photographer, editor, or vendor.',
      CLAUSE.restrictedDealing,
      CLAUSE.breach,
      SIGN_BLOCK,
    ]),
  },
  {
    key: 'shoot_planning',
    title: 'Shoot Planning Confidentiality Agreement',
    description:
      'Confidentiality cover for planners and production assistants handling sensitive client and venue data.',
    category: 'pre_production',
    mode: 'acknowledgement_required',
    validity_days: 60,
    best_for: ['Shoot Planner', 'Production Coordinator', 'Production Assistant'],
    body: compose([
      HEADER('Shoot Planning Confidentiality Agreement'),
      'Scope\nThe Team Member is engaged to assist in the planning and coordination of {{shoot_name}} for the client of the Company.',
      CLAUSE.confidentiality,
      'Specific Confidentiality Obligations\n• Shoot timeline and run-sheet details shall not be shared outside Company-approved channels.\n• Client and family personal details, contact numbers, and event particulars are strictly confidential.\n• Vendor details, rates, and contact information are Company property.\n• Location access, security arrangements, and venue notes shall not be disclosed to third parties.',
      CLAUSE.noContactExchange,
      CLAUSE.nonCircumvention,
      CLAUSE.breach,
      SIGN_BLOCK,
    ]),
  },
  {
    key: 'photographer_cinematographer',
    title: 'General Photographer & Cinematographer Assignment Terms',
    description:
      'Standard production-day terms for lead photographers, traditional, candid, and cinematographers.',
    category: 'production',
    mode: 'acknowledgement_required',
    validity_days: 60,
    best_for: [
      'Candid Photographer',
      'Traditional Photographer',
      'Cinematographer',
      'Traditional Videographer',
    ],
    body: compose([
      HEADER('Photographer & Cinematographer Assignment Terms'),
      'Assignment Details\nThe Team Member is engaged for {{shoot_name}} on {{shoot_date}} under project {{project_name}} of the Company.',
      CLAUSE.conduct,
      'Equipment, Memory Cards, and Backup\nThe Team Member shall arrive with fully charged, tested equipment and adequate memory cards. All captured data shall be handed over to the Company on the same day of the shoot unless otherwise agreed in writing. The Team Member is responsible for safe handling and backup until handover.',
      CLAUSE.dataIp,
      CLAUSE.social,
      CLAUSE.confidentiality,
      CLAUSE.nonCircumvention,
      CLAUSE.noContactExchange,
      CLAUSE.payment,
      CLAUSE.breach,
      SIGN_BLOCK,
    ]),
  },
  {
    key: 'assistant_bts_drone',
    title: 'Assistant Photographer / BTS / Drone Operator Terms',
    description:
      'Conduct, safety, and confidentiality terms for assistants, BTS shooters, drone, and lighting operators.',
    category: 'production',
    mode: 'acknowledgement_required',
    validity_days: 60,
    best_for: ['Assistant Photographer', 'BTS Shooter', 'Drone Operator', 'Lighting Assistant'],
    body: compose([
      HEADER('Assistant / BTS / Drone Operator Terms'),
      'Scope and Reporting\nThe Team Member shall report to and work under the direction of the lead photographer or lead cinematographer assigned by the Company, and follow all on-site instructions.',
      'Equipment Care and Safety\nThe Team Member shall handle Company and personal equipment with reasonable care, follow safety protocols on set, and is responsible for the safe operation of any drone, lighting rig, or specialised equipment they operate, including obtaining required permissions where applicable.',
      "No Independent Client Communication\nThe Team Member shall not directly negotiate, promise, or commit anything to the client, family, or planners without the lead crew's approval.",
      'Data Submission\nAll captured raw data, BTS, and drone footage shall be submitted to the Company or lead crew at the end of the shoot day.',
      CLAUSE.confidentiality,
      CLAUSE.nonCircumvention,
      CLAUSE.noContactExchange,
      CLAUSE.social,
      CLAUSE.breach,
      SIGN_BLOCK,
    ]),
  },
  {
    key: 'destination_outstation',
    title: 'Destination / Outstation Shoot Conduct Terms',
    description:
      'Conduct, travel, and accommodation rules for travelling crew on destination shoots.',
    category: 'production',
    mode: 'acknowledgement_required',
    validity_days: 60,
    best_for: [
      'Travelling Crew',
      'Photographer',
      'Cinematographer',
      'Assistant',
      'On-location Editor',
    ],
    body: compose([
      HEADER('Destination / Outstation Shoot Conduct Terms'),
      'Travel and Accommodation Discipline\nThe Team Member shall follow the travel plan, reporting times, and accommodation arrangements made by the Company. Any deviation requires prior written approval.',
      "Conduct at Hotel and Venue\nThe Team Member shall behave professionally at the hotel, venue, and during travel, refrain from any misconduct, and respect the client's family, guests, and local customs.",
      'Expense Approval\nAll reimbursable expenses must be pre-approved in writing by the Company. Unapproved expenses will not be reimbursed.',
      'No-Show and Cancellation\nUnexcused absence, late arrival, or last-minute cancellation may result in deduction of dues, cost recovery for replacement crew, and removal from future assignments, in addition to any other remedies under law.',
      CLAUSE.confidentiality,
      CLAUSE.nonCircumvention,
      CLAUSE.noContactExchange,
      CLAUSE.dataIp,
      CLAUSE.breach,
      SIGN_BLOCK,
    ]),
  },
  {
    key: 'post_editor',
    title: 'Post-Production Editor Confidentiality & Delivery Agreement',
    description:
      'Delivery, confidentiality, and data handling terms for video, photo, and highlight editors.',
    category: 'post_production',
    mode: 'acknowledgement_required',
    validity_days: 90,
    best_for: ['Video Editor', 'Photo Editor', 'Colorist', 'Highlight Film Editor', 'Reel Editor'],
    body: compose([
      HEADER('Post-Production Editor Confidentiality & Delivery Agreement'),
      'Scope and Delivery Timeline\nThe Team Member shall complete the assigned edit for {{project_name}} as per the timeline and quality standards communicated by the Company.',
      'Raw Data Safety\nThe Team Member shall safeguard all raw footage and project files received from the Company, store them only on approved devices, and shall not duplicate, share, or transfer them to any third party.',
      'No Reuse of Footage\nThe Team Member shall not reuse, republish, sell, or showcase any project footage, photographs, or edits in personal portfolios, demo reels, or social media without prior written permission from the Company.',
      'Source Files Handover\nAll source files, project files, presets, and final exports shall be handed over to the Company on completion. The Team Member shall not retain copies after delivery without written approval.',
      'No Unauthorised Outsourcing\nThe Team Member shall not outsource, sub-contract, or share any part of the assignment with a third-party editor without prior written approval from the Company.',
      CLAUSE.confidentiality,
      CLAUSE.nonCircumvention,
      CLAUSE.noContactExchange,
      CLAUSE.dataIp,
      CLAUSE.payment,
      CLAUSE.breach,
      SIGN_BLOCK,
    ]),
  },
  {
    key: 'album_retoucher',
    title: 'Album Designer / Retoucher / Colorist Work Terms',
    description:
      'Revision, delivery, and confidentiality terms for album designers, retouchers, and colorists.',
    category: 'post_production',
    mode: 'acknowledgement_required',
    validity_days: 90,
    best_for: ['Album Designer', 'Retoucher', 'Photo Editor', 'Colorist'],
    body: compose([
      HEADER('Album Designer / Retoucher / Colorist Work Terms'),
      "Revision and Delivery Standards\nThe Team Member shall follow the Company's design, retouching, and color standards, accept reasonable revisions within the agreed scope, and deliver files in the agreed format and naming convention.",
      'File Naming and Handover\nFinal designs, retouched images, and graded files shall be delivered using the file naming convention specified by the Company, along with all working source files.',
      'No Independent Use of Client Images\nThe Team Member shall not use, reproduce, sell, or display any client image, design, or graded footage in personal portfolios or social media without prior written permission from the Company.',
      CLAUSE.confidentiality,
      CLAUSE.dataIp,
      CLAUSE.social,
      CLAUSE.nonCircumvention,
      CLAUSE.breach,
      SIGN_BLOCK,
    ]),
  },
  {
    key: 'post_exit',
    title: 'Post-Exit Confidentiality, Non-Solicitation & Non-Circumvention Undertaking',
    description: 'Strong business-protection undertaking that survives after the engagement ends.',
    category: 'business_protection',
    mode: 'acknowledgement_required',
    validity_days: 180,
    best_for: [
      'Editors',
      'Freelancers',
      'Regular Team Members',
      'Vendors',
      'Anyone with access to clients, systems, or data',
    ],
    body: compose([
      HEADER('Post-Exit Confidentiality, Non-Solicitation & Non-Circumvention Undertaking'),
      "Survival of Obligations\nThe obligations under this undertaking shall survive the completion or termination of the Team Member's engagement with the Company and shall remain enforceable thereafter, subject to applicable law.",
      CLAUSE.confidentiality,
      "No Use of Company Client Database\nThe Team Member shall not use, retain, copy, or reference the Company's client database, contact lists, lead lists, vendor lists, or project records after the engagement ends.",
      CLAUSE.nonSolicitation,
      'No Direct Dealing with Company-Introduced Clients\nThe Team Member shall not directly or indirectly accept work from, provide services to, or transact with any client, family member, planner, or vendor introduced to the Team Member by or through the Company.',
      CLAUSE.noMisuseSystems,
      CLAUSE.unfairCompetition,
      CLAUSE.restrictedDealing,
      CLAUSE.breach,
      SIGN_BLOCK,
    ]),
  },
  {
    key: 'universal',
    title: 'Universal Team Member Business Protection Undertaking',
    description:
      'A general-purpose business protection undertaking suitable for all team members, freelancers, and vendors.',
    category: 'general',
    mode: 'acknowledgement_required',
    validity_days: 180,
    best_for: [
      'All Team Members',
      'Freelancers',
      'Vendors',
      'Photographers',
      'Editors',
      'Coordinators',
    ],
    body: compose([
      HEADER('Universal Team Member Business Protection Undertaking'),
      CLAUSE.confidentiality,
      CLAUSE.nonCircumvention,
      CLAUSE.noContactExchange,
      CLAUSE.noMisuseSystems,
      CLAUSE.nonSolicitation,
      'No Unauthorised Portfolio Use\nThe Team Member shall not display, post, or use any Company project work in personal portfolios, social media, or marketing material without prior written permission.',
      CLAUSE.dataIp,
      CLAUSE.unfairCompetition,
      CLAUSE.breach,
      SIGN_BLOCK,
    ]),
  },
]

// Infer a category for an employee role by name when role.category is not set.
