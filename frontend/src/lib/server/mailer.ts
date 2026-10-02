import { env } from '$env/dynamic/private';
import nodemailer from 'nodemailer';

export function isMailConfigured(): boolean {
	return !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

export function mailFrom(): string {
	return env.SMTP_FROM || 'info@setbaas.nl';
}

/** Port 465 uses implicit TLS; other ports (587) upgrade with STARTTLS. */
function transporter() {
	const port = parseInt(env.SMTP_PORT || '587');
	return nodemailer.createTransport({
		host: env.SMTP_HOST,
		port,
		secure: port === 465,
		auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }
	});
}

export async function sendMail(options: { to: string; subject: string; html: string; text?: string }) {
	if (!isMailConfigured()) throw new Error('SMTP niet geconfigureerd');
	await transporter().sendMail({ from: `"SetBaas" <${mailFrom()}>`, ...options });
}

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** Wraps already-escaped HTML content in the standard SetBaas mail layout. */
export function mailLayout(title: string, contentHtml: string, button?: { href: string; label: string }): string {
	const buttonHtml = button
		? `<a href="${escapeHtml(button.href)}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; margin: 16px 0;">${escapeHtml(button.label)}</a>`
		: '';
	return `
		<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
			<h2 style="color: #2563eb;">🏐 ${escapeHtml(title)}</h2>
			${contentHtml}
			${buttonHtml}
			<p style="color: #666; font-size: 12px; margin-top: 24px;">
				Dit bericht staat ook in je SetBaas inbox. Je kunt e-mailmeldingen uitzetten op je profielpagina.
			</p>
		</div>
	`;
}
