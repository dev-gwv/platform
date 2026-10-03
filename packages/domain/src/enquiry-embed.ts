/**
 * The code a studio pastes into its own website to show its enquiry form
 * (0240): an iframe of the hosted form, plus a few lines that let the form
 * tell the page how tall it is, so it never shows a scroll bar of its own.
 * Only messages from the form's own origin are listened to.
 */
export const ENQUIRY_HEIGHT_MESSAGE = 'sa-enquiry-height'

export function enquiryEmbedCode(formUrl: string): string {
  const origin = new URL(formUrl).origin
  const src = `${formUrl}${formUrl.includes('?') ? '&' : '?'}embed=1`
  return [
    `<iframe src="${src}" title="Enquiry form" loading="lazy" style="width:100%;max-width:560px;border:0;min-height:640px"></iframe>`,
    `<script>addEventListener("message",function(e){if(e.origin!=="${origin}"||!e.data||e.data.type!=="${ENQUIRY_HEIGHT_MESSAGE}")return;` +
      `document.querySelectorAll('iframe[src^="${origin}/enquire/"]').forEach(function(f){if(f.contentWindow===e.source)f.style.height=e.data.height+"px"})})</script>`,
  ].join('\n')
}
