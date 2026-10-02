import { pbUrl } from './pbAdmin';
import { escapeHtml, isMailConfigured, mailLayout, sendMail } from './mailer';

export interface Recipient {
	id: string;
	email?: string;
	name?: string;
	mail_opt_out?: boolean;
}

export interface MessageInput {
	kind: 'absence' | 'attendance_restored' | 'system';
	subject: string;
	body: string;
	link?: string;
	sender?: string;
	club?: string;
	team?: string;
	player?: string;
	training?: string;
	match?: string;
	ref?: string;
	ref_status?: string;
}

/**
 * Puts a message in the inbox of every recipient and mails a copy to everyone
 * who has not opted out. Mail failures never undo the inbox message: the inbox
 * is the source of truth, e-mail is a convenience copy.
 */
export async function deliverMessage(
	adminToken: string,
	recipients: Recipient[],
	message: MessageInput
): Promise<{ delivered: number; emailed: number }> {
	let delivered = 0;
	let emailed = 0;
	const mailEnabled = isMailConfigured();

	for (const recipient of recipients) {
		const res = await fetch(`${pbUrl()}/api/collections/messages/records`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: adminToken },
			body: JSON.stringify({ ...message, recipient: recipient.id, read: false, emailed: false })
		});
		if (!res.ok) {
			console.error('Kon bericht niet opslaan:', await res.text());
			continue;
		}
		delivered++;
		const record = await res.json();

		if (!mailEnabled || recipient.mail_opt_out || !recipient.email) continue;
		try {
			const bodyHtml = message.body
				.split('\n')
				.map((line) => `<p>${escapeHtml(line)}</p>`)
				.join('');
			await sendMail({
				to: recipient.email,
				subject: message.subject,
				text: message.link ? `${message.body}\n\n${message.link}` : message.body,
				html: mailLayout(
					message.subject,
					bodyHtml,
					message.link ? { href: message.link, label: 'Bekijk in SetBaas' } : undefined
				)
			});
			emailed++;
			await fetch(`${pbUrl()}/api/collections/messages/records/${record.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json', Authorization: adminToken },
				body: JSON.stringify({ emailed: true })
			});
		} catch (e) {
			console.error(`E-mail naar ${recipient.email} mislukt:`, e);
		}
	}

	return { delivered, emailed };
}
