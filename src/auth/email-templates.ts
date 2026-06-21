/**
 * Plantillas HTML mínimas para los emails transaccionales de cuenta.
 * Se mantienen simples e inline para no depender de un motor de templates.
 */

function layout(title: string, body: string): string {
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;background:#f4f6f8;margin:0;padding:24px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
    <h2 style="color:#0f172a;margin-top:0;">${title}</h2>
    ${body}
    <p style="color:#94a3b8;font-size:12px;margin-top:32px;">Zentto Web3 — neobanco</p>
  </div></body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0;">
    <a href="${href}" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;">${label}</a>
  </p>
  <p style="color:#64748b;font-size:13px;">Si el botón no funciona, copia este enlace:</p>
  <p style="color:#2563eb;font-size:13px;word-break:break-all;">${href}</p>`;
}

export function verifyEmailTemplate(link: string): { subject: string; html: string } {
  return {
    subject: 'Verifica tu correo — Zentto',
    html: layout(
      'Confirma tu correo',
      `<p style="color:#334155;">Gracias por crear tu cuenta. Confirma tu correo para desbloquear todas las funciones.</p>${button(
        link,
        'Verificar correo',
      )}<p style="color:#94a3b8;font-size:12px;">Este enlace caduca en 24 horas.</p>`,
    ),
  };
}

export function resetPasswordTemplate(link: string): { subject: string; html: string } {
  return {
    subject: 'Restablece tu contraseña — Zentto',
    html: layout(
      'Restablece tu contraseña',
      `<p style="color:#334155;">Recibimos una solicitud para cambiar tu contraseña. Si no fuiste tú, ignora este correo.</p>${button(
        link,
        'Restablecer contraseña',
      )}<p style="color:#94a3b8;font-size:12px;">Este enlace caduca en 1 hora.</p>`,
    ),
  };
}
