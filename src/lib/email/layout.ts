import { EMAIL } from './palette.ts';

/**
 * Shared shell for every Tunnex email: simple, table-free, inline-styled HTML
 * that renders predictably across clients. Content blocks are provided as
 * pre-rendered HTML (from templates.ts only — never user input without
 * escaping there).
 */
export function renderShell(opts: {
  title: string;
  bodyHtml: string;
  assetBaseUrl: string;
  /** Inbox preview line; hidden in the rendered body. */
  preheader?: string;
  /** false = internal notification footer instead of the customer footer. */
  customerFooter?: boolean;
}): string {
  const rawAssetBaseUrl = opts.assetBaseUrl || '';
  const assetBaseUrl =
    !rawAssetBaseUrl || rawAssetBaseUrl.includes('workers.dev')
      ? 'https://tunnex.io'
      : rawAssetBaseUrl;
  const preheader = opts.preheader
    ? `<span style="display:none;font-size:1px;color:${EMAIL.bg};max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(opts.preheader)}</span>`
    : '';
  const footer =
    opts.customerFooter === false
      ? 'Internal notification · enterprise lead from tunnex.io/enterprise.'
      : `Tunnex · Connect everything. Trust nothing.<br>
    Questions? Reply to this email or write to <a href="mailto:support@tunnex.io" style="color:${EMAIL.textMuted};text-decoration:underline;">support@tunnex.io</a>.`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${EMAIL.bg};color:${EMAIL.text};">
${preheader}
<div style="max-width:560px;margin:0 auto;padding:40px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="background-color:${EMAIL.surface};border:1px solid ${EMAIL.border};border-radius:12px;padding:32px 28px;color:${EMAIL.text};font-size:15px;line-height:1.6;">
    <div style="padding-bottom:24px;margin-bottom:24px;border-bottom:1px solid ${EMAIL.border};text-align:center;">
      <a href="${escapeAttr(assetBaseUrl)}" style="text-decoration:none;display:inline-block;">
        <img src="${assetBaseUrl}/email/tunnex-logo-2x.png" alt="Tunnex" width="176" height="22" style="display:block;border:0;margin:0 auto;outline:none;">
      </a>
    </div>
${opts.bodyHtml}
  </div>
  <p style="color:${EMAIL.textMuted};font-size:12px;line-height:1.6;padding-top:20px;margin:0;text-align:center;">
    ${footer}
  </p>
</div>
</body>
</html>`;
}

export function button(href: string, label: string): string {
  return `<p style="margin:28px 0 16px;text-align:center;"><a href="${escapeAttr(href)}" style="display:inline-block;background-color:${EMAIL.primary};color:${EMAIL.primaryFg};text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:8px;">${escapeHtml(label)}</a></p>`;
}

export function paragraph(html: string): string {
  return `<p style="margin:0 0 16px;color:${EMAIL.text};font-size:15px;line-height:1.6;">${html}</p>`;
}

export function muted(html: string): string {
  return `<p style="margin:16px 0 0;color:${EMAIL.textMuted};font-size:13px;line-height:1.5;">${html}</p>`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function escapeAttr(value: string): string {
  return escapeHtml(value);
}
